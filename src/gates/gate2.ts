// Gate 2 — PRD Valid / Requirements Valid
// Primary: validates prd/ directory (one PRD per feature) and checks that compiled
// requirements.md exists (P-11). Criteria P-1 through P-11 map to former R-1 through R-10
// plus the new compiled-output check.
// Backwards compatible: if prd/ is absent but requirements.md exists, runs legacy R-* checks
// with a deprecation WARNING.
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { GateResult, CriterionResult, ResolvedConfig } from "../types.js";
import {
  detectImperativeVerb,
  detectActionVerbInGiven,
  detectCompoundClause,
  detectInternalState,
  detectImplementationLeak,
  detectErrorScenario,
} from "../nlp.js";
import { getThreshold } from "../config.js";

const REQ_NAMES = ["requirements.md", "REQUIREMENTS.md", "requirements/requirements.md"];

function findFile(specPath: string, names: string[]): string | null {
  for (const name of names) {
    const full = join(specPath, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function findPrdDir(specPath: string): string | null {
  const dir = join(specPath, "prd");
  if (!existsSync(dir)) return null;
  try {
    return readdirSync(dir).some((f) => f.endsWith(".md")) ? dir : null;
  } catch {
    return null;
  }
}

function readPrdFiles(prdDir: string): string {
  try {
    return readdirSync(prdDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => { try { return readFileSync(join(prdDir, f), "utf-8"); } catch { return ""; } })
      .join("\n\n");
  } catch {
    return "";
  }
}

function readFile(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

interface ParsedRule {
  id: string;
  text: string;
}

interface ParsedStep {
  type: "GIVEN" | "WHEN" | "THEN" | "AND";
  text: string;
  featureId?: string;
}

interface ParsedExample {
  featureId: string;
  title: string;
  steps: ParsedStep[];
  isNegative: boolean;
}

function buildGateStatus(criteria: CriterionResult[]): GateResult["status"] {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

// Extract rule lines: "### Rule R-3: ..." or "- Rule R-3: ..."
function extractRules(text: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const rulePattern = /^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?(?:\*\*)?Rule\s+(R-\d+[a-z]?)(?:\*\*)?[:\s]+(.+)$/i;
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(rulePattern);
    if (m) rules.push({ id: m[1]!, text: m[2]!.trim() });
  }
  // Also catch inline rule headers like "**R-3**: Validate..."
  const inlinePattern = /\*\*(R-\d+[a-z]?)\*\*[:\s]+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = inlinePattern.exec(text)) !== null) {
    if (!rules.find((r) => r.id === m![1])) {
      rules.push({ id: m[1]!, text: m[2]!.trim() });
    }
  }
  return rules;
}

// Extract Given/When/Then steps from examples sections
function extractSteps(text: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*[-*]?\s*(Given|When|Then|And)\s+(.+)/i);
    if (m) {
      steps.push({
        type: m[1]!.toUpperCase() as ParsedStep["type"],
        text: m[2]!.trim(),
      });
    }
  }
  return steps;
}

