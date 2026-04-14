// Gate 1 — Stories Valid
// Validates the stories/ directory: one file per user story, enforced structure + NLP.
// Backwards compatible: if stories/ is absent but intent.md exists, runs legacy I-* checks
// with a deprecation WARNING.
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { GateResult, CriterionResult, ResolvedConfig } from "../types.js";
import { validateArtifacts } from "../artifacts.js";
import {
  detectCausalLanguage,
  detectConstraintLanguage,
  detectSolutionBeforeProblem,
  detectImplementationLeak,
} from "../nlp.js";
import { getThreshold } from "../config.js";

const INTENT_NAMES = ["intent.md", "INTENT.md", "intent/intent.md", "INTENT/intent.md"];

function findStoriesDir(specPath: string): string | null {
  const dir = join(specPath, "stories");
  if (!existsSync(dir)) return null;
  try {
    return readdirSync(dir).some((f) => f.endsWith(".md")) ? dir : null;
  } catch {
    return null;
  }
}

function findIntentFile(specPath: string): string | null {
  for (const name of INTENT_NAMES) {
    const full = join(specPath, name);
    if (existsSync(full)) return full;
  }
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

function buildGateStatus(criteria: CriterionResult[]): GateResult["status"] {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

// Legacy intent.md path — kept for backwards compatibility, emits deprecation WARNING.
function runLegacyIntentChecks(intentFile: string, config: ResolvedConfig): CriterionResult[] {
  const criteria: CriterionResult[] = [];

  criteria.push({
    id: "I-1",
    status: "WARNING",
    detail: `Legacy intent.md found at ${intentFile}. Migrate to stories/ directory (one file per story).`,
    fix: "Create a stories/ directory and split intent.md into individual story files.",
  });

  const text = readFile(intentFile);

  const causal = detectCausalLanguage(text);
  const causalThreshold = getThreshold(config, "I-2");
  if (!causal.matched || causal.confidence < causalThreshold) {
    criteria.push({
      id: "I-2", status: "VIOLATION",
      detail: "Intent document lacks causal language explaining WHY this feature is needed.",
      evidence: causal.evidence, confidence: causal.confidence,
      fix: "Add causal language: 'because', 'in order to', 'the problem is', 'this enables', etc.",
    });
  } else {
    criteria.push({ id: "I-2", status: "PASS", detail: "Causal language detected.", evidence: causal.evidence, confidence: causal.confidence });
  }

  const constraint = detectConstraintLanguage(text);
  const constraintThreshold = getThreshold(config, "I-3");
  if (!constraint.matched || constraint.confidence < constraintThreshold) {
    criteria.push({
      id: "I-3", status: "VIOLATION",
      detail: "Intent document lacks constraint language defining boundaries.",
      evidence: constraint.evidence, confidence: constraint.confidence,
      fix: "Add constraints: 'must', 'required', 'no more than', 'only', 'limit', etc.",
    });
  } else {
    criteria.push({ id: "I-3", status: "PASS", detail: "Constraint language detected.", evidence: constraint.evidence, confidence: constraint.confidence });
  }

  const ordering = detectSolutionBeforeProblem(text);
  const orderingThreshold = getThreshold(config, "I-4");
  if (ordering.matched && ordering.confidence >= orderingThreshold) {
    criteria.push({
      id: "I-4", status: "VIOLATION",
      detail: "Solution language appears before problem language.",
      evidence: ordering.evidence, confidence: ordering.confidence,
      fix: "Reorder: describe the problem first, then the proposed solution.",
    });
  } else {
    criteria.push({ id: "I-4", status: "PASS", detail: "Problem precedes solution.", evidence: ordering.evidence, confidence: ordering.confidence });
  }

  const implLeak = detectImplementationLeak(text);
  const implThreshold = getThreshold(config, "I-5");
  if (implLeak.matched && implLeak.confidence >= implThreshold) {
    criteria.push({
      id: "I-5", status: "VIOLATION",
      detail: "Intent document contains implementation-specific language.",
      evidence: implLeak.evidence, confidence: implLeak.confidence,
      fix: "Remove framework names, PascalCase identifiers, SQL, and tool-specific references.",
    });
  } else if (implLeak.matched) {
    criteria.push({ id: "I-5", status: "WARNING", detail: "Possible implementation detail (below threshold).", evidence: implLeak.evidence, confidence: implLeak.confidence });
  } else {
    criteria.push({ id: "I-5", status: "PASS", detail: "No implementation leak detected." });
  }

  const hasAssumptions = /^#+\s*assumptions?\b/im.test(text);
  criteria.push(
    hasAssumptions
      ? { id: "I-6", status: "PASS", detail: "Assumptions section present." }
      : { id: "I-6", status: "VIOLATION", detail: "Intent document is missing an ## Assumptions section.", fix: "Add '## Assumptions' and list every inference not explicitly stated by the user." }
  );

  return criteria;
}

export async function runGate1(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();

  // ── Primary: stories/ directory ─────────────────────────────────────────────
  const storiesDir = findStoriesDir(specPath);
  if (storiesDir) {
    const summary = validateArtifacts(storiesDir, false, config);
    // Aggregate all per-file criteria into one flat list for the gate result
    const criteria: CriterionResult[] = summary.results.flatMap((r) => r.criteria);
    return {
      gate: "G1",
      name: "Stories Valid",
      status: buildGateStatus(criteria),
      criteria,
      durationMs: Date.now() - start,
    };
  }

  // ── Backwards compat: legacy intent.md ──────────────────────────────────────
  const intentFile = findIntentFile(specPath);
  if (intentFile) {
    const criteria = runLegacyIntentChecks(intentFile, config);
    return {
      gate: "G1",
      name: "Stories Valid",
      status: buildGateStatus(criteria),
      criteria,
      durationMs: Date.now() - start,
    };
  }

  // ── Neither found: BLOCK ─────────────────────────────────────────────────────
  return {
    gate: "G1",
    name: "Stories Valid",
    status: "BLOCKED",
    criteria: [{
      id: "S-1",
      status: "BLOCK",
      detail: "No stories/ directory found. Expected stories/ with at least one .md story file.",
      fix: "Create a stories/ directory and add story files using the enforced schema (Intent, Acceptance Criteria, ADR Required, Requirements, Assumptions).",
    }],
    durationMs: Date.now() - start,
  };
}
