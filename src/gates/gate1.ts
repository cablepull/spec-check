// Gate 1 — Intent Valid
// Checks I-1 through I-6 against the intent document.
// Assumption: intent document is named intent.md, INTENT.md, or INTENT/intent.md
//   under the specPath (inferred from project root). Assumed because no naming
//   convention is mandated in the PRD beyond "intent document".
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { GateResult, CriterionResult, ResolvedConfig } from "../types.js";
import {
  detectCausalLanguage,
  detectConstraintLanguage,
  detectSolutionBeforeProblem,
  detectImplementationLeak,
} from "../nlp.js";
import { getThreshold } from "../config.js";

const INTENT_NAMES = ["intent.md", "INTENT.md", "intent/intent.md", "INTENT/intent.md"];

function findIntentFile(specPath: string): string | null {
  for (const name of INTENT_NAMES) {
    const full = join(specPath, name);
    if (existsSync(full)) return full;
  }
  // Scan one level for anything matching
  try {
    for (const entry of readdirSync(specPath)) {
      if (/^intent\.md$/i.test(entry)) return join(specPath, entry);
    }
  } catch {}
  return null;
}

function readFile(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

export async function runGate1(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  // ── I-1: Intent document exists ────────────────────────────────────────────
  const intentFile = findIntentFile(specPath);
  if (!intentFile) {
    criteria.push({
      id: "I-1",
      status: "BLOCK",
      detail: "No intent document found. Expected intent.md under the spec path.",
      fix: "Create intent.md describing WHY this feature is needed.",
    });
    return {
      gate: "G1",
      name: "Intent Valid",
      status: "BLOCKED",
      criteria,
      durationMs: Date.now() - start,
    };
  }

  criteria.push({ id: "I-1", status: "PASS", detail: `Intent document found: ${intentFile}` });

  const text = readFile(intentFile);

  // ── I-2: Causal language present ───────────────────────────────────────────
  const causal = detectCausalLanguage(text);
  const causalThreshold = getThreshold(config, "I-2");
  if (!causal.matched || causal.confidence < causalThreshold) {
    criteria.push({
      id: "I-2",
      status: "VIOLATION",
      detail: "Intent document lacks causal language explaining WHY this feature is needed.",
      evidence: causal.evidence,
      confidence: causal.confidence,
      fix: "Add causal language: 'because', 'in order to', 'the problem is', 'this enables', etc.",
    });
  } else {
    criteria.push({
      id: "I-2",
      status: "PASS",
      detail: "Causal language detected.",
      evidence: causal.evidence,
      confidence: causal.confidence,
    });
  }

  // ── I-3: Constraint language present ───────────────────────────────────────
  const constraint = detectConstraintLanguage(text);
  const constraintThreshold = getThreshold(config, "I-3");
  if (!constraint.matched || constraint.confidence < constraintThreshold) {
    criteria.push({
      id: "I-3",
      status: "VIOLATION",
      detail: "Intent document lacks constraint language defining boundaries.",
      evidence: constraint.evidence,
      confidence: constraint.confidence,
      fix: "Add constraints: 'must', 'required', 'no more than', 'only', 'limit', etc.",
    });
  } else {
    criteria.push({
      id: "I-3",
      status: "PASS",
      detail: "Constraint language detected.",
      evidence: constraint.evidence,
      confidence: constraint.confidence,
    });
  }

  // ── I-4: Solution not described before problem ──────────────────────────────
  const ordering = detectSolutionBeforeProblem(text);
  const orderingThreshold = getThreshold(config, "I-4");
  if (ordering.matched && ordering.confidence >= orderingThreshold) {
    criteria.push({
      id: "I-4",
      status: "VIOLATION",
      detail: "Solution language appears before problem language.",
      evidence: ordering.evidence,
      confidence: ordering.confidence,
      fix: "Reorder: describe the problem first, then the proposed solution.",
    });
  } else {
    criteria.push({
      id: "I-4",
      status: "PASS",
      detail: "Problem precedes solution (or ordering is acceptable).",
      evidence: ordering.evidence,
      confidence: ordering.confidence,
    });
  }

  // ── I-5: No implementation leak ────────────────────────────────────────────
  const implLeak = detectImplementationLeak(text);
  const implThreshold = getThreshold(config, "I-5");
  if (implLeak.matched && implLeak.confidence >= implThreshold) {
    criteria.push({
      id: "I-5",
      status: "VIOLATION",
      detail: "Intent document contains implementation-specific language.",
      evidence: implLeak.evidence,
      confidence: implLeak.confidence,
      fix: "Remove framework names, PascalCase identifiers, SQL, and tool-specific references from the intent.",
    });
  } else if (implLeak.matched) {
    criteria.push({
      id: "I-5",
      status: "WARNING",
      detail: "Possible implementation detail detected (below violation threshold).",
      evidence: implLeak.evidence,
      confidence: implLeak.confidence,
    });
  } else {
    criteria.push({ id: "I-5", status: "PASS", detail: "No implementation leak detected." });
  }

  // ── I-6: Assumptions section present ───────────────────────────────────────
  const hasAssumptions = /^#+\s*assumptions?\b/im.test(text);
  if (!hasAssumptions) {
    criteria.push({
      id: "I-6",
      status: "VIOLATION",
      detail: "Intent document is missing an ## Assumptions section.",
      fix: "Add '## Assumptions' and list every inference not explicitly stated by the user.",
    });
  } else {
    criteria.push({ id: "I-6", status: "PASS", detail: "Assumptions section present." });
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

  return { gate: "G1", name: "Intent Valid", status, criteria, durationMs: Date.now() - start };
}
