// Gate 3 — Design Valid
// Checks D-1 through D-5 against the design document.
// Assumption: design document is named design.md, DESIGN.md, or similar under specPath.
// Assumption: "references each requirement" is checked by scanning for Feature/Rule IDs
//   (F-N, R-N) in the design text — proximity-based, not a full semantic parse.
// Assumption: D-4 (negation of requirement constraints) is always WARNING, never VIOLATION
//   per PRD § Criterion Severity: contradiction detection too noisy for hard-block.
import { existsSync, readFileSync } from "fs";
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

export async function runGate3(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  // ── D-1: Design document exists ────────────────────────────────────────────
  const designFile = findFile(specPath, DESIGN_NAMES);
  if (!designFile) {
    criteria.push({
      id: "D-1",
      status: "BLOCK",
      detail: "No design document found. Expected design.md under the spec path.",
      fix: "Create design.md describing the system architecture and how requirements are satisfied.",
    });
    return {
      gate: "G3",
      name: "Design Valid",
      status: "BLOCKED",
      criteria,
      durationMs: Date.now() - start,
    };
  }

  criteria.push({ id: "D-1", status: "PASS", detail: `Design document found: ${designFile}` });

  const designText = readFile(designFile);

  // Read requirements for cross-referencing
  const reqFile = findFile(specPath, REQ_NAMES);
  const reqText = reqFile ? readFile(reqFile) : "";

  // ── D-2: Design references each feature/requirement ──────────────────────────
  const reqFeatureIds = extractIds(reqText, /F-\d+/g);
  const reqRuleIds = extractIds(reqText, /R-\d+/g);
  const designFeatureIds = extractIds(designText, /F-\d+/g);
  const designRuleIds = extractIds(designText, /R-\d+/g);

  const missingFeatures = reqFeatureIds.filter((id) => !designFeatureIds.includes(id));
  const missingRules = reqRuleIds.filter((id) => !designRuleIds.includes(id));

  if (reqFeatureIds.length === 0 && reqRuleIds.length === 0) {
    // No req IDs to cross-reference
    criteria.push({ id: "D-2", status: "WARNING", detail: "No feature/rule IDs found in requirements to cross-reference with design." });
  } else if (missingFeatures.length === 0 && missingRules.length === 0) {
    criteria.push({
      id: "D-2",
      status: "PASS",
      detail: `Design references all ${reqFeatureIds.length} feature(s) and ${reqRuleIds.length} rule(s).`,
    });
  } else {
    const evidence: string[] = [];
    if (missingFeatures.length > 0) evidence.push(`Features not in design: ${missingFeatures.join(", ")}`);
    if (missingRules.length > 0) evidence.push(`Rules not in design: ${missingRules.slice(0, 10).join(", ")}`);
    criteria.push({
      id: "D-2",
      status: "VIOLATION",
      detail: `Design does not reference ${missingFeatures.length + missingRules.length} requirement ID(s).`,
      evidence,
      fix: "Add explicit references to all Feature and Rule IDs in the design document.",
    });
  }

  // ── D-3: Component language present ─────────────────────────────────────────
  const d3Threshold = getThreshold(config, "D-3");
  const componentResult = detectComponentLanguage(designText);
  if (!componentResult.matched || componentResult.confidence < d3Threshold) {
    criteria.push({
      id: "D-3",
      status: "VIOLATION",
      detail: "Design document lacks component/architectural language.",
      evidence: componentResult.evidence,
      confidence: componentResult.confidence,
      fix: "Describe system components: service, module, database, API, queue, pipeline, gateway, etc.",
    });
  } else {
    criteria.push({
      id: "D-3",
      status: "PASS",
      detail: "Component language detected.",
      evidence: componentResult.evidence,
      confidence: componentResult.confidence,
    });
  }

  // ── D-4: Design does not negate requirement constraints (WARNING only) ────────
  // D-4 is permanently WARNING; cannot be elevated to VIOLATION per PRD.
  const constraintTerms = extractConstraintTerms(reqText);
  if (constraintTerms.length > 0) {
    const negationResult = detectNegationProximity(designText, constraintTerms);
    if (negationResult.matched) {
      criteria.push({
        id: "D-4",
        status: "WARNING",   // permanently WARNING per PRD
        detail: "Design may contradict requirement constraints (contradiction detection is heuristic).",
        evidence: negationResult.evidence.slice(0, 3),
        confidence: negationResult.confidence,
        fix: "Review highlighted sentences — ensure design does not negate constraints stated in requirements.",
      });
    } else {
      criteria.push({ id: "D-4", status: "PASS", detail: "No apparent contradictions between design and requirement constraints." });
    }
  } else {
    criteria.push({ id: "D-4", status: "WARNING", detail: "No constraint terms extracted from requirements; D-4 contradiction check skipped." });
  }

  // ── D-5: Assumptions section present ─────────────────────────────────────────
  const hasAssumptions = /^#+\s*assumptions?\b/im.test(designText);
  if (!hasAssumptions) {
    criteria.push({
      id: "D-5",
      status: "VIOLATION",
      detail: "Design document is missing an ## Assumptions section.",
      fix: "Add '## Assumptions' and list every design decision inferred without explicit user instruction.",
    });
  } else {
    criteria.push({ id: "D-5", status: "PASS", detail: "Assumptions section present." });
  }

  // ── Determine gate status ───────────────────────────────────────────────────
  const hasBlock = criteria.some((c) => c.status === "BLOCK");
  const hasViolation = criteria.some((c) => c.status === "VIOLATION");
  const hasWarning = criteria.some((c) => c.status === "WARNING");

  let status: GateResult["status"];
  if (hasBlock) status = "BLOCKED";
  else if (hasViolation) status = "FAILING";
  else if (hasWarning) status = "PASSING_WITH_WARNINGS";
  else status = "PASS";

  return { gate: "G3", name: "Design Valid", status, criteria, durationMs: Date.now() - start };
}
