// spec-check MCP Server — Story 001: Foundation
// Entry point: wires MCP transport → Tool Router → Gate Engine
// All errors are structured; stack traces never reach the caller.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, statSync } from "fs";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { dirname, resolve } from "path";

import { loadConfig } from "./config.js";
import {
  getAssumptionMetrics,
  checkAssumptions,
  getSupersessionHistory,
  invalidateAssumption,
  listAssumptions,
  trackAssumption,
} from "./assumptions.js";
import { runComplexity } from "./complexity.js";
import { checkDependencies, installDependency } from "./dependencies.js";
import { runDiffCheck } from "./diff.js";
import { resolveActorIdentity } from "./identity.js";
import { formatProjectMetrics, formatRollupMetrics, getProjectMetrics, getRollupMetrics } from "./metrics.js";
import { detectServices } from "./monorepo.js";
import { runMutation } from "./mutation.js";
import { runGate, runAllGates } from "./gates/index.js";
import { buildProtocol, protocolToMarkdown } from "./protocol.js";
import {
  formatArtifactValidationResult,
  formatAssumptionMetricsResult,
  formatAssumptionValidationResult,
  formatDependencyCheckResult,
  formatDiffReport,
  formatGateResult,
  formatListedAssumptionsResult,
  formatComplexityReport,
  formatInstallDependencyResult,
  formatMutationReport,
  formatSupersessionHistoryResult,
  formatRunResult,
} from "./format.js";
import { buildStoragePaths, buildFilePath, buildGateRecord, writeRecord, smokeTest, migrateLegacyJsonlRecords } from "./storage.js";
import { validateArtifacts } from "./artifacts.js";
import { runReconciliation, formatReconciliationReport } from "./reconciliation.js";
import { runEvidenceCheck, formatEvidenceReport } from "./evidence.js";
import { scaffoldSpec, scaffoldToText } from "./scaffold.js";
import { buildSpecGuide, specGuideToText } from "./guide.js";
import { actorFields, beginSession, computeWorkflowGuidance, latestAgentState, listAgentState, persistAgentState, type AgentStateReportResult } from "./workflow.js";
import type { ToolArgs, Format, GateResult, ResolvedConfig, RunResult, ActorIdentity, WorkflowGuidance, AgentState } from "./types.js";

