// NLP Engine — stateless rule-based text analysis
// All functions return NLPResult: { matched, confidence, evidence }
// Threshold application is the caller's responsibility.
import type { NLPResult } from "./types.js";

// ─── Causal language (I-2) ────────────────────────────────────────────────────

const CAUSAL_SIGNALS = [
  /\bbecause\b/i,
  /\bin order to\b/i,
  /\bso that\b/i,
  /\bthe problem is\b/i,
  /\bcurrently\b/i,
  /\bwithout this\b/i,
  /\bthis prevents\b/i,
  /\bthe reason\b/i,
  /\bwe need\b/i,
  /\bthis enables\b/i,
  /\bthe challenge\b/i,
  /\bthis causes\b/i,
  /\btherefore\b/i,
];

export function detectCausalLanguage(text: string): NLPResult {
  const evidence: string[] = [];
  for (const pattern of CAUSAL_SIGNALS) {
    const m = text.match(pattern);
    if (m) evidence.push(m[0]);
  }
  const confidence = Math.min(evidence.length / 2, 1.0); // 2+ signals = full confidence
  return { matched: evidence.length > 0, confidence, evidence };
}

// ─── Constraint language (I-3) ───────────────────────────────────────────────

const CONSTRAINT_SIGNALS = [
  /\bmust\b/i, /\brequired\b/i, /\bshall\b/i, /\bconstrained?\b/i,
  /\bno more than\b/i, /\bat least\b/i, /\bonly\b/i,
  /\bno network\b/i, /\blocally?\b/i, /\bwithout\b/i,
  /\blimit(ed|s|ation)?\b/i, /\bboundary\b/i, /\brestrict(ed|ion)?\b/i,
];

export function detectConstraintLanguage(text: string): NLPResult {
  const evidence: string[] = [];
  for (const pattern of CONSTRAINT_SIGNALS) {
    const m = text.match(pattern);
    if (m) evidence.push(m[0]);
  }
  const confidence = Math.min(evidence.length / 2, 1.0);
  return { matched: evidence.length > 0, confidence, evidence };
}

// ─── Solution before problem (I-4) ───────────────────────────────────────────
// Heuristic: split into sentences. Find first "solution sentence" (contains
// build/implement/create/use) and first "problem sentence" (contains problem/challenge/issue).
// If solution comes before problem → violation.

const SOLUTION_WORDS = /\b(build|implement|create|develop|deploy|use|install|add|write|make|introduce)\b/i;
const PROBLEM_WORDS = /\b(problem|challenge|issue|bug|broken|inconsisten|failing|error|gap|miss|lack)\b/i;

export function detectSolutionBeforeProblem(text: string): NLPResult {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 10);
  let firstSolutionIdx = -1;
  let firstProblemIdx = -1;

  sentences.forEach((s, i) => {
    if (firstSolutionIdx === -1 && SOLUTION_WORDS.test(s)) firstSolutionIdx = i;
    if (firstProblemIdx === -1 && PROBLEM_WORDS.test(s)) firstProblemIdx = i;
  });

  // No problem found is itself a violation (handled by I-2); here we only care about ordering
  if (firstSolutionIdx === -1 || firstProblemIdx === -1) {
    return { matched: false, confidence: 0.3, evidence: [] };
  }

  const violated = firstSolutionIdx < firstProblemIdx;
  return {
    matched: violated,
    confidence: violated ? 0.8 : 0,
    evidence: violated
      ? [`Solution language at sentence ${firstSolutionIdx + 1}, problem at ${firstProblemIdx + 1}`]
      : [],
  };
}

// ─── Implementation leak (I-5, R-10) ─────────────────────────────────────────

const IMPL_PATTERNS: Array<[RegExp, string]> = [
  [/\b[A-Z][a-z]+(?:[A-Z][a-z]*){2,}\b/g, "PascalCase identifier"],
  [/\b[a-z]+(?:_[a-z]+){2,}\b/g, "snake_case (3+ segments)"],
  [/\b(React|Vue|Angular|Svelte|Next\.?js|Nuxt|Vite|Webpack|Rollup|esbuild)\b/g, "frontend framework"],
  [/\b(Express|Fastify|Hono|NestJS|Django|FastAPI|Flask|Spring|Rails)\b/g, "web framework"],
  [/\b(PostgreSQL|MySQL|MongoDB|Redis|DynamoDB|Firestore|SQLite|Cassandra)\b/g, "database name"],
  [/\b(Kubernetes|kubectl|Helm|Docker|Terraform|Ansible|Pulumi)\b/g, "infrastructure tool"],
  [/\b(useState|useEffect|useCallback|useMemo|useRef|@Entity|@Column)\b/g, "framework annotation"],
  [/\bSELECT\s+\w+\s+FROM\b/i, "SQL statement"],
];

const PUBLIC_PROTOCOL_IDENTIFIERS = new Set([
  "agent_id",
  "agent_kind",
  "parent_agent_id",
  "session_id",
  "run_id",
  "begin_session",
  "check_mutation_score",
  "close_session",
  "get_next_action",
  "list_agent_state",
  "must_call_next",
  "report_agent_state",
  "should_call_metrics",
  "must_report_state",
  "blocked_by",
]);

