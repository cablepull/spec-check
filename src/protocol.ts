// Story 002 — get_protocol
// Returns a self-describing protocol document so any LLM can orient itself
// without relying on stale training data.
// Assumption: protocol version is derived from package.json version at runtime.
//   Chosen because a separate protocol version constant would diverge from the package.
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    if (!existsSync(pkgPath)) return "0.0.0";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface ProtocolDoc {
  version: string;
  name: string;
  description: string;
  philosophy: string;
  workflow: WorkflowStep[];
  gates: GateSpec[];
  tools: ToolSpec[];
  severityLevels: SeveritySpec[];
  assumptionRequirement: string;
  identityResolution: string[];
  thresholds: ThresholdDoc;
}

interface WorkflowStep {
  step: number;
  gate: string;
  name: string;
  summary: string;
  blockedBy: string;
}

interface GateSpec {
  id: string;
  name: string;
  artifact: string;
  criteriaIds: string[];
  failureMeaning: string;
}

interface ToolSpec {
  name: string;
  description: string;
  requiredArgs: string[];
  optionalArgs: string[];
  returns: string;
}

interface SeveritySpec {
  level: string;
  meaning: string;
  effect: string;
}

interface ThresholdDoc {
  description: string;
  defaults: Record<string, number>;
  configKey: string;
}