const SERVER_VERSION = "0.1.0";

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "get_spec_guide",
    description:
      "Return a spec-writing reference guide that teaches an LLM how to write passing spec files " +
      "(intent.md, requirements.md, design.md, tasks.md) on the first attempt. " +
      "Includes a quick-start workflow, per-file rules with correct/incorrect examples, " +
      "and the most common violation patterns. " +
      "Call this at the start of a session on any new project before writing spec files.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "text"], description: "Output format (default: text)" },
      },
    },
  },
  {
    name: "scaffold_spec",
    description:
      "Generate spec file templates (intent.md, requirements.md, design.md, tasks.md) for a project. " +
      "Detects which files already exist, returns templates with [PLACEHOLDER] markers, " +
      "per-file guidance about what spec-check validates, and common violation patterns to avoid. " +
      "Set write:true to write templates for non-existing files directly to disk. " +
      "Existing files are never overwritten. " +
      "Optionally pass a 'source' path to a PRD or README for context — otherwise auto-detects README.md.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the project root" },
        source: { type: "string", description: "Optional path to a PRD, README, or spec document to draw context from" },
        write: { type: "boolean", description: "If true, write templates for non-existing spec files to disk (default: false)" },
        format: { type: "string", enum: ["text", "json"], description: "Output format (default: text)" },
      },
      required: ["path"],
    },
  },
  {
    name: "get_protocol",
    description:
      "Return the spec-check self-describing protocol. " +
      "Call this first in any new session to understand the 5-gate methodology, " +
      "tool signatures, severity levels, and assumption requirements.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "text", "markdown"], description: "Output format (default: text)" },
        path: { type: "string", description: "Project root path — if provided, active thresholds are resolved from project config" },
      },
    },
  },
  {
    name: "gate_check",
    description:
      "Run a single gate check (G1–G5) against a spec path. " +
      "Returns structured criteria with status, evidence, and fix instructions.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the project or spec directory" },
        gate: { type: "string", enum: ["G1", "G2", "G3", "G4", "G5"], description: "Gate to check" },
        llm: { type: "string", description: "LLM model identifier (e.g. claude-sonnet-4-5)" },
        format: { type: "string", enum: ["text", "json", "mermaid"], description: "Output format" },
      },
      required: ["path", "gate"],
    },
  },
  {
    name: "run_all",
    description:
      "Run all five gates sequentially against a project. " +
      "Stops at the first BLOCKED gate. Returns per-gate results with consolidated next steps.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the project root" },
        llm: { type: "string", description: "LLM model identifier" },
        format: { type: "string", enum: ["text", "json", "mermaid"], description: "Output format" },
      },
      required: ["path"],
    },
  },
  {
    name: "validate_artifact",
    description:
      "Validate a single spec artifact file (intent, requirements, design, tasks, story, adr, rca). " +
      "Returns criteria results with evidence and fix instructions.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string", description: "Path to the artifact file" },
        include_archived: { type: "boolean", description: "Include files under archive/ when validating directories" },
        llm: { type: "string", description: "LLM model identifier" },
        format: { type: "string", enum: ["text", "json"], description: "Output format" },
      },
      required: ["artifact_path"],
    },
  },
  {
    name: "check_assumptions",
    description:
      "Validate the `## Assumptions` section of a single artifact. " +
      "Checks presence, table shape, hedging language, and orphan invalidations.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string", description: "Path to the artifact file" },
        format: { type: "string", enum: ["text", "json"], description: "Output format" },
      },
      required: ["artifact_path"],
    },
  },
  {
    name: "track_assumption",
    description:
      "Register a new assumption in the assumption registry for a spec artifact. " +
      "Assumptions not tracked here cannot be invalidated later.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string", description: "Path to the artifact the assumption belongs to" },
        name: { type: "string", description: "Short name / description of the assumption" },
        reason: { type: "string", description: "Why this assumption was made (hedged language required)" },
        llm: { type: "string", description: "LLM model identifier" },
      },
      required: ["artifact_path", "name"],
    },
  },
  {
    name: "invalidate_assumption",
    description:
      "Mark an assumption as invalidated. Triggers supersession of affected artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_path: { type: "string", description: "Path to the artifact containing the assumption" },
        assumption_id: { type: "string", description: "ID returned when the assumption was tracked" },
        reason: { type: "string", description: "Why the assumption is no longer valid" },
        llm: { type: "string", description: "LLM model identifier" },
      },
      required: ["artifact_path", "assumption_id", "reason"],
    },
  },
  {
    name: "list_assumptions",
    description: "List all tracked assumptions for a project spec path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project or spec path" },
        include_archived: { type: "boolean", description: "Include superseded/archived assumptions" },
        format: { type: "string", enum: ["text", "json"], description: "Output format" },
      },
      required: ["path"],
    },
  },
  {
    name: "get_assumption_metrics",
    description: "Return assumption invalidation, category, and model metrics for a project path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root or subtree path" },
        since: { type: "string", description: "Optional ISO date filter" },
        format: { type: "string", enum: ["text", "json", "mermaid"], description: "Output format" },
      },
    },
  },
  {
    name: "get_supersession_history",
    description: "Return supersession events for a project path, optionally filtered from a given date.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root or subtree path" },
        since: { type: "string", description: "Optional ISO date filter" },
        artifact_type: { type: "string", enum: ["story", "intent", "rca"], description: "Optional artifact type filter" },
        format: { type: "string", enum: ["text", "json"], description: "Output format" },
      },
      required: ["path"],
    },
  },
  {
    name: "diff_check",
    description:
      "Analyse git diff to determine which spec gates need re-running after code changes. " +
      "Reports ADR trigger status if architectural changes are detected.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        base: { type: "string", description: "Base branch or commit to diff against (default: HEAD~1)" },
        since: { type: "string", description: "ISO timestamp — diff since this time" },
        llm: { type: "string", description: "LLM model identifier" },
      },
      required: ["path"],
    },
  },
  {
    name: "complexity",
    description:
      "Run cyclomatic complexity, cognitive complexity, nesting depth, and function length " +
      "analysis on source files. Uses bundled AST parsers (TS/JS/Python/Go) and lizard for others.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        llm: { type: "string", description: "LLM model identifier" },
        format: { type: "string", enum: ["text", "json", "mermaid"], description: "Output format" },
      },
      required: ["path"],
    },
  },
  {
    name: "check_mutation_score",
    description:
      "Run mutation testing on a project, directory, or file scope. " +
      "Returns mutation score, surviving mutants, trigger notes, and persisted trend-aware criteria.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root, directory, or file to mutate" },
        llm: { type: "string", description: "LLM model identifier" },
        format: { type: "string", enum: ["text", "json", "mermaid"], description: "Output format" },
      },
      required: ["path"],
    },
  },
  {
    name: "check_dependencies",
    description:
      "Report which analysis and mutation dependencies are installed, which are missing, " +
      "what they enable, and which install commands are available on this machine.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional project root for project-local tools such as stryker" },
        format: { type: "string", enum: ["text", "json"], description: "Output format" },
      },
    },
  },
  {
    name: "install_dependency",
    description:
      "Install one named dependency from the registry using the highest-priority available package manager. " +
      "Returns structured success or structured InstallFailure.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Dependency name from the registry" },
        path: { type: "string", description: "Optional project root for package-local installs such as stryker" },
        format: { type: "string", enum: ["text", "json"], description: "Output format" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_rollup",
    description: "Return cross-project rollup metrics and model comparison rankings for the entire storage root.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Optional ISO date filter" },
        format: { type: "string", enum: ["text", "json", "mermaid", "model_comparison"], description: "Output format" },
      },
    },
  },
  {
    name: "metrics",
    description:
      "Query stored compliance metrics: per-gate pass rates, compliance score (G1×0.15 + G2×0.30 + G3×0.20 + G4×0.15 + G5×0.20), " +
      "and trend data. Requires DuckDB storage to have data.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        since: { type: "string", description: "ISO timestamp to filter from" },
        format: { type: "string", enum: ["text", "json", "mermaid"], description: "Output format" },
      },
    },
  },
  {
    name: "check_reconciliation",
    description:
      "Reconcile README claims against actual repository artifacts (RC-1) and " +
      "verify that completed tasks reference files that exist (RC-2). " +
      "Returns VIOLATION when README backtick-quoted paths are missing or completed tasks " +
      "reference non-existent artifact paths.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        format: { type: "string", enum: ["text", "json"], description: "Output format (default: text)" },
      },
      required: ["path"],
    },
  },
  {
    name: "begin_session",
    description: "Register an agent session for a project and return initial workflow obligations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        llm: { type: "string", description: "LLM model identifier" },
        agent_id: { type: "string", description: "Stable identifier for the calling agent instance" },
        agent_kind: { type: "string", description: "Agent role such as planner, implementer, reviewer, or ci" },
        parent_agent_id: { type: "string", description: "Optional delegating agent identifier" },
        session_id: { type: "string", description: "Optional shared workflow session identifier" },
        run_id: { type: "string", description: "Optional task or attempt identifier" },
      },
      required: ["path"],
    },
  },
  {
    name: "report_agent_state",
    description: "Persist caller-reported workflow state so the server can compute next actions explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        llm: { type: "string", description: "LLM model identifier" },
        agent_id: { type: "string", description: "Calling agent identifier" },
        agent_kind: { type: "string", description: "Agent role" },
        parent_agent_id: { type: "string", description: "Optional delegating agent identifier" },
        session_id: { type: "string", description: "Optional session identifier" },
        run_id: { type: "string", description: "Optional task or attempt identifier" },
        state: { type: "object", description: "Reported workflow state patch" },
      },
      required: ["path", "state"],
    },
  },
  {
    name: "get_next_action",
    description: "Return computed next required checks, blocking prerequisites, and metrics obligations for an agent.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        llm: { type: "string", description: "LLM model identifier" },
        agent_id: { type: "string", description: "Calling agent identifier" },
        agent_kind: { type: "string", description: "Agent role" },
        parent_agent_id: { type: "string", description: "Optional delegating agent identifier" },
        session_id: { type: "string", description: "Optional session identifier" },
        run_id: { type: "string", description: "Optional task or attempt identifier" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_agent_state",
    description: "List the latest reported workflow state for agents in a project or session.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        session_id: { type: "string", description: "Optional session identifier to filter by" },
      },
      required: ["path"],
    },
  },
  {
    name: "close_session",
    description: "Mark the current agent session complete and persist final state.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        llm: { type: "string", description: "LLM model identifier" },
        agent_id: { type: "string", description: "Calling agent identifier" },
        agent_kind: { type: "string", description: "Agent role" },
        parent_agent_id: { type: "string", description: "Optional delegating agent identifier" },
        session_id: { type: "string", description: "Optional session identifier" },
        run_id: { type: "string", description: "Optional task or attempt identifier" },
      },
      required: ["path"],
    },
  },
  {
    name: "check_evidence",
    description:
      "Verify that release artifacts have matching verification evidence (EV-1) and " +
      "that performance-sensitive components with benchmark annotations have result files (EV-2). " +
      "Checks release/, verification/, and benchmarks/ directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project root path" },
        format: { type: "string", enum: ["text", "json"], description: "Output format (default: text)" },
      },
      required: ["path"],
    },
  },
];

