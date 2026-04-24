import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { ActorIdentity, AgentState, ResolvedConfig, ServiceInfo, WorkflowGuidance } from "./types.js";
import { buildFilePath, buildStoragePaths, globPattern, runDuckQuery, writeRecord } from "./storage.js";

export interface AgentSessionRecord extends AgentState {
  project_path: string;
  timestamp: string;
  actor: ActorIdentity;
}

export interface BeginSessionResult {
  project_path: string;
  actor: ActorIdentity;
  state: AgentState;
  workflow: WorkflowGuidance;
}

export interface AgentStateReportResult {
  project_path: string;
  actor: ActorIdentity;
  state: AgentState;
  workflow: WorkflowGuidance;
}

export interface AgentStateListResult {
  project_path: string;
  session_id: string | null;
  agents: Array<{
    actor: ActorIdentity;
    state: AgentState;
    timestamp: string;
  }>;
}

const DEFAULT_AGENT_STATE: AgentState = {
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
  status: "active",
};

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function actorFields(actor: ActorIdentity): Record<string, unknown> {
  return {
    llm_provider: actor.provider,
    llm_model: actor.model,
    llm_id: actor.id,
    agent_id: actor.agent_id,
    agent_kind: actor.agent_kind,
    parent_agent_id: actor.parent_agent_id,
    session_id: actor.session_id,
    run_id: actor.run_id,
  };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseBoolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function readAgentStateRows(projectRoot: string, service: ServiceInfo, config: ResolvedConfig): AgentSessionRecord[] {
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const sql = `
    SELECT *
    FROM read_parquet(${sqlString(globPattern(storage.storageRoot, storage.org, storage.repo, storage.service))}, union_by_name=true)
    WHERE check_type = 'agent-state'
      AND project_path = ${sqlString(resolve(projectRoot))}
  `;
  try {
    return runDuckQuery(sql).map((row) => ({
      project_path: row.project_path,
      timestamp: row.timestamp,
      actor: {
        // writeRecord encodes null as "" to keep DuckDB from inferring JSON type;
        // use || "unknown" so an empty string falls through to the default.
        provider: row.llm_provider || "unknown",
        model: row.llm_model || "unknown",
        id: row.llm_id || "unknown",
        source: "argument",
        agent_id: row.agent_id || "unknown",
        agent_kind: row.agent_kind || "unknown",
        parent_agent_id: row.parent_agent_id || null,
        session_id: row.session_id || "unknown",
        run_id: row.run_id || "unknown",
      },
      current_goal: row.current_goal || null,
      current_phase: row.current_phase || null,
      working_set_paths: parseStringArray(row.working_set_paths),
      changed_paths: parseStringArray(row.changed_paths),
      last_completed_check: row.last_completed_check || null,
      required_next_checks: parseStringArray(row.required_next_checks),
      open_violations: parseStringArray(row.open_violations),
      assumptions_declared: parseBoolOrNull(row.assumptions_declared),
      metrics_due: parseBoolOrNull(row.metrics_due),
      summary_from_agent: row.summary_from_agent || null,
      status: row.status === "completed" ? "completed" : "active",
    }));
  } catch {
    return [];
  }
}

export function latestAgentState(
  projectRoot: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  actor: ActorIdentity
): AgentSessionRecord | null {
  return readAgentStateRows(projectRoot, service, config)
    .filter((row) => row.actor.agent_id === actor.agent_id)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .at(-1) ?? null;
}

function mergeState(base: AgentState, patch: Partial<AgentState>): AgentState {
  return {
    ...base,
    ...patch,
    working_set_paths: patch.working_set_paths ?? base.working_set_paths,
    changed_paths: patch.changed_paths ?? base.changed_paths,
    required_next_checks: patch.required_next_checks ?? base.required_next_checks,
    open_violations: patch.open_violations ?? base.open_violations,
    status: patch.status ?? base.status,
  };
}

const ORPHAN_PRD_NAMES = ["PRD.md", "prd.md", "SPEC.md", "spec.md"];

function detectOrphanedPrd(root: string): string | null {
  for (const name of ORPHAN_PRD_NAMES) {
    const full = join(root, name);
    if (existsSync(full)) return full;
  }
  const docsDir = join(root, "docs");
  if (existsSync(docsDir)) {
    try {
      for (const entry of readdirSync(docsDir)) {
        if (/^prd[-_.]|^PRD[-_.]/i.test(entry) && entry.endsWith(".md")) return join(docsDir, entry);
      }
    } catch {}
  }
  return null;
}

function hasMdFiles(dir: string): boolean {
  return existsSync(dir) && readdirSafe(dir).some((f) => f.endsWith(".md"));
}

function isBootstrapPhase(root: string, hasStories: boolean, hasPrd: boolean): boolean {
  if (hasStories || hasPrd) return false;
  if (existsSync(join(root, "intent.md")) || existsSync(join(root, "requirements.md"))) return false;
  return Boolean(detectOrphanedPrd(root));
}

function hasTestsDir(root: string): boolean {
  if (existsSync(join(root, "tests"))) return true;
  return readdirSafe(root).some((item) => /(?:^|\/)(test|tests)(?:\/|$)/.test(item));
}

function detectPhase(root: string, hasStories: boolean, hasPrd: boolean): string {
  if (isBootstrapPhase(root, hasStories, hasPrd)) return "bootstrap";
  if (!hasStories && !existsSync(join(root, "intent.md"))) return "intent";
  if (!hasPrd && !existsSync(join(root, "requirements.md"))) return "requirements";
  if (!hasMdFiles(join(root, "adr")) && !existsSync(join(root, "design.md"))) return "design";
  if (!existsSync(join(root, "tasks.md"))) return "tasks";
  if (!hasTestsDir(root)) return "executability";
  return "implementation";
}

function inferPhase(projectRoot: string, state: AgentState): string {
  if (state.current_phase) return state.current_phase;
  if (state.status === "completed") return "completed";
  const root = resolve(projectRoot);
  const hasStories = hasMdFiles(join(root, "stories"));
  const hasPrd = hasMdFiles(join(root, "prd"));
  return detectPhase(root, hasStories, hasPrd);
}

function readdirSafe(root: string): string[] {
  try { return readdirSync(root); } catch { return []; }
}

const PHASE_NEXT: Record<string, string[]> = {
  bootstrap: ["scaffold_spec"],
  intent: ["gate_check:G1"],
  requirements: ["gate_check:G2"],
  design: ["gate_check:G3"],
  tasks: ["gate_check:G4"],
  executability: ["gate_check:G5"],
};

function resolveCompletedCheckNext(lastCheck: string | null): string[] | null {
  if (lastCheck === "G1" || lastCheck === "G2" || lastCheck === "G3" || lastCheck === "G4") return ["run_all"];
  if (lastCheck === "G5" || lastCheck === "run_all") return ["metrics"];
  return null;
}

// After an individual gate passes, redirect to run_all rather than chaining gate_check
// one at a time. Phase-based suggestions use gate_check only when a specific artifact
// is absent and later gates would BLOCK immediately anyway.
function resolveMustCallNext(state: AgentState, phase: string, implementationTouched: boolean): string[] {
  if (state.required_next_checks.length > 0) return state.required_next_checks;
  const fromCheck = resolveCompletedCheckNext(state.last_completed_check);
  if (fromCheck) return fromCheck;
  const fromPhase = PHASE_NEXT[phase];
  if (fromPhase) return fromPhase;
  if (implementationTouched) return ["metrics"];
  return ["run_all"];
}

function resolveGuidanceNotes(blockedBy: string[], shouldCallMetrics: boolean): string[] {
  if (blockedBy.length > 0) return ["Resolve reported open violations before advancing the workflow."];
  if (shouldCallMetrics) return ["Metrics are due because implementation-oriented files changed or the workflow is in review."];
  return ["Report state after substantive progress so the server can compute the next required action."];
}

export function computeWorkflowGuidance(projectRoot: string, state: AgentState): WorkflowGuidance {
  const phase = inferPhase(projectRoot, state);
  const blockedBy = [...state.open_violations];
  const implementationTouched = state.changed_paths.some((path) => /(^|\/)(src|lib|cmd)\//.test(path) || /\.(ts|tsx|js|jsx|py|go|rs|java)$/.test(path));
  const mustCallNext = resolveMustCallNext(state, phase, implementationTouched);
  const shouldCallMetrics = state.metrics_due ?? (implementationTouched || phase === "review");
  return {
    phase,
    must_call_next: mustCallNext,
    should_call_metrics: shouldCallMetrics,
    must_report_state: state.status !== "completed",
    blocked: blockedBy.length > 0,
    blocked_by: blockedBy,
    notes: resolveGuidanceNotes(blockedBy, shouldCallMetrics),
  };
}

export function persistAgentState(
  projectRoot: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  actor: ActorIdentity,
  statePatch: Partial<AgentState>
): AgentSessionRecord {
  const existing = latestAgentState(projectRoot, service, config, actor);
  const state = mergeState(existing ?? DEFAULT_AGENT_STATE, statePatch);
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const timestamp = new Date();
  const filePath = buildFilePath(storage, actor, "agent-state", timestamp);
  writeRecord(filePath, {
    schema_version: 1,
    check_type: "agent-state",
    project_path: resolve(projectRoot),
    org: storage.org,
    repo: storage.repo,
    service: storage.service,
    git_commit: storage.commit8,
    branch: storage.branch,
    timestamp: timestamp.toISOString(),
    ...actorFields(actor),
    current_goal: state.current_goal,
    current_phase: state.current_phase,
    working_set_paths: state.working_set_paths,
    changed_paths: state.changed_paths,
    last_completed_check: state.last_completed_check,
    required_next_checks: state.required_next_checks,
    open_violations: state.open_violations,
    assumptions_declared: state.assumptions_declared,
    metrics_due: state.metrics_due,
    summary_from_agent: state.summary_from_agent,
    status: state.status,
  });
  return {
    project_path: resolve(projectRoot),
    timestamp: timestamp.toISOString(),
    actor,
    ...state,
  };
}

export function beginSession(
  projectRoot: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  actor: ActorIdentity
): BeginSessionResult {
  const record = persistAgentState(projectRoot, service, config, actor, {});
  return {
    project_path: record.project_path,
    actor,
    state: {
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
    },
    workflow: computeWorkflowGuidance(projectRoot, record),
  };
}

export function listAgentState(
  projectRoot: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  sessionId?: string
): AgentStateListResult {
  const rows = readAgentStateRows(projectRoot, service, config)
    .filter((row) => !sessionId || row.actor.session_id === sessionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latestByAgent = new Map<string, AgentSessionRecord>();
  for (const row of rows) latestByAgent.set(row.actor.agent_id, row);
  return {
    project_path: resolve(projectRoot),
    session_id: sessionId ?? null,
    agents: [...latestByAgent.values()].map((row) => ({
      actor: row.actor,
      state: {
        current_goal: row.current_goal,
        current_phase: row.current_phase,
        working_set_paths: row.working_set_paths,
        changed_paths: row.changed_paths,
        last_completed_check: row.last_completed_check,
        required_next_checks: row.required_next_checks,
        open_violations: row.open_violations,
        assumptions_declared: row.assumptions_declared,
        metrics_due: row.metrics_due,
        summary_from_agent: row.summary_from_agent,
        status: row.status,
      },
      timestamp: row.timestamp,
    })),
  };
}