function filterPublicProtocolIdentifiers(matches: string[]): string[] {
  return matches.filter((match) => !PUBLIC_PROTOCOL_IDENTIFIERS.has(match));
}

export function detectImplementationLeak(text: string): NLPResult {
  const evidence: string[] = [];
  for (const [pattern, label] of IMPL_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      const filtered = filterPublicProtocolIdentifiers([...new Set(matches)]);
      if (filtered.length === 0) continue;
      evidence.push(`${label}: ${filtered.slice(0, 3).join(", ")}`);
    }
  }
  const confidence = Math.min(evidence.length / 2, 1.0);
  return { matched: evidence.length > 0, confidence, evidence };
}

// ─── Imperative verb (R-3) ───────────────────────────────────────────────────

const IMPERATIVE_VERBS = new Set([
  "accept", "reject", "show", "hide", "send", "create", "delete",
  "validate", "check", "return", "fetch", "update", "insert", "save",
  "render", "display", "load", "redirect", "trigger", "emit", "fire",
  "generate", "build", "process", "handle", "execute", "run", "call",
]);

export function detectImperativeVerb(ruleText: string): NLPResult {
  const firstWord = ruleText.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (firstWord && IMPERATIVE_VERBS.has(firstWord)) {
    return { matched: true, confidence: 0.9, evidence: [firstWord] };
  }
  return { matched: false, confidence: 0, evidence: [] };
}

// ─── Action verb in GIVEN (R-7) ──────────────────────────────────────────────

const ACTION_VERBS = [
  /\bclick(s|ed)?\b/i, /\bsubmit(s|ted)?\b/i, /\benter(s|ed)?\b/i,
  /\btype(s|d)?\b/i, /\bsend(s|sent)?\b/i,
  /\bnavigate(s|d)?\b/i, /\brequest(s|ed)?\b/i, /\btrigger(s|ed)?\b/i,
  /\bpress(es|ed)?\b/i, /\bselect(s|ed)?\b/i,
  /\bfill(s|ed)?\b/i,
];

export function detectActionVerbInGiven(stepText: string): NLPResult {
  const evidence: string[] = [];
  for (const pattern of ACTION_VERBS) {
    const m = stepText.match(pattern);
    if (m) evidence.push(m[0]);
  }
  return {
    matched: evidence.length > 0,
    confidence: evidence.length > 0 ? 0.85 : 0,
    evidence,
  };
}

// ─── Compound clause (R-8, T-2) ──────────────────────────────────────────────
// Detect "and" joining two verb phrases. Simplified: look for verb ... and ... verb
// Pattern: word boundary "and" between two phrases each containing a verb indicator.

const COMPOUND_AND = /\b(\w+(?:s|es|ed|ing))\b.{3,60}\band\b.{3,60}\b(\w+(?:s|es|ed|ing))\b/i;

export function detectCompoundClause(text: string): NLPResult {
  const m = text.match(COMPOUND_AND);
  if (m) {
    return {
      matched: true,
      confidence: 0.75,
      evidence: [`compound junction: "...${m[1]}... and ...${m[2]}..."`],
    };
  }
  // Simpler fallback: " and " with both sides having verbs
  if (/\band\b/i.test(text)) {
    const parts = text.split(/\band\b/i);
    if (parts.length >= 2) {
      const hasVerbPattern = /\b(is|are|was|were|has|have|will|should|can|could|would|must|shall)\b|\w+(s|es|ed|ing)\b/i;
      if (parts.every((p) => hasVerbPattern.test(p))) {
        return { matched: true, confidence: 0.6, evidence: [`compound "and" detected`] };
      }
    }
  }
  return { matched: false, confidence: 0, evidence: [] };
}

// ─── Internal state in THEN (R-9) ────────────────────────────────────────────

const INTERNAL_STATE_PATTERNS = [
  /\bthe database (contains?|has|stores?)\b/i,
  /\bthe function returns?\b/i,
  /\bthe variable\b/i,
  /\bthe object has\b/i,
  /\bthe cache\b/i,
  /\binternal(ly)?\b/i,
  /\bthe log(ger)?\b/i,
  /\bthe queue (contains?|has)\b/i,
  /\bthe record (is|was|has been) (inserted|updated|deleted|saved)\b/i,
  /\bin memory\b/i,
  /\bthe store (contains?|has)\b/i,
];

export function detectInternalState(stepText: string): NLPResult {
  const evidence: string[] = [];
  for (const pattern of INTERNAL_STATE_PATTERNS) {
    const m = stepText.match(pattern);
    if (m) evidence.push(m[0]);
  }
  return {
    matched: evidence.length > 0,
    confidence: evidence.length > 0 ? 0.85 : 0,
    evidence,
  };
}

// ─── Component language (D-3) ────────────────────────────────────────────────