// ── Structured error helpers ───────────────────────────────────────────────────

interface StructuredError {
  error: string;
  code: string;
  detail?: string;
  fix?: string;
  server_version: string;
}

function makeError(code: string, error: string, detail?: string, fix?: string): StructuredError {
  return { error, code, detail, fix, server_version: SERVER_VERSION };
}

function pathNotFound(path: string): StructuredError {
  return makeError(
    "PATH_NOT_FOUND",
    `Path not found: ${path}`,
    "The path argument does not point to an existing directory or file.",
    "Provide an absolute path to a project root that exists on disk."
  );
}

function missingArg(arg: string, toolName: string): StructuredError {
  return makeError(
    "MISSING_ARGUMENT",
    `Required argument '${arg}' is missing`,
    `Tool '${toolName}' requires '${arg}'.`,
    `Add '${arg}' to your tool call arguments.`
  );
}

function configRootForTarget(path: string): string {
  try {
    return statSync(path).isDirectory() ? path : dirname(path);
  } catch {
    return path;
  }
}

function toMcpContent(obj: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}

const IDENTITY_REQUEST = {
  message:
    "Your model identity is unknown. Re-call this tool with the `llm` argument set to your model name " +
    "(e.g. \"llm\": \"claude-sonnet-4-5\"). Identity is required for attribution, metrics, and audit trails.",
  argument: "llm",
  example: "claude-sonnet-4-5",
  priority_sources: [
    "1. `llm` argument on any tool call",
    "2. SPEC_CHECK_LLM environment variable",
    "3. `default_llm` in spec-check.config.json",
  ],
};

function envelope<T>(
  data: T,
  meta: {
    llm_id: string;
    llm_source: string;
    server_version: string;
    agent_id: string;
    agent_kind: string;
    session_id: string;
    run_id: string;
  },
  workflow?: WorkflowGuidance
): { data: T; meta: typeof meta; workflow?: WorkflowGuidance; request_identity?: typeof IDENTITY_REQUEST } {
  const base = workflow ? { data, meta, workflow } : { data, meta };
  if (meta.llm_source === "fallback") return { ...base, request_identity: IDENTITY_REQUEST };
  return base;
}

// ── Per-tool context (resolved inside main handler before dispatch) ─────────

interface ToolCtx {
  args: ToolArgs & Record<string, unknown>;
  config: ReturnType<typeof loadConfig>["config"];
  actor: ActorIdentity;
  meta: { llm_id: string; llm_source: string; server_version: string; agent_id: string; agent_kind: string; session_id: string; run_id: string };
}

type McpResponse = { content: Array<{ type: "text"; text: string }> };

function actorMeta(actor: ActorIdentity): ToolCtx["meta"] {
  return {
    llm_id: actor.id,
    llm_source: actor.source,
    server_version: SERVER_VERSION,
    agent_id: actor.agent_id,
    agent_kind: actor.agent_kind,
    session_id: actor.session_id,
    run_id: actor.run_id,
  };
}

function nextWorkflowForCheck(projectRoot: string, lastCompletedCheck: string | null, openViolations: string[] = []): WorkflowGuidance {
  return computeWorkflowGuidance(projectRoot, {
    current_goal: null,
    current_phase: null,
    working_set_paths: [],
    changed_paths: [],
    last_completed_check: lastCompletedCheck,
    required_next_checks: [],
    open_violations: openViolations,
    assumptions_declared: null,
    metrics_due: null,
    summary_from_agent: null,
    status: "active",
  });
}

// ── Individual tool handlers ──────────────────────────────────────────────────
// Each handler is a standalone async function with its own local config/llm
// resolution when the handler needs a different project root than the call site.

async function handle_get_protocol(ctx: ToolCtx): Promise<McpResponse> {
  const fmt = (ctx.args.format as Format) ?? "text";
  let resolvedThresholds: Record<string, number> | undefined;
  let thresholdSources: Record<string, string> | undefined;
  if (ctx.args.path) {
    const absPath = resolve(String(ctx.args.path));
    if (existsSync(absPath)) {
      const { config: projConfig } = loadConfig(absPath);
      resolvedThresholds = projConfig.value.thresholds as unknown as Record<string, number>;
      thresholdSources = projConfig.sources;
    }
  }
  const doc = buildProtocol(resolvedThresholds, thresholdSources);
  const output = fmt === "json" ? JSON.stringify(doc, null, 2) : protocolToMarkdown(doc);
  return toMcpContent(envelope(output, ctx.meta, computeWorkflowGuidance(process.cwd(), {
    current_goal: "read protocol",
    current_phase: "protocol",
    working_set_paths: [],
    changed_paths: [],
    last_completed_check: null,
    required_next_checks: [],
    open_violations: [],
    assumptions_declared: null,
    metrics_due: false,
    summary_from_agent: null,
    status: "active",
  })));
}

async function handle_begin_session(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "begin_session"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const service = detectServices(absPath, ctx.config).services[0]!;
  const result = beginSession(absPath, service, ctx.config, ctx.actor);
  return toMcpContent(envelope(result, ctx.meta, result.workflow));
}

