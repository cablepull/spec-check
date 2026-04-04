// Gate 2 — Requirements Valid
// Checks R-1 through R-10 against the requirements document(s).
// Assumption: requirements file is named requirements.md, REQUIREMENTS.md, or
//   similar under specPath. Stories directory (stories/*.md) is also scanned for
//   Given/When/Then checks where applicable.
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

export async function runGate2(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  // ── R-1: Requirements file exists ──────────────────────────────────────────
  const reqFile = findFile(specPath, REQ_NAMES);
  if (!reqFile) {
    criteria.push({
      id: "R-1",
      status: "BLOCK",
      detail: "No requirements document found. Expected requirements.md under the spec path.",
      fix: "Create requirements.md with Feature/Rule/Example structure.",
    });
    return {
      gate: "G2",
      name: "Requirements Valid",
      status: "BLOCKED",
      criteria,
      durationMs: Date.now() - start,
    };
  }

  criteria.push({ id: "R-1", status: "PASS", detail: `Requirements document found: ${reqFile}` });

  const text = readFile(reqFile);

  // ── R-2: Feature/Rule/Example hierarchy ─────────────────────────────────────
  const hasFeature = /^#{1,3}\s+Feature\s+F-\d+/im.test(text);
  const hasRule = /Rule\s+R-\d+/i.test(text);
  const hasExample =
    /^\s*(?:#{1,6}\s+)?(Example|Scenario)\b/im.test(text) ||
    /\b(Given|When|Then)\b/i.test(text);

  if (!hasFeature || !hasRule || !hasExample) {
    criteria.push({
      id: "R-2",
      status: "VIOLATION",
      detail: `Requirements hierarchy incomplete. Feature: ${hasFeature}, Rule: ${hasRule}, Example: ${hasExample}`,
      fix: "Ensure requirements use ## Feature F-N / Rule R-N / #### Example structure with Given/When/Then.",
    });
  } else {
    criteria.push({ id: "R-2", status: "PASS", detail: "Feature/Rule/Example hierarchy detected." });
  }

  // ── R-3: Rules start with imperative verb ────────────────────────────────────
  const rules = extractRules(text);
  const r3Threshold = getThreshold(config, "R-3");
  const nonImperative: string[] = [];
  let r3Pass = 0;

  for (const rule of rules) {
    const result = detectImperativeVerb(rule.text);
    if (result.matched && result.confidence >= r3Threshold) {
      r3Pass++;
    } else {
      nonImperative.push(`${rule.id}: "${rule.text.slice(0, 60)}"`);
    }
  }

  if (rules.length === 0) {
    criteria.push({ id: "R-3", status: "WARNING", detail: "No parseable rules found to check for imperative verbs." });
  } else if (nonImperative.length > 0) {
    criteria.push({
      id: "R-3",
      status: "VIOLATION",
      detail: `${nonImperative.length} rule(s) do not begin with an imperative verb.`,
      evidence: nonImperative.slice(0, 5),
      fix: "Rules must start with: accept, reject, show, send, create, validate, fetch, etc.",
    });
  } else {
    criteria.push({ id: "R-3", status: "PASS", detail: `All ${rules.length} rules start with imperative verbs.` });
  }

  // ── R-4: Examples use Given/When/Then ────────────────────────────────────────
  const hasGiven = /\bGiven\b/i.test(text);
  const hasWhen = /\bWhen\b/i.test(text);
  const hasThen = /\bThen\b/i.test(text);
  if (!hasGiven || !hasWhen || !hasThen) {
    criteria.push({
      id: "R-4",
      status: "VIOLATION",
      detail: `Examples missing BDD structure. Given: ${hasGiven}, When: ${hasWhen}, Then: ${hasThen}`,
      fix: "Format examples using Given/When/Then steps.",
    });
  } else {
    criteria.push({ id: "R-4", status: "PASS", detail: "Given/When/Then structure detected." });
  }

  // ── R-5: Negative scenario coverage ─────────────────────────────────────────
  const examples = extractExamples(text);
  const r5Threshold = getThreshold(config, "R-5");
  const negativeExamples = examples.filter((e) => e.isNegative);

  if (examples.length > 0 && negativeExamples.length === 0) {
    // Check if error language appears in any step text
    const allStepText = examples.flatMap((e) => e.steps).map((s) => s.text).join(" ");
    const errorResult = detectErrorScenario(allStepText);
    if (!errorResult.matched || errorResult.confidence < r5Threshold) {
      criteria.push({
        id: "R-5",
        status: "VIOLATION",
        detail: "No negative/error scenarios found in examples.",
        fix: "Add at least one negative example per feature covering invalid input, error, or rejection cases.",
      });
    } else {
      criteria.push({ id: "R-5", status: "PASS", detail: "Error/negative language detected in examples.", evidence: errorResult.evidence });
    }
  } else if (negativeExamples.length > 0) {
    criteria.push({ id: "R-5", status: "PASS", detail: `${negativeExamples.length} negative scenario(s) found.` });
  } else {
    criteria.push({ id: "R-5", status: "WARNING", detail: "No parseable examples found; could not verify negative scenario coverage." });
  }

  // ── R-6: Each feature has at least one negative example ─────────────────────
  const featureIds = [...new Set(examples.map((e) => e.featureId).filter((id) => id !== "unknown"))];
  const featuresWithoutNeg = featureIds.filter(
    (fid) => !examples.some((e) => e.featureId === fid && e.isNegative)
  );
  if (featureIds.length > 0 && featuresWithoutNeg.length > 0) {
    criteria.push({
      id: "R-6",
      status: "VIOLATION",
      detail: `${featuresWithoutNeg.length} feature(s) have no negative example.`,
      evidence: featuresWithoutNeg,
      fix: "Add at least one negative/error example to each feature.",
    });
  } else if (featureIds.length > 0) {
    criteria.push({ id: "R-6", status: "PASS", detail: "All features have at least one negative example." });
  } else {
    criteria.push({ id: "R-6", status: "WARNING", detail: "Could not parse feature IDs from examples." });
  }

  // ── R-7: GIVEN has no action verbs ───────────────────────────────────────────
  const allSteps = examples.flatMap((e) => e.steps);
  const givenSteps = allSteps.filter((s) => s.type === "GIVEN");
  const r7Threshold = getThreshold(config, "R-7");
  const badGivens: string[] = [];
  for (const step of givenSteps) {
    const normalized = step.text.replace(/`[^`]+`/g, "").replace(/"[^"]+"/g, "");
    const result = detectActionVerbInGiven(normalized);
    if (result.matched && result.confidence >= r7Threshold) {
      badGivens.push(`"${step.text.slice(0, 60)}" (${result.evidence.join(", ")})`);
    }
  }
  if (badGivens.length > 0) {
    criteria.push({
      id: "R-7",
      status: "VIOLATION",
      detail: `${badGivens.length} GIVEN step(s) contain action verbs (GIVEN describes state, not action).`,
      evidence: badGivens.slice(0, 5),
      fix: "Replace action verbs in GIVEN with state descriptions: 'the user is logged in' not 'the user clicks login'.",
    });
  } else if (givenSteps.length === 0) {
    criteria.push({ id: "R-7", status: "WARNING", detail: "No GIVEN steps found to check." });
  } else {
    criteria.push({ id: "R-7", status: "PASS", detail: `All ${givenSteps.length} GIVEN step(s) are state descriptions.` });
  }

  // ── R-8: No compound clauses in rules ────────────────────────────────────────
  const r8Threshold = getThreshold(config, "R-8");
  const compoundRules: string[] = [];
  for (const rule of rules) {
    const result = detectCompoundClause(rule.text);
    if (result.matched && result.confidence >= r8Threshold) {
      compoundRules.push(`${rule.id}: "${rule.text.slice(0, 60)}" — ${result.evidence[0]}`);
    }
  }
  if (compoundRules.length > 0) {
    criteria.push({
      id: "R-8",
      status: "VIOLATION",
      detail: `${compoundRules.length} rule(s) contain compound clauses joined by 'and'.`,
      evidence: compoundRules.slice(0, 5),
      fix: "Split compound rules: one rule = one behaviour.",
    });
  } else {
    criteria.push({ id: "R-8", status: "PASS", detail: "No compound rule clauses detected." });
  }

  // ── R-9: THEN has no internal state ──────────────────────────────────────────
  const thenSteps = allSteps.filter((s) => s.type === "THEN");
  const r9Threshold = getThreshold(config, "R-9");
  const badThens: string[] = [];
  for (const step of thenSteps) {
    const result = detectInternalState(step.text);
    if (result.matched && result.confidence >= r9Threshold) {
      badThens.push(`"${step.text.slice(0, 60)}" (${result.evidence.join(", ")})`);
    }
  }
  if (badThens.length > 0) {
    criteria.push({
      id: "R-9",
      status: "VIOLATION",
      detail: `${badThens.length} THEN step(s) reference internal state (should reference observable output only).`,
      evidence: badThens.slice(0, 5),
      fix: "THEN should describe user-observable outcomes, not internal system state.",
    });
  } else if (thenSteps.length === 0) {
    criteria.push({ id: "R-9", status: "WARNING", detail: "No THEN steps found to check." });
  } else {
    criteria.push({ id: "R-9", status: "PASS", detail: `All ${thenSteps.length} THEN step(s) are observable.` });
  }

  // ── R-10: No implementation leak in requirements ──────────────────────────────
  const r10Threshold = getThreshold(config, "R-10");
  const implLeak = detectImplementationLeak(text);
  if (implLeak.matched && implLeak.confidence >= r10Threshold) {
    criteria.push({
      id: "R-10",
      status: "VIOLATION",
      detail: "Requirements contain implementation-specific language.",
      evidence: implLeak.evidence,
      confidence: implLeak.confidence,
      fix: "Remove framework/library names, SQL, identifiers. Requirements describe WHAT, not HOW.",
    });
  } else if (implLeak.matched) {
    criteria.push({
      id: "R-10",
      status: "WARNING",
      detail: "Possible implementation detail (below violation threshold).",
      evidence: implLeak.evidence,
      confidence: implLeak.confidence,
    });
  } else {
    criteria.push({ id: "R-10", status: "PASS", detail: "No implementation leak in requirements." });
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

  return { gate: "G2", name: "Requirements Valid", status, criteria, durationMs: Date.now() - start };
}