const COMPONENT_SIGNALS = [
  /\bservice\b/i, /\bmodule\b/i, /\bcomponent\b/i, /\bdatabase\b/i,
  /\bAPI\b/i, /\blayer\b/i, /\bboundary\b/i, /\binterface\b/i,
  /\bhandler\b/i, /\bworker\b/i, /\bqueue\b/i, /\bstore\b/i,
  /\bengine\b/i, /\bpipeline\b/i, /\brouter\b/i, /\bgateway\b/i,
  /\borchestrat(or|ion)\b/i, /\barchitect(ure|ural)\b/i,
];

export function detectComponentLanguage(text: string): NLPResult {
  const evidence: string[] = [];
  for (const pattern of COMPONENT_SIGNALS) {
    const m = text.match(pattern);
    if (m) evidence.push(m[0]);
  }
  const confidence = Math.min(evidence.length / 3, 1.0);
  return { matched: evidence.length >= 2, confidence, evidence };
}

// ─── Negation proximity (D-4) ────────────────────────────────────────────────
// Check if design statements negate terms from requirement rules.

const NEGATION_WORDS = /\b(not|never|without|no |don't|doesn't|cannot|won't|isn't|aren't)\b/i;

export function detectNegationProximity(
  designText: string,
  ruleTerms: string[]
): NLPResult {
  const evidence: string[] = [];
  const sentences = designText.split(/(?<=[.!?])\s+|\n+/);

  for (const sentence of sentences) {
    if (!NEGATION_WORDS.test(sentence)) continue;
    for (const term of ruleTerms) {
      if (sentence.toLowerCase().includes(term.toLowerCase())) {
        evidence.push(`"${sentence.trim().slice(0, 80)}" (term: "${term}")`);
      }
    }
  }

  return {
    matched: evidence.length > 0,
    confidence: evidence.length > 0 ? 0.6 : 0,
    evidence,
  };
}

// ─── Certainty language in assumptions (AS-3) ────────────────────────────────

const CERTAINTY_SIGNALS = [
  /\bwill\b/i, /\balways\b/i, /\bthe system uses\b/i,
  /\busers expect\b/i, /\bneverfails\b/i,
  /\bis (definitely|certainly|always)\b/i,
  /\bguaranteed\b/i,
];

const HEDGING_SIGNALS = [
  /\bassumed\b/i, /\bnot specified\b/i, /\bdefaulted to\b/i,
  /\bchosen because\b/i, /\binferred\b/i, /\blikely\b/i,
  /\bprobably\b/i, /\bexpected\b/i, /\btypically\b/i,
];

export function detectCertaintyLanguage(assumptionText: string): NLPResult {
  const hasHedge = HEDGING_SIGNALS.some((p) => p.test(assumptionText));
  if (hasHedge) return { matched: false, confidence: 0, evidence: [] };

  const evidence: string[] = [];
  for (const pattern of CERTAINTY_SIGNALS) {
    const m = assumptionText.match(pattern);
    if (m) evidence.push(m[0]);
  }
  return {
    matched: evidence.length > 0,
    confidence: evidence.length > 0 ? 0.8 : 0,
    evidence,
  };
}

// ─── Error/negative scenario signals (R-5) ───────────────────────────────────

const ERROR_SIGNALS = [
  /\berror\b/i, /\binvalid\b/i, /\breject(s|ed)?\b/i, /\bfail(s|ed|ure)?\b/i,
  /\bnot found\b/i, /\bunauthori[sz]ed\b/i, /\bforbidden\b/i,
  /\bdeny|denied\b/i, /\bduplicate\b/i, /\bexceed(s|ed)?\b/i,
  /\bmissing\b/i, /\bempty\b/i, /\bnot allowed\b/i,
];

export function detectErrorScenario(exampleText: string): NLPResult {
  const evidence: string[] = [];
  for (const pattern of ERROR_SIGNALS) {
    const m = exampleText.match(pattern);
    if (m) evidence.push(m[0]);
  }
  return {
    matched: evidence.length > 0,
    confidence: Math.min(evidence.length / 2, 1.0),
    evidence,
  };
}

// ─── Compound task (T-2) ─────────────────────────────────────────────────────
// Flag "and" that joins two verb phrases in a task description.

export function detectCompoundTask(taskText: string): NLPResult {
  // Remove markdown checkbox prefix
  const clean = taskText.replace(/^[-*]\s*\[[x ]\]\s*/i, "").trim();

  if (!/\band\b/i.test(clean)) return { matched: false, confidence: 0, evidence: [] };

  const parts = clean.split(/\band\b/i);
  const verbLike = /\b(create|write|add|update|implement|build|test|fix|run|check|validate|generate|configure|set|install|remove|delete|deploy|integrate|connect|define|register|parse|format|render|handle|process)\b/i;

  const bothHaveVerb = parts.length >= 2 && parts.slice(0, 2).every((p) => verbLike.test(p));
  if (bothHaveVerb) {
    return {
      matched: true,
      confidence: 0.8,
      evidence: [`compound task: "${clean.slice(0, 80)}"`],
    };
  }
  return { matched: false, confidence: 0, evidence: [] };
}