async function handle_report_agent_state(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "report_agent_state"), ctx.meta));
  if (!ctx.args.state || typeof ctx.args.state !== "object") return toMcpContent(envelope(missingArg("state", "report_agent_state"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const service = detectServices(absPath, ctx.config).services[0]!;
  const record = persistAgentState(absPath, service, ctx.config, ctx.actor, ctx.args.state as Partial<AgentState>);
  const state = {
    current_goal: record.current_goal,
    current_phase: record.current_phase,
    working_set_paths: record.working_set_paths,
    changed_paths: record.changed_paths,
    last_completed_check: record.last_completed_check,
    required_next_checks: record.required_next_checks,
    open_violations: record.open_violations,
    assumptions_declared: record.assumptions_declared,
    metrics_due: record.metrics_due,
    summary_from_agent: record.summary_from_agent,
    status: record.status,
  };
  const result: AgentStateReportResult = {
    project_path: record.project_path,
    actor: ctx.actor,
    state,
    workflow: computeWorkflowGuidance(absPath, state),
  };
  return toMcpContent(envelope(result, ctx.meta, result.workflow));
}

async function handle_get_next_action(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "get_next_action"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const service = detectServices(absPath, ctx.config).services[0]!;
  const latest = latestAgentState(absPath, service, ctx.config, ctx.actor);
  const state = latest ? {
    current_goal: latest.current_goal,
    current_phase: latest.current_phase,
    working_set_paths: latest.working_set_paths,
    changed_paths: latest.changed_paths,
    last_completed_check: latest.last_completed_check,
    required_next_checks: latest.required_next_checks,
    open_violations: latest.open_violations,
    assumptions_declared: latest.assumptions_declared,
    metrics_due: latest.metrics_due,
    summary_from_agent: latest.summary_from_agent,
    status: latest.status,
  } : {
    current_goal: null,
    current_phase: null,
    working_set_paths: [],
    changed_paths: [],
    last_completed_check: null,
    required_next_checks: [],
    open_violations: [],
    assumptions_declared: null,
    metrics_due: null,
    summary_from_agent: null,
    status: "active" as const,
  };
  const workflow = computeWorkflowGuidance(absPath, state);
  return toMcpContent(envelope({ project_path: absPath, actor: ctx.actor, state, workflow }, ctx.meta, workflow));
}

async function handle_list_agent_state(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "list_agent_state"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const service = detectServices(absPath, ctx.config).services[0]!;
  const result = listAgentState(absPath, service, ctx.config, ctx.args.session_id as string | undefined);
  return toMcpContent(envelope(result, ctx.meta));
}

async function handle_close_session(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "close_session"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const service = detectServices(absPath, ctx.config).services[0]!;
  const latest = latestAgentState(absPath, service, ctx.config, ctx.actor);
  const record = persistAgentState(absPath, service, ctx.config, ctx.actor, {
    ...(latest ? {
      current_goal: latest.current_goal,
      current_phase: latest.current_phase,
      working_set_paths: latest.working_set_paths,
      changed_paths: latest.changed_paths,
      last_completed_check: latest.last_completed_check,
      required_next_checks: latest.required_next_checks,
      open_violations: latest.open_violations,
      assumptions_declared: latest.assumptions_declared,
      metrics_due: latest.metrics_due,
      summary_from_agent: latest.summary_from_agent,
    } : {}),
    status: "completed",
  });
  const state = {
    current_goal: record.current_goal,
    current_phase: record.current_phase,
    working_set_paths: record.working_set_paths,
    changed_paths: record.changed_paths,
    last_completed_check: record.last_completed_check,
    required_next_checks: record.required_next_checks,
    open_violations: record.open_violations,
    assumptions_declared: record.assumptions_declared,
    metrics_due: record.metrics_due,
    summary_from_agent: record.summary_from_agent,
    status: record.status,
  };
  const workflow = computeWorkflowGuidance(absPath, state);
  return toMcpContent(envelope({ project_path: absPath, actor: ctx.actor, state, workflow }, ctx.meta, workflow));
}

async function handle_gate_check(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "gate_check"), ctx.meta));
  if (!ctx.args.gate) return toMcpContent(envelope(missingArg("gate", "gate_check"), ctx.meta));

  const absPath = resolve(ctx.args.path);
  const { config: localConfig } = loadConfig(absPath);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);

  const serviceMap = detectServices(absPath, localConfig);
  const service = serviceMap.services[0]!;

  const gateResult: GateResult = await runGate(ctx.args.gate as string, service, localConfig);
  const fmt = (ctx.args.format as Format) ?? "text";
  const formatted = formatGateResult(gateResult, fmt);

  const paths = buildStoragePaths(absPath, service, localConfig.value.metrics.db_path);
  const filePath = buildFilePath(paths, localActor, `gate-${ctx.args.gate}`);
  writeRecord(filePath, buildGateRecord({
    projectRoot: absPath,
    org: paths.org,
    repo: paths.repo,
    service: paths.service,
    commit8: paths.commit8,
    branch: paths.branch,
    llm: localActor,
    gate: ctx.args.gate as string,
    triggeredBy: "gate_check",
    gateStatus: gateResult.status,
    results: gateResult.criteria,
    durationMs: gateResult.durationMs,
    timestamp: new Date(),
  }));

  return toMcpContent(envelope(
    fmt === "json" ? gateResult : formatted,
    localMeta,
    nextWorkflowForCheck(absPath, gateResult.status === "PASS" || gateResult.status === "PASSING_WITH_WARNINGS" ? String(ctx.args.gate) : null, gateResult.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id))
  ));
}

async function handle_run_all(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "run_all"), ctx.meta));

  const absPath = resolve(ctx.args.path);
  const { config: localConfig } = loadConfig(absPath);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);

  const serviceMap = detectServices(absPath, localConfig);
  const service = serviceMap.services[0]!;

  const runResult: RunResult = await runAllGates(service, localConfig, localActor);
  const fmt = (ctx.args.format as Format) ?? "text";
  const formatted = formatRunResult(runResult, fmt);

  const paths = buildStoragePaths(absPath, service, localConfig.value.metrics.db_path);
  for (const gateResult of runResult.gates) {
    const filePath = buildFilePath(paths, localActor, `gate-${gateResult.gate}`);
    writeRecord(filePath, buildGateRecord({
      projectRoot: absPath,
      org: paths.org,
      repo: paths.repo,
      service: paths.service,
      commit8: paths.commit8,
      branch: paths.branch,
      llm: localActor,
      gate: gateResult.gate,
      triggeredBy: "run_all",
      gateStatus: gateResult.status,
      results: gateResult.criteria,
      durationMs: gateResult.durationMs,
      timestamp: new Date(),
    }));
  }

  return toMcpContent(envelope(
    fmt === "json" ? runResult : formatted,
    localMeta,
    nextWorkflowForCheck(absPath, runResult.status === "PASS" || runResult.status === "PASSING_WITH_WARNINGS" ? "G5" : null, runResult.gates.flatMap((gate) => gate.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id)))
  ));
}