// Extract examples from text — accept both heading-style and plain "Example:" lines
function extractExamples(text: string): ParsedExample[] {
  const examples: ParsedExample[] = [];
  // Split by feature sections (## Feature F-N)
  const featureSections = text.split(/(?=^#{1,3}\s+Feature\s+F-\d+)/im);
  for (const section of featureSections) {
    const featureMatch = section.match(/^#{1,3}\s+Feature\s+(F-\d+)/im);
    const featureId = featureMatch?.[1] ?? "unknown";

    // Split by example blocks
    const exampleBlocks = section.split(/(?=^\s*(?:#{1,6}\s+)?(?:Example|Scenario|Negative Example):?)/im);
    for (const block of exampleBlocks) {
      const titleMatch = block.match(/^\s*(?:#{1,6}\s+)?((?:Example|Scenario|Negative Example):?.+)/im);
      if (!titleMatch) continue;
      const title = titleMatch[1]!.trim();
      const steps = extractSteps(block);
      const errorSignals = detectErrorScenario(`${title}\n${block}`);
      const isNegative =
        /negative|error|invalid|fail|reject|missing|without|below threshold|exceeds|compound|contradiction|\bno\b/i.test(title) ||
        errorSignals.matched;
      if (steps.length > 0) {
        examples.push({ featureId, title, steps, isNegative });
      }
    }
  }
  return examples;
}

function assessHierarchy(text: string): CriterionResult {
  const hasFeature = /^#{1,3}\s+Feature\s+F-\d+/im.test(text);
  const hasRule = /Rule\s+R-\d+/i.test(text);
  const hasExample =
    /^\s*(?:#{1,6}\s+)?(Example|Scenario)\b/im.test(text) ||
    /\b(Given|When|Then)\b/i.test(text);

  if (!hasFeature || !hasRule || !hasExample) {
    return {
      id: "R-2",
      status: "VIOLATION",
      detail: `Requirements hierarchy incomplete. Feature: ${hasFeature}, Rule: ${hasRule}, Example: ${hasExample}`,
      fix: "Ensure requirements use ## Feature F-N / Rule R-N / #### Example structure with Given/When/Then.",
    };
  }
  return { id: "R-2", status: "PASS", detail: "Feature/Rule/Example hierarchy detected." };
}

function assessImperativeRules(rules: ParsedRule[], threshold: number): CriterionResult {
  if (rules.length === 0) {
    return { id: "R-3", status: "WARNING", detail: "No parseable rules found to check for imperative verbs." };
  }
  const nonImperative = rules
    .filter((rule) => {
      const result = detectImperativeVerb(rule.text);
      return !(result.matched && result.confidence >= threshold);
    })
    .map((rule) => `${rule.id}: "${rule.text.slice(0, 60)}"`);
  if (nonImperative.length > 0) {
    return {
      id: "R-3",
      status: "VIOLATION",
      detail: `${nonImperative.length} rule(s) do not begin with an imperative verb.`,
      evidence: nonImperative.slice(0, 5),
      fix: "Rules must start with: accept, reject, show, send, create, validate, fetch, etc.",
    };
  }
  return { id: "R-3", status: "PASS", detail: `All ${rules.length} rules start with imperative verbs.` };
}

function assessBddStructure(text: string): CriterionResult {
  const hasGiven = /\bGiven\b/i.test(text);
  const hasWhen = /\bWhen\b/i.test(text);
  const hasThen = /\bThen\b/i.test(text);
  if (!hasGiven || !hasWhen || !hasThen) {
    return {
      id: "R-4",
      status: "VIOLATION",
      detail: `Examples missing BDD structure. Given: ${hasGiven}, When: ${hasWhen}, Then: ${hasThen}`,
      fix: "Format examples using Given/When/Then steps.",
    };
  }
  return { id: "R-4", status: "PASS", detail: "Given/When/Then structure detected." };
}

function assessNegativeCoverage(examples: ParsedExample[], threshold: number): CriterionResult {
  const negativeExamples = examples.filter((e) => e.isNegative);
  if (examples.length > 0 && negativeExamples.length === 0) {
    const allStepText = examples.flatMap((e) => e.steps).map((s) => s.text).join(" ");
    const errorResult = detectErrorScenario(allStepText);
    if (!errorResult.matched || errorResult.confidence < threshold) {
      return {
        id: "R-5",
        status: "VIOLATION",
        detail: "No negative/error scenarios found in examples.",
        fix: "Add at least one negative example per feature covering invalid input, error, or rejection cases.",
      };
    }
    return { id: "R-5", status: "PASS", detail: "Error/negative language detected in examples.", evidence: errorResult.evidence };
  }
  if (negativeExamples.length > 0) {
    return { id: "R-5", status: "PASS", detail: `${negativeExamples.length} negative scenario(s) found.` };
  }
  return { id: "R-5", status: "WARNING", detail: "No parseable examples found; could not verify negative scenario coverage." };
}

function assessFeatureNegativeCoverage(examples: ParsedExample[]): CriterionResult {
  const featureIds = [...new Set(examples.map((e) => e.featureId).filter((id) => id !== "unknown"))];
  const featuresWithoutNeg = featureIds.filter((fid) => !examples.some((e) => e.featureId === fid && e.isNegative));
  if (featureIds.length > 0 && featuresWithoutNeg.length > 0) {
    return {
      id: "R-6",
      status: "VIOLATION",
      detail: `${featuresWithoutNeg.length} feature(s) have no negative example.`,
      evidence: featuresWithoutNeg,
      fix: "Add at least one negative/error example to each feature.",
    };
  }
  if (featureIds.length > 0) {
    return { id: "R-6", status: "PASS", detail: "All features have at least one negative example." };
  }
  return { id: "R-6", status: "WARNING", detail: "Could not parse feature IDs from examples." };
}

function assessGivenSteps(allSteps: ParsedStep[], threshold: number): CriterionResult {
  const givenSteps = allSteps.filter((s) => s.type === "GIVEN");
  const badGivens = givenSteps
    .map((step) => {
      const normalized = step.text.replace(/`[^`]+`/g, "").replace(/"[^"]+"/g, "");
      const result = detectActionVerbInGiven(normalized);
      return result.matched && result.confidence >= threshold
        ? `"${step.text.slice(0, 60)}" (${result.evidence.join(", ")})`
        : null;
    })
    .filter((value): value is string => value !== null);
  if (badGivens.length > 0) {
    return {
      id: "R-7",
      status: "VIOLATION",
      detail: `${badGivens.length} GIVEN step(s) contain action verbs (GIVEN describes state, not action).`,
      evidence: badGivens.slice(0, 5),
      fix: "Replace action verbs in GIVEN with state descriptions: 'the user is logged in' not 'the user clicks login'.",
    };
  }
  if (givenSteps.length === 0) return { id: "R-7", status: "WARNING", detail: "No GIVEN steps found to check." };
  return { id: "R-7", status: "PASS", detail: `All ${givenSteps.length} GIVEN step(s) are state descriptions.` };
}

function assessCompoundRules(rules: ParsedRule[], threshold: number): CriterionResult {
  const compoundRules = rules
    .map((rule) => {
      const result = detectCompoundClause(rule.text);
      return result.matched && result.confidence >= threshold
        ? `${rule.id}: "${rule.text.slice(0, 60)}" — ${result.evidence[0]}`
        : null;
    })
    .filter((value): value is string => value !== null);
  if (compoundRules.length > 0) {
    return {
      id: "R-8",
      status: "VIOLATION",
      detail: `${compoundRules.length} rule(s) contain compound clauses joined by 'and'.`,
      evidence: compoundRules.slice(0, 5),
      fix: "Split compound rules: one rule = one behaviour.",
    };
  }
  return { id: "R-8", status: "PASS", detail: "No compound rule clauses detected." };
}

function assessThenSteps(allSteps: ParsedStep[], threshold: number): CriterionResult {
  const thenSteps = allSteps.filter((s) => s.type === "THEN");
  const badThens = thenSteps
    .map((step) => {
      const result = detectInternalState(step.text);
      return result.matched && result.confidence >= threshold
        ? `"${step.text.slice(0, 60)}" (${result.evidence.join(", ")})`
        : null;
    })
    .filter((value): value is string => value !== null);
  if (badThens.length > 0) {
    return {
      id: "R-9",
      status: "VIOLATION",
      detail: `${badThens.length} THEN step(s) reference internal state (should reference observable output only).`,
      evidence: badThens.slice(0, 5),
      fix: "THEN should describe user-observable outcomes, not internal system state.",
    };
  }
  if (thenSteps.length === 0) return { id: "R-9", status: "WARNING", detail: "No THEN steps found to check." };
  return { id: "R-9", status: "PASS", detail: `All ${thenSteps.length} THEN step(s) are observable.` };
}

function assessImplementationLeakCriterion(text: string, threshold: number): CriterionResult {
  const implLeak = detectImplementationLeak(text);
  if (implLeak.matched && implLeak.confidence >= threshold) {
    return {
      id: "R-10",
      status: "VIOLATION",
      detail: "Requirements contain implementation-specific language.",
      evidence: implLeak.evidence,
      confidence: implLeak.confidence,
      fix: "Remove framework/library names, SQL, identifiers. Requirements describe WHAT, not HOW.",
    };
  }
  if (implLeak.matched) {
    return {
      id: "R-10",
      status: "WARNING",
      detail: "Possible implementation detail (below violation threshold).",
      evidence: implLeak.evidence,
      confidence: implLeak.confidence,
    };
  }
  return { id: "R-10", status: "PASS", detail: "No implementation leak in requirements." };
}

function runPrdChecks(text: string, prdDir: string, config: ResolvedConfig): CriterionResult[] {
  const criteria: CriterionResult[] = [];
  const rules = extractRules(text);
  const examples = extractExamples(text);
  const allSteps = examples.flatMap((e) => e.steps);

  // P-2 through P-10 are the same structural/BDD checks as the former R-2 through R-10,
  // applied over the concatenated PRD content.
  const h = assessHierarchy(text);
  criteria.push({ ...h, id: "P-2" });
  const imp = assessImperativeRules(rules, getThreshold(config, "R-3"));
  criteria.push({ ...imp, id: "P-3" });
  const bdd = assessBddStructure(text);
  criteria.push({ ...bdd, id: "P-4" });
  const neg = assessNegativeCoverage(examples, getThreshold(config, "R-5"));
  criteria.push({ ...neg, id: "P-5" });
  const fneg = assessFeatureNegativeCoverage(examples);
  criteria.push({ ...fneg, id: "P-6" });
  const given = assessGivenSteps(allSteps, getThreshold(config, "R-7"));
  criteria.push({ ...given, id: "P-7" });
  const compound = assessCompoundRules(rules, getThreshold(config, "R-8"));
  criteria.push({ ...compound, id: "P-8" });
  const then = assessThenSteps(allSteps, getThreshold(config, "R-9"));
  criteria.push({ ...then, id: "P-9" });
  const leak = assessImplementationLeakCriterion(text, getThreshold(config, "R-10"));
  criteria.push({ ...leak, id: "P-10" });

  // P-11: compiled requirements.md must exist so G3/G5 can cross-reference
  const compiledExists = existsSync(join(prdDir, "..", "requirements.md"));
  criteria.push(
    compiledExists
      ? { id: "P-11", status: "PASS", detail: "Compiled requirements.md is present." }
      : {
          id: "P-11",
          status: "VIOLATION",
          detail: "requirements.md has not been compiled from prd/ files yet.",
          fix: "Run compile_requirements with write:true to generate requirements.md from prd/ sources.",
        }
  );

  return criteria;
}

export async function runGate2(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  // ── Primary: prd/ directory ─────────────────────────────────────────────────
  const prdDir = findPrdDir(specPath);
  if (prdDir) {
    criteria.push({ id: "P-1", status: "PASS", detail: `PRD directory found: ${prdDir}` });
    const text = readPrdFiles(prdDir);
    criteria.push(...runPrdChecks(text, prdDir, config));
    return { gate: "G2", name: "PRD Valid", status: buildGateStatus(criteria), criteria, durationMs: Date.now() - start };
  }

  // ── Backwards compat: legacy requirements.md ────────────────────────────────
  const reqFile = findFile(specPath, REQ_NAMES);
  if (reqFile) {
    criteria.push({
      id: "R-1",
      status: "WARNING",
      detail: `Legacy requirements.md found at ${reqFile}. Migrate to prd/ directory (one file per feature).`,
      fix: "Create a prd/ directory and split requirements.md into per-feature PRD files.",
    });
    const text = readFile(reqFile);
    const rules = extractRules(text);
    const examples = extractExamples(text);
    const allSteps = examples.flatMap((e) => e.steps);
    criteria.push(assessHierarchy(text));
    criteria.push(assessImperativeRules(rules, getThreshold(config, "R-3")));
    criteria.push(assessBddStructure(text));
    criteria.push(assessNegativeCoverage(examples, getThreshold(config, "R-5")));
    criteria.push(assessFeatureNegativeCoverage(examples));
    criteria.push(assessGivenSteps(allSteps, getThreshold(config, "R-7")));
    criteria.push(assessCompoundRules(rules, getThreshold(config, "R-8")));
    criteria.push(assessThenSteps(allSteps, getThreshold(config, "R-9")));
    criteria.push(assessImplementationLeakCriterion(text, getThreshold(config, "R-10")));
    return { gate: "G2", name: "PRD Valid", status: buildGateStatus(criteria), criteria, durationMs: Date.now() - start };
  }

  // ── Neither found: BLOCK ─────────────────────────────────────────────────────
  criteria.push({
    id: "P-1",
    status: "BLOCK",
    detail: "No prd/ directory found. Expected prd/ with at least one PRD file.",
    fix: "Create a prd/ directory and add PRD files using Feature/Rule/Example structure.",
  });
  return { gate: "G2", name: "PRD Valid", status: "BLOCKED", criteria, durationMs: Date.now() - start };
}