export function buildProtocol(): ProtocolDoc {
  return {
    version: readPackageVersion(),
    name: "spec-check",
    description:
      "A local MCP gate-keeper that enforces spec-driven development methodology. " +
      "Every feature must flow through the 5-gate sequence before implementation begins.",
    philosophy:
      "Problem before solution. Requirements before design. " +
      "Assumptions must be explicit. One rule = one behaviour. " +
      "The gate is deterministic and never requires human approval of individual checks — " +
      "it closes the correction loop so you can iterate autonomously.",

    workflow: [
      {
        step: 1,
        gate: "G1",
        name: "Intent Valid",
        summary:
          "Write intent.md describing WHY the feature is needed, with causal language, " +
          "constraints, problem-first ordering, no implementation details, and an ## Assumptions section.",
        blockedBy: "Missing intent.md",
      },
      {
        step: 2,
        gate: "G2",
        name: "Requirements Valid",
        summary:
          "Write requirements.md using Feature/Rule/Example hierarchy. " +
          "Rules must start with imperative verbs, have no compound clauses, " +
          "GIVEN must be state-only, THEN must be observable, negative examples required.",
        blockedBy: "Missing requirements.md or G1 not passing",
      },
      {
        step: 3,
        gate: "G3",
        name: "Design Valid",
        summary:
          "Write design.md referencing all requirement IDs (F-N, R-N), " +
          "using component/architecture language, and documenting design assumptions.",
        blockedBy: "Missing design.md or G2 not passing",
      },
      {
        step: 4,
        gate: "G4",
        name: "Tasks Valid",
        summary:
          "Write tasks.md as atomic checkbox items, each tracing to a spec ID, " +
          "no compound tasks (split 'and'-joined items), and an ## Assumptions section.",
        blockedBy: "Missing tasks.md or G3 not passing",
      },
      {
        step: 5,
        gate: "G5",
        name: "Executability Valid",
        summary:
          "Project must have test files, each requirements Rule must have a corresponding test, " +
          "and tests should use spec-style language such as Given/When/Then or Scenario wording.",
        blockedBy: "G4 not passing",
      },
    ],

    gates: [
      {
        id: "G1",
        name: "Intent Valid",
        artifact: "intent.md",
        criteriaIds: ["I-1", "I-2", "I-3", "I-4", "I-5", "I-6"],
        failureMeaning:
          "The feature's purpose is insufficiently documented. " +
          "Implementation must not start — there is no clear 'why'.",
      },
      {
        id: "G2",
        name: "Requirements Valid",
        artifact: "requirements.md",
        criteriaIds: ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7", "R-8", "R-9", "R-10"],
        failureMeaning:
          "Requirements are ambiguous, incomplete, or structurally incorrect. " +
          "Design cannot begin.",
      },
      {
        id: "G3",
        name: "Design Valid",
        artifact: "design.md",
        criteriaIds: ["D-1", "D-2", "D-3", "D-4", "D-5"],
        failureMeaning:
          "Design does not trace to requirements or lacks architectural clarity. " +
          "Task breakdown cannot begin.",
      },
      {
        id: "G4",
        name: "Tasks Valid",
        artifact: "tasks.md",
        criteriaIds: ["T-1", "T-2", "T-3", "T-4", "T-5"],
        failureMeaning:
          "Tasks are non-atomic, untraceable, or vague. " +
          "Implementation cannot begin.",
      },
      {
        id: "G5",
        name: "Executability Valid",
        artifact: "project root",
        criteriaIds: ["E-1", "E-2", "E-3"],
        failureMeaning:
          "The spec is not executable through tests. " +
          "Implementation cannot be treated as verifiable until test presence and Rule coverage exist.",
      },
    ],

    tools: [
      {
        name: "gate_check",
        description: "Run a single gate check (G1–G5) against a spec path.",
        requiredArgs: ["path", "gate"],
        optionalArgs: ["llm", "format"],
        returns: "GateResult with criteria, status, and next steps",
      },
      {
        name: "run_all",
        description:
          "Run all five gates sequentially. Stops at first BLOCKED gate. " +
          "Returns RunResult with per-gate details and consolidated next steps.",
        requiredArgs: ["path"],
        optionalArgs: ["llm", "format"],
        returns: "RunResult",
      },
      {
        name: "get_protocol",
        description:
          "Return this self-describing protocol document. " +
          "Always call this first in a new session to orient yourself.",
        requiredArgs: [],
        optionalArgs: ["format"],
        returns: "ProtocolDoc (JSON or Markdown)",
      },
      {
        name: "validate_artifact",
        description: "Validate a single spec artifact (intent, requirements, design, tasks, story, adr, rca).",
        requiredArgs: ["artifact_path"],
        optionalArgs: ["llm", "format"],
        returns: "CriterionResult[]",
      },
      {
        name: "check_assumptions",
        description: "Validate the assumptions section of a single artifact, including certainty-language and supersession checks.",
        requiredArgs: ["artifact_path"],
        optionalArgs: ["format"],
        returns: "AssumptionValidationResult",
      },
      {
        name: "track_assumption",
        description: "Register an assumption in the assumption registry for a spec artifact.",
        requiredArgs: ["artifact_path", "name"],
        optionalArgs: ["reason", "llm"],
        returns: "Confirmation with assumption ID",
      },
      {
        name: "invalidate_assumption",
        description: "Mark an assumption as invalidated, triggering supersession of affected artifacts.",
        requiredArgs: ["artifact_path", "assumption_id", "reason"],
        optionalArgs: ["llm"],
        returns: "SupersessionEvent",
      },
      {
        name: "list_assumptions",
        description: "List all tracked assumptions for a spec path, optionally including archived.",
        requiredArgs: ["path"],
        optionalArgs: ["include_archived", "format"],
        returns: "Assumption[]",
      },
      {
        name: "get_assumption_metrics",
        description: "Return per-project assumption invalidation, category, and model metrics.",
        requiredArgs: [],
        optionalArgs: ["path", "since", "format"],
        returns: "AssumptionMetricsReport",
      },
      {
        name: "get_supersession_history",
        description: "Return supersession events for a project or subtree, optionally filtered by date.",
        requiredArgs: ["path"],
        optionalArgs: ["since", "artifact_type", "format"],
        returns: "SupersessionEvent[]",
      },
      {
        name: "diff_check",
        description: "Analyse git diff to determine which spec gates need re-running.",
        requiredArgs: ["path"],
        optionalArgs: ["base", "since", "format"],
        returns: "DiffResult with affected gates and ADR trigger status",
      },
      {
        name: "complexity",
        description: "Run cyclomatic/cognitive complexity and nesting depth analysis on source files.",
        requiredArgs: ["path"],
        optionalArgs: ["llm", "format"],
        returns: "ComplexityResult[]",
      },
      {
        name: "check_dependencies",
        description: "Report installed and missing external analysis tools, runtime prerequisites, and install guidance.",
        requiredArgs: [],
        optionalArgs: ["path", "format"],
        returns: "Dependency status report",
      },
      {
        name: "check_mutation_score",
        description: "Run mutation testing on a project/file/directory scope, persist the result, and report threshold/trend violations.",
        requiredArgs: ["path"],
        optionalArgs: ["llm", "format"],
        returns: "MutationReport",
      },
      {
        name: "install_dependency",
        description: "Install one named dependency with structured failure analysis and post-install verification.",
        requiredArgs: ["name"],
        optionalArgs: ["path", "format"],
        returns: "Install success or InstallFailure",
      },
      {
        name: "get_rollup",
        description: "Return cross-project rollup metrics and model rankings across the entire storage root.",
        requiredArgs: [],
        optionalArgs: ["since", "format"],
        returns: "RollupMetricsReport",
      },
      {
        name: "metrics",
        description: "Query stored compliance metrics for a project or cross-project rollup.",
        requiredArgs: [],
        optionalArgs: ["path", "since", "format"],
        returns: "MetricsReport",
      },
    ],

    severityLevels: [
      {
        level: "BLOCK",
        meaning: "A required artifact is entirely missing.",
        effect: "Gate returns BLOCKED. All subsequent gates are skipped. You must create the artifact.",
      },
      {
        level: "VIOLATION",
        meaning: "An artifact exists but fails a structural or quality rule.",
        effect: "Gate returns FAILING. You must fix the violation before proceeding.",
      },
      {
        level: "WARNING",
        meaning: "A heuristic check found a potential issue but confidence is below threshold.",
        effect: "Gate returns PASSING_WITH_WARNINGS. You may proceed but should review.",
      },
      {
        level: "PASS",
        meaning: "All checks passed.",
        effect: "Gate returns PASS. You may proceed to the next gate.",
      },
    ],

    assumptionRequirement:
      "Every LLM-authored spec artifact (intent.md, requirements.md, design.md, tasks.md, stories/*.md) " +
      "MUST contain an '## Assumptions' section. " +
      "List every inference you made that was not explicitly stated by the user. " +
      "Use hedging language: 'assumed because', 'inferred from', 'likely', 'defaulted to'. " +
      "Never write assumptions with certainty language ('will', 'always', 'guaranteed'). " +
      "Omitting assumptions is a VIOLATION (AS-1). Using certainty language is a VIOLATION (AS-3).",

    identityResolution: [
      "LLM identity is resolved in priority order:",
      "(1) 'llm' argument to the tool call",
      "(2) SPEC_CHECK_LLM environment variable",
      "(3) 'default_llm' in spec-check.config.json (project)",
      "(4) 'default_llm' in ~/.spec-check/config.json (global)",
      "(5) fallback 'unknown'",
      "Identity is attached to every stored result and response envelope.",
    ],

    thresholds: {
      description:
        "NLP checks compare confidence (0.0–1.0) against thresholds. " +
        "Confidence below threshold → WARNING instead of VIOLATION. " +
        "Thresholds are configurable in spec-check.config.json (project) or ~/.spec-check/config.json (global).",
      defaults: {
        "I-2": 0.7, "I-3": 0.6, "I-4": 0.7, "I-5": 0.5,
        "R-3": 0.8, "R-5": 0.7, "R-7": 0.8, "R-8": 0.8, "R-9": 0.7, "R-10": 0.5,
        "D-3": 0.7, "D-4": 0.6,
        "T-2": 0.8, "T-3": 0.7, "T-4": 0.6,
        "E-2": 0.7, "AS-3": 0.8,
      },
      configKey: "thresholds",
    },
  };
}