async function handle_validate_artifact(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.artifact_path) return toMcpContent(envelope(missingArg("artifact_path", "validate_artifact"), ctx.meta));
  const artifactPath = resolve(String(ctx.args.artifact_path));
  if (!existsSync(artifactPath)) return toMcpContent(envelope(pathNotFound(artifactPath), ctx.meta));
  const result = validateArtifacts(artifactPath, Boolean(ctx.args.include_archived));
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatArtifactValidationResult(result, fmt), ctx.meta));
}

async function handle_check_assumptions(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.artifact_path) return toMcpContent(envelope(missingArg("artifact_path", "check_assumptions"), ctx.meta));
  const absPath = resolve(String(ctx.args.artifact_path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const result = checkAssumptions(absPath, localConfig);
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatAssumptionValidationResult(result, fmt), ctx.meta));
}

async function handle_track_assumption(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.artifact_path) return toMcpContent(envelope(missingArg("artifact_path", "track_assumption"), ctx.meta));
  if (!ctx.args.name) return toMcpContent(envelope(missingArg("name", "track_assumption"), ctx.meta));
  const absPath = resolve(String(ctx.args.artifact_path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const result = trackAssumption(absPath, String(ctx.args.name), String(ctx.args.reason ?? "Assumed because not explicitly specified by the user."));
  return toMcpContent(envelope(result, ctx.meta));
}

async function handle_invalidate_assumption(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.artifact_path) return toMcpContent(envelope(missingArg("artifact_path", "invalidate_assumption"), ctx.meta));
  if (!ctx.args.assumption_id) return toMcpContent(envelope(missingArg("assumption_id", "invalidate_assumption"), ctx.meta));
  if (!ctx.args.reason) return toMcpContent(envelope(missingArg("reason", "invalidate_assumption"), ctx.meta));
  const absPath = resolve(String(ctx.args.artifact_path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = invalidateAssumption(absPath, String(ctx.args.assumption_id), String(ctx.args.reason), service, localConfig, localActor);
  return toMcpContent(envelope(result, localMeta));
}

async function handle_list_assumptions(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "list_assumptions"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const result = listAssumptions(absPath, Boolean(ctx.args.include_archived));
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatListedAssumptionsResult(result, fmt), ctx.meta));
}

async function handle_get_assumption_metrics(ctx: ToolCtx): Promise<McpResponse> {
  const absPath = resolve(String(ctx.args.path ?? process.cwd()));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = getAssumptionMetrics(absPath, service, localConfig, ctx.args.since as string | undefined);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatAssumptionMetricsResult(result, fmt), ctx.meta));
}

async function handle_get_supersession_history(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "get_supersession_history"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = getSupersessionHistory(
    absPath, service, localConfig,
    ctx.args.since as string | undefined,
    ctx.args.artifact_type as string | undefined
  );
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatSupersessionHistoryResult(result, fmt), ctx.meta));
}

async function handle_diff_check(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "diff_check"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = await runDiffCheck(absPath, service, localConfig, localActor, ctx.args.base as string | undefined);
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(
    fmt === "json" ? result : formatDiffReport(result, fmt),
    localMeta,
    computeWorkflowGuidance(absPath, {
      current_goal: "review diff drift",
      current_phase: "review",
      working_set_paths: [],
      changed_paths: result.files.map((file) => file.path),
      last_completed_check: null,
      required_next_checks: [],
      open_violations: result.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id),
      assumptions_declared: null,
      metrics_due: result.categories.code.length > 0,
      summary_from_agent: null,
      status: "active",
    })
  ));
}

async function handle_complexity(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "complexity"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const { config: localConfig } = loadConfig(absPath);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(absPath, localConfig).services[0]!;
  const result = await runComplexity(service, localConfig, localActor);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(
    fmt === "json" ? result : formatComplexityReport(result, fmt),
    localMeta,
    computeWorkflowGuidance(absPath, {
      current_goal: "analyze complexity",
      current_phase: "review",
      working_set_paths: [],
      changed_paths: result.files.map((file) => file.file),
      last_completed_check: null,
      required_next_checks: [],
      open_violations: result.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id),
      assumptions_declared: null,
      metrics_due: false,
      summary_from_agent: null,
      status: "active",
    })
  ));
}

async function handle_check_dependencies(ctx: ToolCtx): Promise<McpResponse> {
  const targetPath = ctx.args.path ? resolve(String(ctx.args.path)) : process.cwd();
  if (ctx.args.path && !existsSync(targetPath)) return toMcpContent(envelope(pathNotFound(targetPath), ctx.meta));
  const result = checkDependencies(targetPath);
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatDependencyCheckResult(result), ctx.meta));
}

async function handle_check_mutation_score(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "check_mutation_score"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = await runMutation(absPath, service, localConfig, localActor);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(
    fmt === "json" ? result : formatMutationReport(result, fmt),
    localMeta,
    computeWorkflowGuidance(absPath, {
      current_goal: "analyze mutation score",
      current_phase: "review",
      working_set_paths: [],
      changed_paths: result.functions.map((fn) => fn.file),
      last_completed_check: null,
      required_next_checks: [],
      open_violations: result.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id),
      assumptions_declared: null,
      metrics_due: false,
      summary_from_agent: null,
      status: "active",
    })
  ));
}

async function handle_install_dependency(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.name) return toMcpContent(envelope(missingArg("name", "install_dependency"), ctx.meta));
  const targetPath = ctx.args.path ? resolve(String(ctx.args.path)) : process.cwd();
  if (ctx.args.path && !existsSync(targetPath)) return toMcpContent(envelope(pathNotFound(targetPath), ctx.meta));
  const result = installDependency(String(ctx.args.name), targetPath);
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatInstallDependencyResult(result), ctx.meta));
}

