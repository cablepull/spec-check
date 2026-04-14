// Gate 3 — ADR Valid / Design Valid
// Primary: validates adr/ directory (one ADR per architectural decision).
// Aggregate checks: traceability to requirements.md, component language, no constraint negation.
// Backwards compatible: if adr/ is absent but design.md exists, runs legacy D-* checks
// with a deprecation WARNING.
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { GateResult, CriterionResult, ResolvedConfig } from "../types.js";
import {
  detectComponentLanguage,
  detectNegationProximity,
  detectImplementationLeak,
} from "../nlp.js";
import { getThreshold } from "../config.js";

const DESIGN_NAMES = ["design.md", "DESIGN.md", "design/design.md", "architecture.md"];
const REQ_NAMES = ["requirements.md", "REQUIREMENTS.md"];

function findFile(specPath: string, names: string[]): string | null {
  for (const name of names) {
    const full = join(specPath, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function findAdrDir(specPath: string): string | null {
  const dir = join(specPath, "adr");
  if (!existsSync(dir)) return null;
  try {
    return readdirSync(dir).some((f) => f.endsWith(".md")) ? dir : null;
  } catch {
    return null;
  }
}

function readAdrFiles(adrDir: string): string {
  try {
    return readdirSync(adrDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => { try { return readFileSync(join(adrDir, f), "utf-8"); } catch { return ""; } })
      .join("\n\n");
  } catch {
    return "";
  }
}

function readFile(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

// Extract F-N and R-N IDs from text
function extractIds(text: string, pattern: RegExp): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(pattern.source, "gi");
  while ((m = re.exec(text)) !== null) ids.add(m[0].toUpperCase());
  return [...ids];
}

// Extract key constraint/rule terms from requirements for negation check
function extractConstraintTerms(reqText: string): string[] {
  const terms: string[] = [];
  const lines = reqText.split("\n");
  for (const line of lines) {
    // Pull out nouns after must/required/constraint keywords
    const m = line.match(/\b(?:must|required|shall|constraint)\s+(\w+(?:\s+\w+){0,3})/i);
    if (m) terms.push(m[1]!.toLowerCase());
  }
  return [...new Set(terms)].slice(0, 20);
}

function buildGateStatus(criteria: CriterionResult[]): GateResult["status"] {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function runTraceabilityAndQualityChecks(
  designText: string,
  reqText: string,
  config: ResolvedConfig,
  idPrefix: "A" | "D"
): CriterionResult[] {
  const criteria: CriterionResult[] = [];

  // Traceability: design/ADR text must reference F-N and R-N from requirements
  const reqFeatureIds = extractIds(reqText, /F-\d+/g);
  const reqRuleIds = extractIds(reqText, /R-\d+/g);
  const designFeatureIds = extractIds(designText, /F-\d+/g);
  const designRuleIds = extractIds(designText, /R-\d+/g);
  const missingFeatures = reqFeatureIds.filter((id) => !designFeatureIds.includes(id));
  const missingRules = reqRuleIds.filter((id) => !designRuleIds.includes(id));
  const traceId = `${idPrefix}-4`;

  if (reqFeatureIds.length === 0 && reqRuleIds.length === 0) {
    criteria.push({ id: traceId, status: "WARNING", detail: "No feature/rule IDs found in requirements to cross-reference with design/ADRs." });
  } else if (missingFeatures.length === 0 && missingRules.length === 0) {
    criteria.push({ id: traceId, status: "PASS", detail: `ADRs reference all ${reqFeatureIds.length} feature(s) and ${reqRuleIds.length} rule(s).` });
  } else {
    const evidence: string[] = [];
    if (missingFeatures.length > 0) evidence.push(`Features not referenced in ADRs: ${missingFeatures.join(", ")}`);
    if (missingRules.length > 0) evidence.push(`Rules not referenced in ADRs: ${missingRules.slice(0, 10).join(", ")}`);
    criteria.push({
      id: traceId, status: "VIOLATION",
      detail: `ADRs do not reference ${missingFeatures.length + missingRules.length} requirement ID(s).`,
      evidence,
      fix: "Add explicit references to all Feature and Rule IDs from requirements.md in the ADR files.",
    });
  }

  // Component language
  const d3Threshold = getThreshold(config, "D-3");
  const componentResult = detectComponentLanguage(designText);
  const compId = `${idPrefix}-5`;
  if (!componentResult.matched || componentResult.confidence < d3Threshold) {
    criteria.push({
      id: compId, status: "VIOLATION",
      detail: "ADRs lack component/architectural language.",
      evidence: componentResult.evidence, confidence: componentResult.confidence,
      fix: "Describe system components: service, module, database, API, queue, pipeline, gateway, etc.",
    });
  } else {
    criteria.push({ id: compId, status: "PASS", detail: "Component language detected.", evidence: componentResult.evidence, confidence: componentResult.confidence });
  }

  // Constraint negation (permanently WARNING)
  const constraintTerms = extractConstraintTerms(reqText);
  const negId = `${idPrefix}-6`;
  if (constraintTerms.length > 0) {
    const negationResult = detectNegationProximity(designText, constraintTerms);
    if (negationResult.matched) {
      criteria.push({
        id: negId, status: "WARNING",
        detail: "ADRs may contradict requirement constraints (heuristic detection).",
        evidence: negationResult.evidence.slice(0, 3), confidence: negationResult.confidence,
        fix: "Review highlighted sentences — ensure ADRs do not negate constraints from requirements.",
      });
    } else {
      criteria.push({ id: negId, status: "PASS", detail: "No apparent contradictions between ADRs and requirement constraints." });
    }
  } else {
    criteria.push({ id: negId, status: "WARNING", detail: "No constraint terms extracted from requirements; contradiction check skipped." });
  }

  return criteria;
}

export async function runGate3(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  // Read requirements for cross-referencing (compiled requirements.md)
  const reqFile = findFile(specPath, REQ_NAMES);
  const reqText = reqFile ? readFile(reqFile) : "";

  // ── Primary: adr/ directory ─────────────────────────────────────────────────
  const adrDir = findAdrDir(specPath);
  if (adrDir) {
    const { validateArtifacts } = await import("../artifacts.js");
    const summary = validateArtifacts(adrDir, false);
    // Per-file structural criteria from validateAdr (A-1, A-2, A-3)
    const perFileCriteria = summary.results.flatMap((r) => r.criteria);
    criteria.push({ id: "A-1", status: "PASS", detail: `ADR directory found: ${adrDir}` });
    criteria.push(...perFileCriteria);
    // Aggregate traceability + quality checks over concatenated ADR text
    const adrText = readAdrFiles(adrDir);
    criteria.push(...runTraceabilityAndQualityChecks(adrText, reqText, config, "A"));
    return { gate: "G3", name: "ADR Valid", status: buildGateStatus(criteria), criteria, durationMs: Date.now() - start };
  }

  // ── Backwards compat: legacy design.md ──────────────────────────────────────
  const designFile = findFile(specPath, DESIGN_NAMES);
  if (designFile) {
    criteria.push({
      id: "D-1",
      status: "WARNING",
      detail: `Legacy design.md found at ${designFile}. Migrate to adr/ directory (one file per decision).`,
      fix: "Create an adr/ directory and split design.md into individual ADR files.",
    });
    const designText = readFile(designFile);
    criteria.push(...runTraceabilityAndQualityChecks(designText, reqText, config, "D"));
    const hasAssumptions = /^#+\s*assumptions?\b/im.test(designText);
    criteria.push(
      hasAssumptions
        ? { id: "D-5", status: "PASS", detail: "Assumptions section present." }
        : { id: "D-5", status: "VIOLATION", detail: "Design document is missing an ## Assumptions section.", fix: "Add '## Assumptions'." }
    );
    return { gate: "G3", name: "ADR Valid", status: buildGateStatus(criteria), criteria, durationMs: Date.now() - start };
  }

  // ── Neither found: BLOCK ─────────────────────────────────────────────────────
  criteria.push({
    id: "A-1",
    status: "BLOCK",
    detail: "No adr/ directory found. Expected adr/ with at least one ADR file.",
    fix: "Create an adr/ directory and add ADR files documenting architectural decisions.",
  });
  return { gate: "G3", name: "ADR Valid", status: "BLOCKED", criteria, durationMs: Date.now() - start };
}