// ── Markdown renderer for get_protocol ────────────────────────────────────────
export function protocolToMarkdown(doc: ProtocolDoc): string {
  const lines: string[] = [
    `# spec-check Protocol v${doc.version}`,
    "",
    `> ${doc.description}`,
    "",
    `**Philosophy**: ${doc.philosophy}`,
    "",
    "## Workflow (5-Gate Sequence)",
    "",
    ...doc.workflow.map(
      (w) =>
        `### Step ${w.step}: ${w.gate} — ${w.name}\n` +
        `${w.summary}\n\n` +
        `*Blocked by*: ${w.blockedBy}`
    ),
    "",
    "## Severity Levels",
    "",
    ...doc.severityLevels.map(
      (s) => `**${s.level}**: ${s.meaning} → ${s.effect}`
    ),
    "",
    "## Assumption Requirement",
    "",
    doc.assumptionRequirement,
    "",
    "## Available Tools",
    "",
    ...doc.tools.map(
      (t) =>
        `### \`${t.name}\`\n` +
        `${t.description}\n\n` +
        `- Required: \`${t.requiredArgs.join("`, `") || "none"}\`\n` +
        `- Optional: \`${t.optionalArgs.join("`, `") || "none"}\`\n` +
        `- Returns: ${t.returns}`
    ),
    "",
    "## Threshold Defaults",
    "",
    doc.thresholds.description,
    "",
    "| Check | Default Threshold |",
    "|-------|-------------------|",
    ...Object.entries(doc.thresholds.defaults).map(([k, v]) => `| ${k} | ${v} |`),
  ];
  return lines.join("\n");
}