async function handle_get_spec_guide(ctx: ToolCtx): Promise<McpResponse> {
  const fmt = (ctx.args.format as "text" | "json" | undefined) ?? "text";
  const guide = buildSpecGuide();
  const output = fmt === "json" ? guide : specGuideToText(guide);
  return toMcpContent(envelope(output, ctx.meta));
}

async function handle_scaffold_spec(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "scaffold_spec"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const source = ctx.args.source ? String(ctx.args.source) : undefined;
  const write = Boolean(ctx.args.write);
  const fmt = (ctx.args.format as "text" | "json" | undefined) ?? "text";
  const result = scaffoldSpec(absPath, source, write);
  return toMcpContent(envelope(fmt === "json" ? result : scaffoldToText(result), ctx.meta));
}

async function handle_get_rollup(ctx: ToolCtx): Promise<McpResponse> {
  const result = await getRollupMetrics(ctx.config, ctx.args.since as string | undefined);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid" | "model_comparison") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatRollupMetrics(result, fmt), ctx.meta));
}

async function handle_metrics(ctx: ToolCtx): Promise<McpResponse> {
  const absPath = resolve(String(ctx.args.path ?? process.cwd()));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = await getProjectMetrics(absPath, service, localConfig, ctx.args.since as string | undefined);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(
    fmt === "json" ? result : formatProjectMetrics(result, fmt),
    localMeta,
    computeWorkflowGuidance(absPath, {
      current_goal: "review project metrics",
      current_phase: "review",
      working_set_paths: [],
      changed_paths: [],
      last_completed_check: "metrics",
      required_next_checks: [],
      open_violations: [],
      assumptions_declared: null,
      metrics_due: false,
      summary_from_agent: null,
      status: "active",
    })
  ));
}

async function handle_check_reconciliation(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "check_reconciliation"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = runReconciliation(absPath);
  const paths = buildStoragePaths(absPath, service, localConfig.value.metrics.db_path);
  const filePath = buildFilePath(paths, localActor, "reconciliation");
  writeRecord(filePath, {
    schema_version: 2,
    check_type: "reconciliation",
    project_path: result.path,
    org: paths.org,
    repo: paths.repo,
    service: paths.service,
    git_commit: paths.commit8,
    branch: paths.branch,
    timestamp: new Date().toISOString(),
    status: result.status,
    criteria: result.criteria,
    duration_ms: result.durationMs,
    ...actorFields(localActor),
  });
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(
    fmt === "json" ? result : formatReconciliationReport(result),
    localMeta,
    computeWorkflowGuidance(absPath, {
      current_goal: "reconcile implementation against specification",
      current_phase: "review",
      working_set_paths: [],
      changed_paths: [],
      last_completed_check: null,
      required_next_checks: [],
      open_violations: result.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id),
      assumptions_declared: null,
      metrics_due: false,
      summary_from_agent: null,
      status: "active",
    })
  ));
}

async function handle_check_evidence(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "check_evidence"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const localConfigRoot = configRootForTarget(absPath);
  const { config: localConfig } = loadConfig(localConfigRoot);
  const localActor = resolveActorIdentity(ctx.args, localConfig);
  const localMeta = actorMeta(localActor);
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = runEvidenceCheck(absPath);
  const paths = buildStoragePaths(absPath, service, localConfig.value.metrics.db_path);
  const filePath = buildFilePath(paths, localActor, "evidence");
  writeRecord(filePath, {
    schema_version: 2,
    check_type: "evidence",
    project_path: result.path,
    org: paths.org,
    repo: paths.repo,
    service: paths.service,
    git_commit: paths.commit8,
    branch: paths.branch,
    timestamp: new Date().toISOString(),
    status: result.status,
    criteria: result.criteria,
    duration_ms: result.durationMs,
    ...actorFields(localActor),
  });
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(
    fmt === "json" ? result : formatEvidenceReport(result),
    localMeta,
    computeWorkflowGuidance(absPath, {
      current_goal: "validate evidence artifacts",
      current_phase: "review",
      working_set_paths: [],
      changed_paths: [],
      last_completed_check: null,
      required_next_checks: [],
      open_violations: result.criteria.filter((item) => item.status === "BLOCK" || item.status === "VIOLATION").map((item) => item.id),
      assumptions_declared: null,
      metrics_due: false,
      summary_from_agent: null,
      status: "active",
    })
  ));
}

// ── Dispatch table ────────────────────────────────────────────────────────────

type Handler = (ctx: ToolCtx) => Promise<McpResponse>;

const HANDLERS: Map<string, Handler> = new Map([
  ["get_spec_guide", handle_get_spec_guide],
  ["scaffold_spec", handle_scaffold_spec],
  ["get_protocol", handle_get_protocol],
  ["begin_session", handle_begin_session],
  ["report_agent_state", handle_report_agent_state],
  ["get_next_action", handle_get_next_action],
  ["list_agent_state", handle_list_agent_state],
  ["close_session", handle_close_session],
  ["gate_check", handle_gate_check],
  ["run_all", handle_run_all],
  ["validate_artifact", handle_validate_artifact],
  ["check_assumptions", handle_check_assumptions],
  ["track_assumption", handle_track_assumption],
  ["invalidate_assumption", handle_invalidate_assumption],
  ["list_assumptions", handle_list_assumptions],
  ["get_assumption_metrics", handle_get_assumption_metrics],
  ["get_supersession_history", handle_get_supersession_history],
  ["diff_check", handle_diff_check],
  ["complexity", handle_complexity],
  ["check_dependencies", handle_check_dependencies],
  ["check_mutation_score", handle_check_mutation_score],
  ["install_dependency", handle_install_dependency],
  ["get_rollup", handle_get_rollup],
  ["metrics", handle_metrics],
  ["check_reconciliation", handle_check_reconciliation],
  ["check_evidence", handle_check_evidence],
]);

// ── Server instructions (auto-injected into LLM context on connect) ───────────

