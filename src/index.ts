// spec-check MCP Server — Story 001: Foundation
// Entry point: wires MCP transport → Tool Router → Gate Engine
// All errors are structured; stack traces never reach the caller.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, statSync } from "fs";
import {
  CallToolRequestSchema,
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
import { resolveIdentity } from "./identity.js";
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
import { buildStoragePaths, buildFilePath, buildGateRecord, writeRecord, smokeTest } from "./storage.js";
import { validateArtifacts } from "./artifacts.js";
import type { ToolArgs, Format, GateResult, ResolvedConfig, RunResult } from "./types.js";
import type { LLMIdentity } from "./types.js";

const SERVER_VERSION = "0.1.0";

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "get_protocol",
    description:
      "Return the spec-check self-describing protocol. " +
      "Call this first in any new session to understand the 5-gate methodology, " +
      "tool signatures, severity levels, and assumption requirements.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "text"], description: "Output format (default: text)" },
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

function envelope<T>(data: T, meta: { llm_id: string; server_version: string }): { data: T; meta: typeof meta } {
  return { data, meta };
}

// ── Per-tool context (resolved inside main handler before dispatch) ─────────

interface ToolCtx {
  args: ToolArgs & Record<string, unknown>;
  config: ReturnType<typeof loadConfig>["config"];
  llm: LLMIdentity;
  meta: { llm_id: string; server_version: string };
}

type McpResponse = { content: Array<{ type: "text"; text: string }> };

// ── Individual tool handlers ──────────────────────────────────────────────────
// Each handler is a standalone async function with its own local config/llm
// resolution when the handler needs a different project root than the call site.

async function handle_get_protocol(ctx: ToolCtx): Promise<McpResponse> {
  const fmt = (ctx.args.format as Format) ?? "text";
  const doc = buildProtocol();
  const output = fmt === "json" ? JSON.stringify(doc, null, 2) : protocolToMarkdown(doc);
  return toMcpContent(envelope(output, ctx.meta));
}

async function handle_gate_check(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "gate_check"), ctx.meta));
  if (!ctx.args.gate) return toMcpContent(envelope(missingArg("gate", "gate_check"), ctx.meta));

  const absPath = resolve(ctx.args.path);
  const { config: localConfig } = loadConfig(absPath);
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };

  const serviceMap = detectServices(absPath, localConfig);
  const service = serviceMap.services[0]!;

  const gateResult: GateResult = await runGate(ctx.args.gate as string, service, localConfig);
  const fmt = (ctx.args.format as Format) ?? "text";
  const formatted = formatGateResult(gateResult, fmt);

  const paths = buildStoragePaths(absPath, service, localConfig.value.metrics.db_path);
  const filePath = buildFilePath(paths, localLlm, `gate-${ctx.args.gate}`);
  writeRecord(filePath, buildGateRecord({
    projectRoot: absPath,
    org: paths.org,
    repo: paths.repo,
    service: paths.service,
    commit8: paths.commit8,
    branch: paths.branch,
    llm: localLlm,
    gate: ctx.args.gate as string,
    triggeredBy: "gate_check",
    gateStatus: gateResult.status,
    results: gateResult.criteria,
    durationMs: gateResult.durationMs,
    timestamp: new Date(),
  }));

  return toMcpContent(envelope(fmt === "json" ? gateResult : formatted, localMeta));
}

async function handle_run_all(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "run_all"), ctx.meta));

  const absPath = resolve(ctx.args.path);
  const { config: localConfig } = loadConfig(absPath);
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };

  const serviceMap = detectServices(absPath, localConfig);
  const service = serviceMap.services[0]!;

  const runResult: RunResult = await runAllGates(service, localConfig, localLlm);
  const fmt = (ctx.args.format as Format) ?? "text";
  const formatted = formatRunResult(runResult, fmt);

  const paths = buildStoragePaths(absPath, service, localConfig.value.metrics.db_path);
  for (const gateResult of runResult.gates) {
    const filePath = buildFilePath(paths, localLlm, `gate-${gateResult.gate}`);
    writeRecord(filePath, buildGateRecord({
      projectRoot: absPath,
      org: paths.org,
      repo: paths.repo,
      service: paths.service,
      commit8: paths.commit8,
      branch: paths.branch,
      llm: localLlm,
      gate: gateResult.gate,
      triggeredBy: "run_all",
      gateStatus: gateResult.status,
      results: gateResult.criteria,
      durationMs: gateResult.durationMs,
      timestamp: new Date(),
    }));
  }

  return toMcpContent(envelope(fmt === "json" ? runResult : formatted, localMeta));
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
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = invalidateAssumption(absPath, String(ctx.args.assumption_id), String(ctx.args.reason), service, localConfig, localLlm);
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
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = await runDiffCheck(absPath, service, localConfig, localLlm, ctx.args.base as string | undefined);
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatDiffReport(result, fmt), localMeta));
}

async function handle_complexity(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.path) return toMcpContent(envelope(missingArg("path", "complexity"), ctx.meta));
  const absPath = resolve(String(ctx.args.path));
  if (!existsSync(absPath)) return toMcpContent(envelope(pathNotFound(absPath), ctx.meta));
  const { config: localConfig } = loadConfig(absPath);
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };
  const service = detectServices(absPath, localConfig).services[0]!;
  const result = await runComplexity(service, localConfig, localLlm);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatComplexityReport(result, fmt), localMeta));
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
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = await runMutation(absPath, service, localConfig, localLlm);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatMutationReport(result, fmt), localMeta));
}

async function handle_install_dependency(ctx: ToolCtx): Promise<McpResponse> {
  if (!ctx.args.name) return toMcpContent(envelope(missingArg("name", "install_dependency"), ctx.meta));
  const targetPath = ctx.args.path ? resolve(String(ctx.args.path)) : process.cwd();
  if (ctx.args.path && !existsSync(targetPath)) return toMcpContent(envelope(pathNotFound(targetPath), ctx.meta));
  const result = installDependency(String(ctx.args.name), targetPath);
  const fmt = ((ctx.args.format as "text" | "json") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatInstallDependencyResult(result), ctx.meta));
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
  const localLlm = resolveIdentity(ctx.args.llm as string | undefined, localConfig);
  const localMeta = { llm_id: localLlm.id, server_version: SERVER_VERSION };
  const service = detectServices(localConfigRoot, localConfig).services[0]!;
  const result = await getProjectMetrics(absPath, service, localConfig, ctx.args.since as string | undefined);
  const fmt = ((ctx.args.format as "text" | "json" | "mermaid") ?? "text");
  return toMcpContent(envelope(fmt === "json" ? result : formatProjectMetrics(result, fmt), localMeta));
}

// ── Dispatch table ────────────────────────────────────────────────────────────

type Handler = (ctx: ToolCtx) => Promise<McpResponse>;

const HANDLERS: Map<string, Handler> = new Map([
  ["get_protocol", handle_get_protocol],
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
]);

// ── Server bootstrap ──────────────────────────────────────────────────────────

async function main() {
  const server = new Server(
    { name: "spec-check", version: SERVER_VERSION },
    { capabilities: { tools: {} } }
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

  // ── list_tools ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
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

    const llm = resolveIdentity(args.llm as string | undefined, config);
    const meta = { llm_id: llm.id, server_version: SERVER_VERSION };
    const ctx: ToolCtx = { args, config, llm, meta };

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