const SERVER_INSTRUCTIONS = `
You are connected to spec-check, a spec-driven development gate system.

## How spec-check works

Every project needs four spec files before code is written:
  intent.md        — why the project exists, the problem, constraints, assumptions
  requirements.md  — user-observable behaviours in Gherkin Given/When/Then format
  design.md        — how the system is built; must reference requirement IDs
  tasks.md         — atomic implementation tasks; each must cite a rule ID

spec-check enforces 5 sequential gates (G1→G5). A gate BLOCKs if its rules fail.
Gates are checked in order; later gates cannot PASS if earlier ones BLOCK.

## Workflow for a new project

1. Call get_spec_guide — read the rules, correct/incorrect examples, and common violations BEFORE writing any spec file. This prevents the most frequent mistakes.
2. Call scaffold_spec with write:true — writes starter templates to disk. Fill in the [PLACEHOLDER] sections.
3. Call run_gate with gate:"G1" — check intent.md. Fix any BLOCK reasons and re-run.
4. Call run_gate with gate:"G2" — check requirements.md. Fix and re-run.
5. Call run_gate with gate:"G3" — check design.md. Fix and re-run.
6. Call run_gate with gate:"G4" — check tasks.md. Fix and re-run.
7. Call run_all — final gate sweep. G5 checks test executability and will BLOCK until test infrastructure exists.
8. Once all gates pass, use run_metrics to track quality over time.

## The most common mistakes (read before writing)

intent.md
  - Opening paragraph must state the problem first, not the solution.
    WRONG: "This tool removes EXIF data from images."
    RIGHT: "The problem is that photographs silently carry private GPS and device data..."
  - Use plain English. No PascalCase identifiers (no localStorage, IndexedDB, FileReader).
  - Every constraint must use "must", "only", or "required".
  - End with an Assumptions table: | # | Assumption | Basis | Impact if wrong |

requirements.md
  - GIVEN describes a state, not an action.
    WRONG: "Given the user drops a file onto the drop zone"
    RIGHT: "Given a JPEG file is present in the drag payload"
  - Avoid the word "type" in GIVEN — it is detected as an action verb.
  - THEN must be observable from outside the system. No internal state assertions.
  - No PascalCase in text (no DateTimeOriginal, no IndexedDB).
  - Every Rule needs at least one negative/rejection Example.

design.md
  - First line must be: References: Feature F-1 (...), Feature F-2 (...)
  - Must include a ## Requirement Traceability table mapping every Rule ID to components.

tasks.md
  - Every task must end with (Rule: rule-id) — e.g., "(Rule: file-input-validation)"
  - Tasks must be atomic — one concern per task. No "and" in task descriptions.
  - End with an ## Assumptions section.

## Quick reference — tool names

  get_spec_guide     — full rules + examples reference (call first on any new project)
  scaffold_spec      — generate starter templates (write:true to save to disk)
  run_gate           — check one gate: G1 G2 G3 G4 G5
  run_all            — check all gates in sequence
  run_metrics        — quality metrics: complexity, mutation, coverage trends
  check_assumptions  — validate assumption log against spec files
  check_diff         — detect spec drift between requirements and design/tasks
`.trim();

// ── Server bootstrap ──────────────────────────────────────────────────────────

async function main() {
  const server = new Server(
    { name: "spec-check", version: SERVER_VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Load config once at startup (project root unknown until tool call; use global only here)
  const { config: globalConfig, errors: configErrors } = loadConfig();
  if (configErrors.length > 0) {
    process.stderr.write(
      `[spec-check] config warnings: ${configErrors.map((e) => e.message).join("; ")}\n`
    );
  }

  // Smoke-test storage
  const storageResult = smokeTest(globalConfig.value.metrics.db_path);
  if (!storageResult.ok) {
    process.stderr.write(`[spec-check] storage unavailable: ${storageResult.error}\n`);
  }
  const migrationResult = migrateLegacyJsonlRecords(globalConfig.value.metrics.db_path);
  if (migrationResult.migrated > 0 || migrationResult.removed > 0 || migrationResult.failed > 0) {
    process.stderr.write(
      `[spec-check] legacy storage migration: migrated=${migrationResult.migrated} removed=${migrationResult.removed} failed=${migrationResult.failed} remaining=${migrationResult.remaining}\n`
    );
  }

  // ── list_tools ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // ── list_prompts ───────────────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "new-project-workflow",
          title: "New project spec-check workflow",
          description:
            "Step-by-step workflow for setting up spec files on a new project. " +
            "Guides you through get_spec_guide → scaffold_spec → run_gate (G1–G5) in order.",
        },
        {
          name: "fix-gate-block",
          title: "Fix a failing gate",
          description:
            "Diagnose and fix a BLOCK result from run_gate or run_all. " +
            "Provide the gate name and the BLOCK reason to get targeted fix instructions.",
          arguments: [
            {
              name: "gate",
              description: "Gate that is blocking (G1, G2, G3, G4, or G5)",
              required: true,
            },
            {
              name: "reason",
              description: "The BLOCK reason text from the gate result",
              required: false,
            },
          ],
        },
      ],
    };
  });

  // ── get_prompt ─────────────────────────────────────────────────────────────
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;

    if (name === "new-project-workflow") {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                "I need to set up spec files for a new project using spec-check. " +
                "Please walk me through the complete workflow step by step.",
            },
          },
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: [
                "I'll guide you through the spec-check workflow for a new project. Here are the steps:",
                "",
                "**Step 1 — Read the spec guide first**",
                "Call `get_spec_guide` before writing anything. It contains the rules, correct/incorrect",
                "examples, and the most common violations for all four spec files. Skipping this step",
                "is the primary reason gate checks fail on the first attempt.",
                "",
                "**Step 2 — Scaffold the templates**",
                "Call `scaffold_spec` with `write: true` to generate starter files on disk.",
                "Fill in every `[PLACEHOLDER: ...]` section. Do not leave placeholders in place.",
                "",
                "**Step 3 — Gate G1: intent.md**",
                "Call `run_gate` with `gate: \"G1\"`. Fix any BLOCK reasons, then re-run.",
                "Common mistakes: opening with the solution instead of the problem, using PascalCase",
                "identifiers, missing Assumptions table.",
                "",
                "**Step 4 — Gate G2: requirements.md**",
                "Call `run_gate` with `gate: \"G2\"`. Fix and re-run.",
                "Common mistakes: GIVEN uses action verbs (dropped, selected), THEN asserts internal",
                "state instead of observable output, PascalCase field names in example text.",
                "",
                "**Step 5 — Gate G3: design.md**",
                "Call `run_gate` with `gate: \"G3\"`. Fix and re-run.",
                "Common mistakes: missing References line, missing Requirement Traceability table.",
                "",
                "**Step 6 — Gate G4: tasks.md**",
                "Call `run_gate` with `gate: \"G4\"`. Fix and re-run.",
                "Common mistakes: tasks missing `(Rule: ...)` suffix, compound tasks with \"and\",",
                "missing Assumptions section.",
                "",
                "**Step 7 — Full sweep**",
                "Call `run_all` for the final gate sweep. G5 checks test executability and will BLOCK",
                "until test infrastructure exists — that is expected at project start.",
                "",
                "**Step 8 — Track quality**",
                "Use `run_metrics` to track complexity, mutation score, and coverage over time once",
                "implementation begins.",
              ].join("\n"),
            },
          },
        ],
      };
    }

    if (name === "fix-gate-block") {
      const gate = promptArgs?.gate ?? "unknown";
      const reason = promptArgs?.reason ?? "";

      const gateGuidance: Record<string, string> = {
        G1: [
          "**G1 (intent.md) fix checklist:**",
          "- Does the opening paragraph begin with 'The problem is that...'? If not, rewrite it to state the problem first.",
          "- Are there any PascalCase identifiers (localStorage, IndexedDB, FileReader)? Replace with plain English.",
          "- Does every constraint use 'must', 'only', or 'required'?",
          "- Is there an Assumptions table with columns: # | Assumption | Basis | Impact if wrong?",
          "- Is there a 'Why' or 'Because' section explaining why the solution is browser-based / client-side / etc.?",
        ].join("\n"),
        G2: [
          "**G2 (requirements.md) fix checklist:**",
          "- Check every GIVEN line. It must describe a state, not an action.",
          "  WRONG: 'Given the user drops a file' — 'drops' is an action verb.",
          "  RIGHT: 'Given a JPEG file is present in the drag payload'",
          "- Avoid the word 'type' in GIVEN lines — it is detected as an action verb.",
          "  WRONG: 'Given a file with MIME type image/jpeg'",
          "  RIGHT: 'Given a JPEG file with extension .jpg'",
          "- Check every THEN line. It must be externally observable (UI text, file content, network request count).",
          "  WRONG: 'Then the internal state flag is set to true'",
          "  RIGHT: 'Then an inline error message reads \"Unsupported file type\"'",
          "- Does every Rule have at least one rejection/negative Example?",
          "- Are there any PascalCase identifiers in example text? Replace with plain English.",
        ].join("\n"),
        G3: [
          "**G3 (design.md) fix checklist:**",
          "- Does the file start with a References line listing Feature IDs?",
          "  Example: 'References: Feature F-1 (File Input), Feature F-2 (JPEG Processing)'",
          "- Is there a '## Requirement Traceability' table mapping Rule IDs to components?",
          "  It must cover every Rule ID defined in requirements.md.",
          "- Are component names consistent with the terms used in requirements.md?",
        ].join("\n"),
        G4: [
          "**G4 (tasks.md) fix checklist:**",
          "- Does every task end with '(Rule: rule-id)'?",
          "  Example: 'Implement JPEG EXIF segment removal (Rule: jpeg-exif-removal)'",
          "- Do any tasks contain 'and' in their description? If so, split them into two tasks.",
          "  WRONG: 'Add fflate library and implement batch packager (Rule: batch-download)'",
          "  RIGHT: 'Add fflate library to www/ directory (Rule: batch-download)'",
          "          'Implement Batch Packager module using fflate (Rule: batch-download)'",
          "- Is there an '## Assumptions' section at the end of the file?",
        ].join("\n"),
        G5: [
          "**G5 (executability) fix checklist:**",
          "- G5 checks that test files exist and test commands are runnable.",
          "- If this is a new project with no implementation yet, G5 blocking is expected.",
          "- To unblock G5: ensure a test runner is configured (package.json test script, pytest, etc.)",
          "  and at least one test file exists.",
        ].join("\n"),
      };

      const guidance = gateGuidance[gate] ??
        `No specific guidance found for gate "${gate}". Valid gates are G1, G2, G3, G4, G5.`;

      const reasonBlock = reason
        ? `\n\n**Block reason reported:**\n> ${reason}\n`
        : "";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: reason
                ? `Gate ${gate} is blocking with reason: "${reason}". How do I fix it?`
                : `Gate ${gate} is blocking. How do I fix it?`,
            },
          },
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `${guidance}${reasonBlock}\n\nAfter making fixes, call \`run_gate\` with \`gate: "${gate}"\` again to verify the block is resolved.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  // ── call_tool ──────────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as ToolArgs & Record<string, unknown>;

    // Reload config with project root if 'path' is present
    const projectRoot = args.path ? resolve(args.path) : undefined;
    const { config, errors: projConfigErrors } = loadConfig(projectRoot);
    if (projConfigErrors.length > 0) {
      process.stderr.write(
        `[spec-check] project config warnings: ${projConfigErrors.map((e) => e.message).join("; ")}\n`
      );
    }
    const storageMigration = migrateLegacyJsonlRecords(config.value.metrics.db_path, projectRoot);
    if (storageMigration.migrated > 0 || storageMigration.removed > 0 || storageMigration.failed > 0) {
      process.stderr.write(
        `[spec-check] project storage migration: migrated=${storageMigration.migrated} removed=${storageMigration.removed} failed=${storageMigration.failed} remaining=${storageMigration.remaining}\n`
      );
    }

    const actor = resolveActorIdentity(args, config);
    const meta = actorMeta(actor);
    const ctx: ToolCtx = { args, config, actor, meta };

    const handler = HANDLERS.get(name);
    if (!handler) {
      return toMcpContent(envelope(
        makeError(
          "UNKNOWN_TOOL",
          `Unknown tool: "${name}"`,
          "This tool is not registered in spec-check.",
          `Available tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}`
        ),
        meta
      ));
    }

    try {
      return await handler(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[spec-check] tool error (${name}): ${message}\n`);
      return toMcpContent(envelope(
        makeError("INTERNAL_ERROR", "An internal error occurred", message, "Check stderr for details."),
        meta
      ));
    }
  });

  // ── Start transport ────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[spec-check] server v${SERVER_VERSION} ready\n`);
}

main().catch((err) => {
  process.stderr.write(`[spec-check] fatal: ${String(err)}\n`);
  process.exit(1);
});
