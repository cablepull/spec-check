import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import duckdb from "duckdb";
import type { Format, GateStatus, ResolvedConfig, ServiceInfo, ReconciliationMetrics, EvidenceMetrics, DiffAdrMetrics } from "./types.js";
import { buildStoragePaths, globPattern } from "./storage.js";
import { listAssumptions } from "./assumptions.js";

type TrendDirection = "improving" | "declining" | "stable" | "insufficient_data";

interface GateRecord {
  timestamp: string;
  gate: string;
  gate_status: string;
  run_batch_id?: string | null;
  results?: unknown;
  criteria?: unknown;
}

interface ComplexityRecord {
  timestamp: string;
  results: Array<{
    cc: number;
    cognitive: number | null;
    length: number;
    nesting: number | null;
    scenario_count?: number;
    cc_delta?: number | null;
    cognitive_delta?: number | null;
    length_delta?: number | null;
    nesting_delta?: number | null;
  }>;
}

interface MutationRecord {
  timestamp: string;
  score: number | null;
  status: string;
}

interface SupersessionRecord {
  timestamp: string;
  artifact_type?: string;
  days_to_invalidation?: number | null;
}

interface AgentSummary {
  agent_id: string;
  agent_kind: string;
  session_id: string | null;
  run_count: number;
  gate_pass_rate: number | null;
  completed_sessions: number;
  metrics_due: boolean | null;
  open_violations: number;
  last_reported_phase: string | null;
  last_timestamp: string | null;
}

export interface ProjectMetrics {
  path: string;
  status: GateStatus;
  since: string | null;
  gate_pass_rates: Record<string, { value: number | null; trend: TrendDirection; history: Array<{ timestamp: string; pass_rate: number; run_batch_id: string | null }> }>;
  top_violations: Array<{ id: string; count: number }>;
  spec_coverage: number | null;
  drift_rate: number | null;
  complexity: {
    cc_average: number | null;
    cc_max: number | null;
    cc_delta: number | null;
    cognitive_average: number | null;
    cognitive_delta: number | null;
    length_average: number | null;
    length_delta: number | null;
    nesting_average: number | null;
    nesting_delta: number | null;
    spec_complexity_ratio: number | null;
    violation_count: number | null;
    trend: TrendDirection;
    history: Array<{ timestamp: string; avg_cc: number; max_cc: number; violations: number }>;
  };
  mutation: {
    latest_score: number | null;
    latest_status: string | null;
    run_count: number;
    trend: TrendDirection;
    history: Array<{ timestamp: string; score: number }>;
  };
  assumptions: {
    invalidation_rate: number | null;
    supersession_rate: number | null;
    average_days_to_supersession: number | null;
  };
  lifecycle: {
    story_cycle_days: number | null;
    rca_resolution_days: number | null;
  };
  compliance_score: number | null;
  reconciliation: ReconciliationMetrics;
  evidence: EvidenceMetrics;
  diff_adr: DiffAdrMetrics;
  agent_activity: AgentSummary[];
  durationMs: number;
  notes: Array<{ code: string; detail: string }>;
}

export interface RollupMetrics {
  status: GateStatus;
  since: string | null;
  projects: Array<{
    project: string;
    compliance_score: number | null;
    gate_breakdown: Record<string, number | null>;
    avg_cc: number | null;
    max_cc: number | null;
    latest_mutation_score: number | null;
    supersession_rate: number | null;
    unresolved_rca_count: number;
  }>;
  model_gate_rankings: Array<{
    model: string;
    overall_pass_rate: number | null;
    gates: Record<string, number | null>;
    runs: number;
  }>;
  model_assumption_accuracy: Array<{
    model: string;
    accuracy: number | null;
    assumptions: number;
    invalidated: number;
  }>;
  model_cc_trends: Array<{ model: string; trend: TrendDirection; average_slope: number | null; runs: number }>;
  agent_gate_rankings: Array<{
    agent_id: string;
    agent_kind: string;
    session_id: string | null;
    overall_pass_rate: number | null;
    gates: Record<string, number | null>;
    runs: number;
    completed_sessions: number;
    metrics_due: boolean | null;
  }>;
  agent_kind_rankings: Array<{
    agent_kind: string;
    overall_pass_rate: number | null;
    runs: number;
    agents: number;
  }>;
  top_projects_by_complexity: Array<{ project: string; avg_cc: number; max_cc: number }>;
  lowest_mutation_projects: Array<{ project: string; mutation_score: number }>;
  highest_supersession_projects: Array<{ project: string; supersession_rate: number }>;
  unresolved_rcas: Array<{ project: string; unresolved: number }>;
  common_violations: Array<{ id: string; count: number }>;
  invalidated_assumption_categories: Array<{ category: string; count: number }>;
  adoption_trend: TrendDirection;
  insufficient_models: string[];
  durationMs: number;
  notes: Array<{ code: string; detail: string }>;
}

function trunc(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function miniBar(value: number | null, max = 100, width = 10): string {
  if (value === null || Number.isNaN(value)) return "·".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function numericSparkline(values: number[], width = 14): string {
  const glyphs = "▁▂▃▄▅▆▇█";
  const slice = values.slice(-width);
  if (slice.length === 0) return "·".repeat(Math.min(width, 4));
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  if (min === max) return "▅".repeat(slice.length);
  return slice.map((value) => {
    const idx = Math.max(0, Math.min(glyphs.length - 1, Math.round(((value - min) / (max - min)) * (glyphs.length - 1))));
    return glyphs[idx]!;
  }).join("");
}

function statusSparkline(values: Array<number | null>, warnCutoff = 50): string {
  return values.slice(-14).map((value) => {
    if (value === null) return "·";
    if (value >= 100) return "✓";
    if (value <= 0) return "✗";
    if (value < warnCutoff) return "△";
    return "✓";
  }).join("");
}

function horizontalBar(count: number, maxCount: number, width = 16): string {
  if (maxCount <= 0) return "·".repeat(width);
  const filled = Math.max(1, Math.round((count / maxCount) * width));
  return `${"█".repeat(Math.min(width, filled))}${"░".repeat(Math.max(0, width - filled))}`;
}

function walkMarkdown(dir: string): string[] {
  const files: string[] = [];
  function scan(current: string) {
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
      const full = join(current, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) scan(full);
      else if (stat.isFile() && full.endsWith(".md")) files.push(full);
    }
  }
  scan(dir);
  return files.sort();
}

function slope(values: number[]): number | null {
  if (values.length < 2) return null;
  const xs = values.map((_, idx) => idx);
  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgY = values.reduce((a, b) => a + b, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    numerator += (xs[i]! - avgX) * (values[i]! - avgY);
    denominator += (xs[i]! - avgX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function trend(values: number[], epsilon = 0.02): TrendDirection {
  const s = slope(values);
  if (s === null) return "insufficient_data";
  if (s > epsilon) return "improving";
  if (s < -epsilon) return "declining";
  return "stable";
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function latest<T extends { timestamp: string }>(items: T[]): T | null {
  if (items.length === 0) return null;
  return [...items].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1) ?? null;
}

function gitCreatedAt(file: string): Date | null {
  try {
    const cwd = resolve(dirname(file));
    const output = execSync(`git -C "${cwd}" log --diff-filter=A --follow --format=%aI -- "${file}" | tail -n 1`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output ? new Date(output) : null;
  } catch {
    return null;
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : ".";
}

function parseResults(results: unknown): Array<{ id: string; status: string }> {
  if (Array.isArray(results)) return results as Array<{ id: string; status: string }>;
  if (typeof results === "string") {
    try { return JSON.parse(results) as Array<{ id: string; status: string }>; } catch { return []; }
  }
  return [];
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try { return JSON.parse(value) as T[]; } catch { return []; }
  }
  return [];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function queryDuckDb(sql: string): Promise<any[]> {
  return new Promise((resolvePromise, reject) => {
    const db = new duckdb.Database(":memory:");
    db.all(sql, (err, rows) => {
      db.close();
      if (err) {
        reject(err);
        return;
      }
      resolvePromise(rows);
    });
  });
}

async function readParquetRows(glob: string, whereClause?: string): Promise<any[]> {
  const source = `read_parquet(${sqlString(glob)}, union_by_name=true)`;
  const sql = `SELECT * FROM ${source}${whereClause ? ` WHERE ${whereClause}` : ""}`;
  try {
    return await queryDuckDb(sql);
  } catch {
    return [];
  }
}

function classifyAssumptionCategory(text: string): string {
  const haystack = text.toLowerCase();
  const taxonomy: Array<{ category: string; pattern: RegExp }> = [
    { category: "auth", pattern: /\b(auth|oauth|login|token|session)\b/ },
    { category: "pagination", pattern: /\b(page|pagination|cursor|offset|limit)\b/ },
    { category: "async", pattern: /\b(async|queue|retry|worker|eventual)\b/ },
    { category: "data-format", pattern: /\b(json|xml|csv|schema|format|payload)\b/ },
    { category: "error-handling", pattern: /\b(error|failure|fallback|timeout|exception)\b/ },
    { category: "infrastructure", pattern: /\b(database|cache|redis|queue|broker|service|cluster)\b/ },
    { category: "ux", pattern: /\b(user|ui|ux|screen|form|click|flow)\b/ },
    { category: "performance", pattern: /\b(latency|performance|throughput|scale|fast|slow)\b/ },
    { category: "security", pattern: /\b(security|encrypt|authorization|authentication|permission|secret)\b/ },
  ];
  for (const item of taxonomy) {
    if (item.pattern.test(haystack)) return item.category;
  }
  return "other";
}

function gateStatusPass(gateStatus: string): boolean {
  return gateStatus === "PASS" || gateStatus === "PASSING_WITH_WARNINGS";
}

function isRowBeforeSince(stamp: number, sinceMs: number | null): boolean {
  return sinceMs !== null && !Number.isNaN(stamp) && stamp < sinceMs;
}

function isGateRow(row: any): boolean {
  return row.check_type === "gate" || /^G[1-5]$/.test(row.gate ?? "");
}

const CC1_THRESHOLD = 10;

type ProjectRowBuckets = {
  gateRecords: GateRecord[];
  complexityRecords: ComplexityRecord[];
  mutationRecords: MutationRecord[];
  supersessionRecords: SupersessionRecord[];
  diffRecords: Array<{ timestamp: string; criteria: Array<{ id: string; status: string }> }>;
  reconciliationRecords: Array<{ timestamp: string; status: string; criteria: string }>;
  evidenceRecords: Array<{ timestamp: string; status: string; criteria: string }>;
  agentStateRows: any[];
};

function dispatchNonGateProjectRow(row: any, b: ProjectRowBuckets): void {
  if (row.check_type === "complexity") { b.complexityRecords.push({ ...row, results: parseJsonArray<ComplexityRecord["results"][number]>(row.results) }); return; }
  if (row.check_type === "mutation") { b.mutationRecords.push(row); return; }
  if (row.check_type === "supersession") { b.supersessionRecords.push(row); return; }
  if (row.check_type === "diff") { b.diffRecords.push({ timestamp: row.timestamp, criteria: parseResults(row.criteria) }); return; }
  if (row.check_type === "reconciliation") { b.reconciliationRecords.push({ timestamp: row.timestamp, status: row.status, criteria: row.criteria }); return; }
  if (row.check_type === "evidence") { b.evidenceRecords.push({ timestamp: row.timestamp, status: row.status, criteria: row.criteria }); return; }
  if (row.check_type === "agent-state") { b.agentStateRows.push(row); return; }
}

function categorizeProjectRows(rows: any[], sinceMs: number | null): ProjectRowBuckets {
  const b: ProjectRowBuckets = {
    gateRecords: [], complexityRecords: [], mutationRecords: [], supersessionRecords: [],
    diffRecords: [], reconciliationRecords: [], evidenceRecords: [], agentStateRows: [],
  };
  for (const row of rows) {
    const stamp = Date.parse(row.timestamp ?? "");
    if (isRowBeforeSince(stamp, sinceMs)) continue;
    if (isGateRow(row)) b.gateRecords.push(row);
    else dispatchNonGateProjectRow(row, b);
  }
  return b;
}

function computeTopViolations(gateRecords: GateRecord[]): Array<{ id: string; count: number }> {
  const violationCounts = new Map<string, number>();
  for (const record of gateRecords) {
    const parsed = parseResults(record.criteria ?? record.results);
    for (const item of parsed) {
      if (item.status === "VIOLATION" || item.status === "BLOCK") {
        violationCounts.set(item.id, (violationCounts.get(item.id) ?? 0) + 1);
      }
    }
  }
  return [...violationCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));
}

function computeGatePassRates(gateRecords: GateRecord[]): ProjectMetrics["gate_pass_rates"] {
  const rates: ProjectMetrics["gate_pass_rates"] = {
    G1: { value: null, trend: "insufficient_data", history: [] },
    G2: { value: null, trend: "insufficient_data", history: [] },
    G3: { value: null, trend: "insufficient_data", history: [] },
    G4: { value: null, trend: "insufficient_data", history: [] },
    G5: { value: null, trend: "insufficient_data", history: [] },
  };
  for (const gate of ["G1", "G2", "G3", "G4", "G5"] as const) {
    const records = gateRecords.filter((record) => record.gate === gate).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const history = records.map((record) => ({ timestamp: record.timestamp, pass_rate: gateStatusPass(record.gate_status) ? 1 : 0, run_batch_id: record.run_batch_id ?? null }));
    // Use only full-sweep (run_all) records for value and trend so targeted gate_check
    // re-runs don't inflate or deflate the aggregate. Fall back to all records when no
    // run_all records exist yet (e.g. early history predating run_batch_id).
    const sweepHistory = history.filter((item) => item.run_batch_id !== null);
    const scoreHistory = sweepHistory.length > 0 ? sweepHistory : history;
    rates[gate] = {
      value: scoreHistory.length > 0 ? (scoreHistory.filter((item) => item.pass_rate === 1).length / scoreHistory.length) * 100 : null,
      trend: trend(scoreHistory.map((item) => item.pass_rate)),
      history,
    };
  }
  return rates;
}

function computeComplexityMetrics(complexityRecords: ComplexityRecord[]): ProjectMetrics["complexity"] {
  const result: ProjectMetrics["complexity"] = {
    cc_average: null, cc_max: null, cc_delta: null,
    cognitive_average: null, cognitive_delta: null,
    length_average: null, length_delta: null,
    nesting_average: null, nesting_delta: null,
    spec_complexity_ratio: null, violation_count: null, trend: "insufficient_data", history: [],
  };
  const complexityHistory = complexityRecords
    .map((record) => {
      const values = record.results ?? [];
      return {
        timestamp: record.timestamp,
        avg_cc: average(values.map((item) => item.cc).filter((v): v is number => typeof v === "number")) ?? 0,
        avg_cognitive: average(values.map((item) => item.cognitive).filter((v): v is number => typeof v === "number")),
        avg_length: average(values.map((item) => item.length).filter((v): v is number => typeof v === "number")),
        avg_nesting: average(values.map((item) => item.nesting).filter((v): v is number => typeof v === "number")),
        avg_cc_delta: average(values.map((item) => item.cc_delta).filter((v): v is number => typeof v === "number")),
        avg_cognitive_delta: average(values.map((item) => item.cognitive_delta).filter((v): v is number => typeof v === "number")),
        avg_length_delta: average(values.map((item) => item.length_delta).filter((v): v is number => typeof v === "number")),
        avg_nesting_delta: average(values.map((item) => item.nesting_delta).filter((v): v is number => typeof v === "number")),
        max_cc: values.reduce((max, item) => Math.max(max, item.cc ?? 0), 0),
        violations: values.filter((item) => (item.cc ?? 0) > CC1_THRESHOLD).length,
        avg_gap: average(values.map((item) => (item.cc ?? 0) - (item.scenario_count ?? 0))),
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latestComplexity = latest(complexityHistory);
  if (latestComplexity) {
    result.cc_average = latestComplexity.avg_cc;
    result.cc_max = latestComplexity.max_cc;
    result.cc_delta = latestComplexity.avg_cc_delta;
    result.cognitive_average = latestComplexity.avg_cognitive;
    result.cognitive_delta = latestComplexity.avg_cognitive_delta;
    result.length_average = latestComplexity.avg_length;
    result.length_delta = latestComplexity.avg_length_delta;
    result.nesting_average = latestComplexity.avg_nesting;
    result.nesting_delta = latestComplexity.avg_nesting_delta;
    result.spec_complexity_ratio = latestComplexity.avg_gap;
    result.violation_count = latestComplexity.violations;
    result.history = complexityHistory.map((item) => ({ timestamp: item.timestamp, avg_cc: item.avg_cc, max_cc: item.max_cc, violations: item.violations }));
    result.trend = trend(complexityHistory.map((item) => item.avg_cc));
  }
  return result;
}

function computeMutationMetrics(mutationRecords: MutationRecord[]): ProjectMetrics["mutation"] {
  const mutationHistory = mutationRecords
    .map((record) => ({ timestamp: record.timestamp, score: numberOrNull(record.score) }))
    .filter((record): record is { timestamp: string; score: number } => record.score !== null)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    history: mutationHistory,
    latest_score: mutationHistory.at(-1)?.score ?? null,
    latest_status: latest(mutationRecords)?.status ?? null,
    run_count: mutationRecords.length,
    trend: trend(mutationHistory.map((item) => item.score)),
  };
}

function computeAgentActivity(gateRecords: GateRecord[], agentStateRows: any[]): AgentSummary[] {
  const gateRowsByAgent = new Map<string, Array<{ pass: number; gate: string }>>();
  for (const row of gateRecords as Array<GateRecord & { agent_id?: string }>) {
    if (!row.agent_id) continue;
    const current = gateRowsByAgent.get(row.agent_id) ?? [];
    current.push({ pass: gateStatusPass(row.gate_status) ? 100 : 0, gate: row.gate });
    gateRowsByAgent.set(row.agent_id, current);
  }
  const latestStateByAgent = new Map<string, any>();
  for (const row of agentStateRows.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")))) {
    if (row.agent_id) latestStateByAgent.set(String(row.agent_id), row);
  }
  return [...new Set([...gateRowsByAgent.keys(), ...latestStateByAgent.keys()])]
    .map((agentId) => {
      const gateRuns = gateRowsByAgent.get(agentId) ?? [];
      const latestState = latestStateByAgent.get(agentId);
      return {
        agent_id: agentId,
        agent_kind: String(latestState?.agent_kind ?? "unknown"),
        session_id: latestState?.session_id ? String(latestState.session_id) : null,
        run_count: gateRuns.length,
        gate_pass_rate: gateRuns.length > 0 ? average(gateRuns.map((item) => item.pass)) : null,
        completed_sessions: latestState?.status === "completed" ? 1 : 0,
        metrics_due: typeof latestState?.metrics_due === "boolean" ? latestState.metrics_due : null,
        open_violations: parseJsonArray<string>(latestState?.open_violations).length,
        last_reported_phase: latestState?.current_phase ? String(latestState.current_phase) : null,
        last_timestamp: latestState?.timestamp ? String(latestState.timestamp) : null,
      };
    })
    .sort((a, b) => (b.gate_pass_rate ?? -1) - (a.gate_pass_rate ?? -1) || a.agent_id.localeCompare(b.agent_id));
}

function computeAssumptionRates(targetPath: string, supersessionRecords: SupersessionRecord[]): ProjectMetrics["assumptions"] {
  const result: ProjectMetrics["assumptions"] = {
    invalidation_rate: null,
    supersession_rate: null,
    average_days_to_supersession: null,
  };
  if (supersessionRecords.length > 0) {
    result.average_days_to_supersession = average(
      supersessionRecords.map((item) => item.days_to_invalidation).filter((v): v is number => typeof v === "number")
    );
  }
  const assumptionListing = listAssumptions(resolve(targetPath), true);
  const totalAssumptions = assumptionListing.items.reduce((sum, item) => sum + item.assumptions.length, 0);
  const invalidatedAssumptions = assumptionListing.items.reduce(
    (sum, item) => sum + item.assumptions.filter((row) => /invalidated/i.test(row.status)).length,
    0
  );
  if (totalAssumptions > 0) {
    result.invalidation_rate = (invalidatedAssumptions / totalAssumptions) * 100;
  }
  const markdownArtifacts = walkMarkdown(resolve(targetPath));
  const supersededArtifacts = new Set(supersessionRecords.map((item: any) => item.archive_artifact ?? item.original_artifact).filter(Boolean)).size;
  if (markdownArtifacts.length > 0) {
    result.supersession_rate = (supersededArtifacts / markdownArtifacts.length) * 100;
  }
  return result;
}

function computeStoryCycleDays(targetPath: string): number | null {
  const tasksPath = join(resolve(targetPath), "tasks.md");
  const storyPath = join(resolve(targetPath), "stories");
  if (!existsSync(tasksPath) || !existsSync(storyPath)) return null;
  const created = gitCreatedAt(tasksPath);
  const tasksText = readFileSync(tasksPath, "utf-8");
  if (created && /- \[x\]/.test(tasksText) && !/- \[ \]/.test(tasksText)) {
    return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  }
  return null;
}

function isRcaResolved(text: string): boolean {
  const specNo = /^\s*## Spec Update Required\s*[\r\n]+yes\s*$/im.test(text) ? false : /## Spec Update Required[\s\S]*?\bNo\b/i.test(text);
  const adrNo = /^\s*## ADR Required\s*[\r\n]+yes\s*$/im.test(text) ? false : /## ADR Required[\s\S]*?\bNo\b/i.test(text);
  return specNo && adrNo;
}

function computeRcaResolutionDays(targetPath: string): number | null {
  const rcaDir = join(resolve(targetPath), "rca");
  if (!existsSync(rcaDir)) return null;
  const rcas = readdirSync(rcaDir).filter((file) => file.endsWith(".md"));
  const resolvedDays: number[] = [];
  for (const file of rcas) {
    const full = join(rcaDir, file);
    const created = gitCreatedAt(full);
    if (created && isRcaResolved(readFileSync(full, "utf-8"))) {
      resolvedDays.push(Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000)));
    }
  }
  return average(resolvedDays);
}

function computeLifecycle(targetPath: string): ProjectMetrics["lifecycle"] {
  return {
    story_cycle_days: computeStoryCycleDays(targetPath),
    rca_resolution_days: computeRcaResolutionDays(targetPath),
  };
}

function computeReconciliationPassRates(
  reconciliationRecords: Array<{ timestamp: string; status: string; criteria: string }>
): ReconciliationMetrics {
  if (reconciliationRecords.length === 0) {
    return { rc1_pass_rate: null, rc2_pass_rate: null, latest_status: null, run_count: 0 };
  }
  const parseCriteria = (rec: { criteria: unknown }) => parseResults(rec.criteria);
  const rc1Passes = reconciliationRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "RC-1")?.status === "PASS").length;
  const rc2Passes = reconciliationRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "RC-2")?.status === "PASS").length;
  const latestRec = latest(reconciliationRecords);
  return {
    rc1_pass_rate: (rc1Passes / reconciliationRecords.length) * 100,
    rc2_pass_rate: (rc2Passes / reconciliationRecords.length) * 100,
    latest_status: (latestRec?.status as GateStatus) ?? null,
    run_count: reconciliationRecords.length,
  };
}

function computeEvidencePassRates(
  evidenceRecords: Array<{ timestamp: string; status: string; criteria: string }>
): EvidenceMetrics {
  if (evidenceRecords.length === 0) {
    return { ev1_pass_rate: null, ev2_pass_rate: null, latest_status: null, run_count: 0 };
  }
  const parseCriteria = (rec: { criteria: unknown }) => parseResults(rec.criteria);
  const ev1Passes = evidenceRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "EV-1")?.status === "PASS").length;
  const ev2Passes = evidenceRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "EV-2")?.status === "PASS").length;
  const latestEv = latest(evidenceRecords);
  return {
    ev1_pass_rate: (ev1Passes / evidenceRecords.length) * 100,
    ev2_pass_rate: (ev2Passes / evidenceRecords.length) * 100,
    latest_status: (latestEv?.status as GateStatus) ?? null,
    run_count: evidenceRecords.length,
  };
}

function computeDiffAdrPassRates(
  diffRecords: Array<{ timestamp: string; criteria: Array<{ id: string; status: string }> }>
): DiffAdrMetrics {
  if (diffRecords.length === 0) {
    return { dadr1_pass_rate: null, dadr2_pass_rate: null, dadr3_pass_rate: null, checked_diffs: 0 };
  }
  const diffsWithDep = diffRecords.filter((rec) => rec.criteria.some((c) => c.id === "D-ADR-1"));
  const diffsWithSec = diffRecords.filter((rec) => rec.criteria.some((c) => c.id === "D-ADR-2"));
  const diffsWithDep3 = diffRecords.filter((rec) => rec.criteria.some((c) => c.id === "D-ADR-3"));
  const passRate = (recs: typeof diffRecords, id: string) =>
    recs.length === 0 ? null
      : (recs.filter((rec) => rec.criteria.find((c) => c.id === id)?.status === "PASS").length / recs.length) * 100;
  return {
    dadr1_pass_rate: passRate(diffsWithDep, "D-ADR-1"),
    dadr2_pass_rate: passRate(diffsWithSec, "D-ADR-2"),
    dadr3_pass_rate: passRate(diffsWithDep3, "D-ADR-3"),
    checked_diffs: diffRecords.length,
  };
}

function hasDriftViolation(record: { criteria: Array<{ id: string; status: string }> }): boolean {
  return record.criteria.some((item) => item.id === "R-26" && item.status === "VIOLATION");
}

function hasNoProjectData(g: GateRecord[], c: ComplexityRecord[], m: MutationRecord[], s: SupersessionRecord[], d: unknown[]): boolean {
  return g.length === 0 && c.length === 0 && m.length === 0 && s.length === 0 && d.length === 0;
}

function computeSpecCoverageAndCompliance(
  targetPath: string,
  gatePassRates: ProjectMetrics["gate_pass_rates"],
  weights: ResolvedConfig["value"]["compliance_weights"]
): { spec_coverage: number | null; compliance_score: number | null } {
  let spec_coverage: number | null = null;
  const storyDir = join(resolve(targetPath), "stories");
  if (existsSync(storyDir) && readdirSync(storyDir).some((f) => f.endsWith(".md"))) {
    spec_coverage = ((gatePassRates.G1.value ?? 0) + (gatePassRates.G2.value ?? 0) + (gatePassRates.G3.value ?? 0) + (gatePassRates.G4.value ?? 0)) / 4;
  }
  let compliance_score: number | null = null;
  if (Object.values(gatePassRates).some((item) => item.value !== null)) {
    compliance_score =
      ((gatePassRates.G1.value ?? 0) * weights.G1) +
      ((gatePassRates.G2.value ?? 0) * weights.G2) +
      ((gatePassRates.G3.value ?? 0) * weights.G3) +
      ((gatePassRates.G4.value ?? 0) * weights.G4) +
      ((gatePassRates.G5.value ?? 0) * weights.G5);
  }
  return { spec_coverage, compliance_score };
}

export async function getProjectMetrics(
  targetPath: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  since?: string
): Promise<ProjectMetrics> {
  const start = Date.now();
  const notes: ProjectMetrics["notes"] = [];
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const root = join(storage.storageRoot, storage.org, storage.repo, storage.service);
  const sinceMs = since ? Date.parse(since) : null;
  const projectPath = resolve(targetPath);

  const metrics: ProjectMetrics = {
    path: projectPath,
    status: "PASS",
    since: since ?? null,
    gate_pass_rates: {
      G1: { value: null, trend: "insufficient_data", history: [] },
      G2: { value: null, trend: "insufficient_data", history: [] },
      G3: { value: null, trend: "insufficient_data", history: [] },
      G4: { value: null, trend: "insufficient_data", history: [] },
      G5: { value: null, trend: "insufficient_data", history: [] },
    },
    top_violations: [],
    spec_coverage: null,
    drift_rate: null,
    complexity: {
      cc_average: null, cc_max: null, cc_delta: null,
      cognitive_average: null, cognitive_delta: null,
      length_average: null, length_delta: null,
      nesting_average: null, nesting_delta: null,
      spec_complexity_ratio: null, violation_count: null, trend: "insufficient_data", history: [],
    },
    mutation: { latest_score: null, latest_status: null, run_count: 0, trend: "insufficient_data", history: [] },
    assumptions: { invalidation_rate: null, supersession_rate: null, average_days_to_supersession: null },
    lifecycle: { story_cycle_days: null, rca_resolution_days: null },
    compliance_score: null,
    reconciliation: { rc1_pass_rate: null, rc2_pass_rate: null, latest_status: null, run_count: 0 },
    evidence: { ev1_pass_rate: null, ev2_pass_rate: null, latest_status: null, run_count: 0 },
    diff_adr: { dadr1_pass_rate: null, dadr2_pass_rate: null, dadr3_pass_rate: null, checked_diffs: 0 },
    agent_activity: [],
    durationMs: 0,
    notes,
  };

  if (!existsSync(root)) {
    notes.push({ code: "NO_DATA", detail: "No stored metrics data exists for this project yet." });
    metrics.durationMs = Date.now() - start;
    return metrics;
  }

  const rows = await readParquetRows(
    globPattern(storage.storageRoot, storage.org, storage.repo, storage.service),
    `project_path = ${sqlString(projectPath)}`
  );
  if (rows.length === 0) {
    notes.push({ code: "NO_DATA", detail: "No stored metrics data exists for this project yet." });
    metrics.durationMs = Date.now() - start;
    return metrics;
  }

  const { gateRecords, complexityRecords, mutationRecords, supersessionRecords, diffRecords, reconciliationRecords, evidenceRecords, agentStateRows } = categorizeProjectRows(rows, sinceMs);

  metrics.top_violations = computeTopViolations(gateRecords);
  metrics.gate_pass_rates = computeGatePassRates(gateRecords);
  metrics.complexity = computeComplexityMetrics(complexityRecords);
  metrics.mutation = computeMutationMetrics(mutationRecords);
  metrics.agent_activity = computeAgentActivity(gateRecords, agentStateRows);
  metrics.assumptions = computeAssumptionRates(targetPath, supersessionRecords);
  metrics.lifecycle = computeLifecycle(targetPath);
  metrics.reconciliation = computeReconciliationPassRates(reconciliationRecords);
  metrics.evidence = computeEvidencePassRates(evidenceRecords);
  metrics.diff_adr = computeDiffAdrPassRates(diffRecords);

  if (diffRecords.length > 0) {
    metrics.drift_rate = (diffRecords.filter(hasDriftViolation).length / diffRecords.length) * 100;
  }

  const coverage = computeSpecCoverageAndCompliance(targetPath, metrics.gate_pass_rates, config.value.compliance_weights);
  metrics.spec_coverage = coverage.spec_coverage;
  metrics.compliance_score = coverage.compliance_score;

  if (hasNoProjectData(gateRecords, complexityRecords, mutationRecords, supersessionRecords, diffRecords)) {
    notes.push({ code: "NO_DATA", detail: "No stored metrics data exists for this project yet." });
  }

  metrics.status =
    metrics.top_violations.length > 0 ? "PASSING_WITH_WARNINGS" :
    notes.some((note) => note.code === "NO_DATA") ? "PASS" :
    "PASS";
  metrics.durationMs = Date.now() - start;
  return metrics;
}

function arrow(direction: TrendDirection): string {
  if (direction === "improving") return "↑";
  if (direction === "declining") return "↓";
  if (direction === "stable") return "→";
  return "?";
}

function formatSummaryLines(result: ProjectMetrics): string[] {
  const pct = (v: number | null) => v === null ? "n/a" : `${v.toFixed(0)}%`;
  return [
    "─".repeat(60),
    `Compliance Score: ${result.compliance_score === null ? "n/a" : result.compliance_score.toFixed(1)}  ${miniBar(result.compliance_score)}`,
    `Spec Coverage: ${result.spec_coverage === null ? "n/a" : `${result.spec_coverage.toFixed(1)}%`}`,
    `Drift Rate: ${result.drift_rate === null ? "n/a" : `${result.drift_rate.toFixed(1)}%`}`,
    "─".repeat(60),
    `Complexity: avg CC ${result.complexity.cc_average?.toFixed(2) ?? "n/a"} ${arrow(result.complexity.trend)} | max CC ${result.complexity.cc_max ?? "n/a"} | gap ${result.complexity.spec_complexity_ratio?.toFixed(2) ?? "n/a"} | ${numericSparkline(result.complexity.history.map((item) => item.avg_cc))}`,
    `Mutation: ${result.mutation.latest_score === null ? "n/a" : `${result.mutation.latest_score.toFixed(1)}%`} ${arrow(result.mutation.trend)} | ${numericSparkline(result.mutation.history.map((item) => item.score), 10)}`,
    `Assumptions: invalidation ${result.assumptions.invalidation_rate === null ? "n/a" : result.assumptions.invalidation_rate.toFixed(1)} | supersession ${result.assumptions.supersession_rate === null ? "n/a" : result.assumptions.supersession_rate.toFixed(1)}`,
    "─".repeat(60),
    "Quality Signals:",
    `  Reconciliation (${result.reconciliation.run_count} runs): RC-1 ${pct(result.reconciliation.rc1_pass_rate)} | RC-2 ${pct(result.reconciliation.rc2_pass_rate)}`,
    `  Evidence (${result.evidence.run_count} runs):      EV-1 ${pct(result.evidence.ev1_pass_rate)} | EV-2 ${pct(result.evidence.ev2_pass_rate)}`,
    `  Diff ADR (${result.diff_adr.checked_diffs} diffs): D-ADR-1 ${pct(result.diff_adr.dadr1_pass_rate)} | D-ADR-2 ${pct(result.diff_adr.dadr2_pass_rate)} | D-ADR-3 ${pct(result.diff_adr.dadr3_pass_rate)}`,
  ];
}

function formatAgentActivityLines(activity: ProjectMetrics["agent_activity"]): string[] {
  if (activity.length === 0) return [];
  const lines = ["─".repeat(60), "Agent Activity:"];
  for (const item of activity.slice(0, 10)) {
    lines.push(`  • ${trunc(item.agent_id, 20)} (${item.agent_kind}): pass=${item.gate_pass_rate === null ? "n/a" : `${item.gate_pass_rate.toFixed(1)}%`} runs=${item.run_count} phase=${item.last_reported_phase ?? "n/a"}${item.metrics_due === true ? " metrics_due" : ""}`);
  }
  return lines;
}

function formatViolationsLines(violations: ProjectMetrics["top_violations"]): string[] {
  const lines = ["─".repeat(60), "Top Violations:"];
  if (violations.length === 0) { lines.push("  none"); return lines; }
  const maxCount = Math.max(0, ...violations.map((item) => item.count));
  for (const item of violations) {
    lines.push(`  • ${item.id.padEnd(8, " ")} ${horizontalBar(item.count, maxCount)} ${item.count}`);
  }
  return lines;
}

function formatProjectMetricsMermaid(result: ProjectMetrics): string {
  return [
    "```mermaid",
    "xychart-beta",
    '  title "Gate Pass Rates"',
    "  x-axis [G1, G2, G3, G4, G5]",
    `  bar [${Object.values(result.gate_pass_rates).map((item) => item.value === null ? 0 : Number(item.value.toFixed(1))).join(", ")}]`,
    "```",
    "",
    "```mermaid",
    "xychart-beta",
    '  title "Complexity Trend"',
    `  x-axis [${result.complexity.history.map((_, idx) => idx + 1).join(", ")}]`,
    `  line [${result.complexity.history.map((item) => Number(item.avg_cc.toFixed(2))).join(", ")}]`,
    "```",
  ].join("\n");
}

function formatProjectMetricsText(result: ProjectMetrics): string {
  const lines = [
    `Project Metrics — ${result.status}`,
    `Path: ${result.path}`,
    `Since: ${result.since ?? "all-time"}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    "Gate Pass Rates:",
  ];
  for (const [gate, item] of Object.entries(result.gate_pass_rates)) {
    lines.push(`  ${gate}: ${item.value === null ? "n/a" : `${item.value.toFixed(1)}%`} ${arrow(item.trend)}  ${statusSparkline(item.history.map((entry) => entry.pass_rate * 100))}`);
  }
  lines.push(...formatSummaryLines(result));
  lines.push(...formatAgentActivityLines(result.agent_activity));
  lines.push(...formatViolationsLines(result.top_violations));
  if (result.notes.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Notes:");
    for (const note of result.notes) lines.push(`  • [${note.code}] ${note.detail}`);
  }
  return lines.join("\n");
}

export function formatProjectMetrics(result: ProjectMetrics, format: Extract<Format, "text" | "json" | "mermaid"> = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "mermaid") return formatProjectMetricsMermaid(result);
  return formatProjectMetricsText(result);
}

type RollupProjectEntry = {
  gates: Record<string, number[]>;
  ccs: number[];
  mutationScores: number[];
  supersessions: number;
  unresolvedRcas: number;
};

function getOrInitProjectEntry(map: Map<string, RollupProjectEntry>, key: string): RollupProjectEntry {
  if (!map.has(key)) {
    map.set(key, { gates: { G1: [], G2: [], G3: [], G4: [], G5: [] }, ccs: [], mutationScores: [], supersessions: 0, unresolvedRcas: 0 });
  }
  return map.get(key)!;
}

function rollupProjectKey(row: any): string {
  return `${row.org ?? "local"}/${row.repo ?? "unknown"}/${row.service ?? "root"}`;
}

function accumulateViolations(row: any, violationCounts: Map<string, number>): void {
  for (const criterion of parseResults(row.criteria ?? row.results)) {
    if (criterion.status === "VIOLATION" || criterion.status === "BLOCK") {
      violationCounts.set(criterion.id, (violationCounts.get(criterion.id) ?? 0) + 1);
    }
  }
}

function categorizeRollupRows(rows: any[], sinceMs: number | null): {
  gateRows: any[];
  complexityRows: any[];
  mutationRows: any[];
  supersessionRows: any[];
  agentStateRows: any[];
  violationCounts: Map<string, number>;
  assumptionCategoryCounts: Map<string, number>;
} {
  const gateRows: any[] = [];
  const complexityRows: any[] = [];
  const mutationRows: any[] = [];
  const supersessionRows: any[] = [];
  const agentStateRows: any[] = [];
  const violationCounts = new Map<string, number>();
  const assumptionCategoryCounts = new Map<string, number>();
  for (const row of rows) {
    const stamp = Date.parse(row.timestamp ?? "");
    if (isRowBeforeSince(stamp, sinceMs)) continue;
    if (isGateRow(row)) {
      gateRows.push(row);
      accumulateViolations(row, violationCounts);
    } else if (row.check_type === "complexity") {
      complexityRows.push({ ...row, results: parseJsonArray(row.results) });
    } else if (row.check_type === "mutation") {
      mutationRows.push(row);
    } else if (row.check_type === "supersession") {
      supersessionRows.push(row);
      const category = classifyAssumptionCategory(`${row.assumption_text ?? ""} ${row.reason ?? ""}`);
      assumptionCategoryCounts.set(category, (assumptionCategoryCounts.get(category) ?? 0) + 1);
    } else if (row.check_type === "agent-state") {
      agentStateRows.push(row);
    }
  }
  return { gateRows, complexityRows, mutationRows, supersessionRows, agentStateRows, violationCounts, assumptionCategoryCounts };
}

type AgentGateEntry = {
  agent_id: string;
  agent_kind: string;
  session_id: string | null;
  gates: Record<string, number[]>;
  runs: number;
  completed_sessions: number;
  metrics_due: boolean | null;
};

function populateGateRowMaps(
  gateRows: any[],
  projectMap: Map<string, RollupProjectEntry>,
  modelGateMap: Map<string, { gates: Record<string, number[]>; runs: number }>,
  agentGateMap: Map<string, AgentGateEntry>
): void {
  for (const row of gateRows) {
    const pass = gateStatusPass(row.gate_status) ? 100 : 0;
    const projectEntry = getOrInitProjectEntry(projectMap, rollupProjectKey(row));
    if (projectEntry.gates[row.gate]) projectEntry.gates[row.gate]!.push(pass);
    const model = row.llm_model ?? row.llm_id ?? "unknown";
    const modelEntry = modelGateMap.get(model) ?? { gates: { G1: [], G2: [], G3: [], G4: [], G5: [] }, runs: 0 };
    if (modelEntry.gates[row.gate]) modelEntry.gates[row.gate]!.push(pass);
    modelEntry.runs += 1;
    modelGateMap.set(model, modelEntry);
    if (row.agent_id) {
      const agentEntry = agentGateMap.get(String(row.agent_id)) ?? {
        agent_id: String(row.agent_id), agent_kind: String(row.agent_kind ?? "unknown"),
        session_id: row.session_id ? String(row.session_id) : null,
        gates: { G1: [], G2: [], G3: [], G4: [], G5: [] }, runs: 0, completed_sessions: 0, metrics_due: null,
      };
      if (agentEntry.gates[row.gate]) agentEntry.gates[row.gate]!.push(pass);
      agentEntry.runs += 1;
      agentGateMap.set(agentEntry.agent_id, agentEntry);
    }
  }
}

function populateComplexityRowMaps(
  complexityRows: any[],
  projectMap: Map<string, RollupProjectEntry>,
  modelCcMap: Map<string, { values: number[]; runs: number }>
): void {
  for (const row of complexityRows) {
    const ccs = (row.results ?? []).map((item: any) => item.cc).filter((v: any) => typeof v === "number");
    getOrInitProjectEntry(projectMap, rollupProjectKey(row)).ccs.push(...ccs);
    const model = row.llm_model ?? row.llm_id ?? "unknown";
    const modelEntry = modelCcMap.get(model) ?? { values: [], runs: 0 };
    modelEntry.values.push(average(ccs) ?? 0);
    modelEntry.runs += 1;
    modelCcMap.set(model, modelEntry);
  }
}

function populateMutationRowMap(mutationRows: any[], projectMap: Map<string, RollupProjectEntry>): void {
  for (const row of mutationRows) {
    const score = numberOrNull(row.score);
    if (score !== null) getOrInitProjectEntry(projectMap, rollupProjectKey(row)).mutationScores.push(score);
  }
}

function populateSupersessionRowMaps(
  supersessionRows: any[],
  projectMap: Map<string, RollupProjectEntry>,
  modelAssumptionMap: Map<string, { made: number; invalidated: number }>
): void {
  for (const row of supersessionRows) {
    getOrInitProjectEntry(projectMap, rollupProjectKey(row)).supersessions += 1;
    const model = row.llm_model ?? row.llm_id ?? row.original_model ?? "unknown";
    const modelEntry = modelAssumptionMap.get(model) ?? { made: 0, invalidated: 0 };
    modelEntry.invalidated += 1;
    modelAssumptionMap.set(model, modelEntry);
  }
}

function populateAgentStateMap(agentStateRows: any[], agentGateMap: Map<string, AgentGateEntry>): void {
  for (const row of agentStateRows.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")))) {
    if (!row.agent_id) continue;
    const agentEntry = agentGateMap.get(String(row.agent_id)) ?? {
      agent_id: String(row.agent_id), agent_kind: String(row.agent_kind ?? "unknown"),
      session_id: row.session_id ? String(row.session_id) : null,
      gates: { G1: [], G2: [], G3: [], G4: [], G5: [] }, runs: 0, completed_sessions: 0, metrics_due: null,
    };
    agentEntry.agent_kind = String(row.agent_kind ?? agentEntry.agent_kind);
    agentEntry.session_id = row.session_id ? String(row.session_id) : agentEntry.session_id;
    agentEntry.metrics_due = typeof row.metrics_due === "boolean" ? row.metrics_due : agentEntry.metrics_due;
    if (row.status === "completed") agentEntry.completed_sessions += 1;
    agentGateMap.set(agentEntry.agent_id, agentEntry);
  }
}

function buildRollupMaps(
  gateRows: any[],
  complexityRows: any[],
  mutationRows: any[],
  supersessionRows: any[],
  agentStateRows: any[]
): {
  projectMap: Map<string, RollupProjectEntry>;
  modelGateMap: Map<string, { gates: Record<string, number[]>; runs: number }>;
  modelAssumptionMap: Map<string, { made: number; invalidated: number }>;
  modelCcMap: Map<string, { values: number[]; runs: number }>;
  agentGateMap: Map<string, AgentGateEntry>;
} {
  const projectMap = new Map<string, RollupProjectEntry>();
  const modelGateMap = new Map<string, { gates: Record<string, number[]>; runs: number }>();
  const modelAssumptionMap = new Map<string, { made: number; invalidated: number }>();
  const modelCcMap = new Map<string, { values: number[]; runs: number }>();
  const agentGateMap = new Map<string, AgentGateEntry>();
  populateGateRowMaps(gateRows, projectMap, modelGateMap, agentGateMap);
  populateComplexityRowMaps(complexityRows, projectMap, modelCcMap);
  populateMutationRowMap(mutationRows, projectMap);
  populateSupersessionRowMaps(supersessionRows, projectMap, modelAssumptionMap);
  populateAgentStateMap(agentStateRows, agentGateMap);
  return { projectMap, modelGateMap, modelAssumptionMap, modelCcMap, agentGateMap };
}

function buildRollupProjectResults(
  projectMap: Map<string, RollupProjectEntry>,
  config: ResolvedConfig
): {
  projects: RollupMetrics["projects"];
  top_projects_by_complexity: RollupMetrics["top_projects_by_complexity"];
  lowest_mutation_projects: RollupMetrics["lowest_mutation_projects"];
  highest_supersession_projects: RollupMetrics["highest_supersession_projects"];
  unresolved_rcas: RollupMetrics["unresolved_rcas"];
} {
  const projects: RollupMetrics["projects"] = [];
  for (const [project, entry] of projectMap.entries()) {
    const gateBreakdown = Object.fromEntries(
      Object.entries(entry.gates).map(([gate, values]) => [gate, values.length > 0 ? average(values) : null])
    );
    const complianceScore =
      ((gateBreakdown.G1 ?? 0) * config.value.compliance_weights.G1) +
      ((gateBreakdown.G2 ?? 0) * config.value.compliance_weights.G2) +
      ((gateBreakdown.G3 ?? 0) * config.value.compliance_weights.G3) +
      ((gateBreakdown.G4 ?? 0) * config.value.compliance_weights.G4) +
      ((gateBreakdown.G5 ?? 0) * config.value.compliance_weights.G5);
    projects.push({
      project,
      compliance_score: Object.values(gateBreakdown).some((v) => v !== null) ? complianceScore : null,
      gate_breakdown: gateBreakdown,
      avg_cc: average(entry.ccs),
      max_cc: entry.ccs.length > 0 ? Math.max(...entry.ccs) : null,
      latest_mutation_score: entry.mutationScores.length > 0 ? entry.mutationScores[entry.mutationScores.length - 1]! : null,
      supersession_rate: entry.supersessions,
      unresolved_rca_count: entry.unresolvedRcas,
    });
  }
  projects.sort((a, b) => (b.compliance_score ?? -1) - (a.compliance_score ?? -1));
  return {
    projects,
    top_projects_by_complexity: [...projects]
      .filter((item) => item.max_cc !== null)
      .sort((a, b) => (b.max_cc ?? 0) - (a.max_cc ?? 0))
      .slice(0, 10)
      .map((item) => ({ project: item.project, avg_cc: item.avg_cc!, max_cc: item.max_cc! })),
    lowest_mutation_projects: [...projects]
      .filter((item) => item.latest_mutation_score !== null)
      .sort((a, b) => (a.latest_mutation_score ?? 101) - (b.latest_mutation_score ?? 101))
      .slice(0, 10)
      .map((item) => ({ project: item.project, mutation_score: item.latest_mutation_score! })),
    highest_supersession_projects: [...projects]
      .sort((a, b) => (b.supersession_rate ?? 0) - (a.supersession_rate ?? 0))
      .slice(0, 10)
      .map((item) => ({ project: item.project, supersession_rate: item.supersession_rate ?? 0 })),
    unresolved_rcas: [...projects]
      .filter((item) => item.unresolved_rca_count > 0)
      .sort((a, b) => b.unresolved_rca_count - a.unresolved_rca_count)
      .slice(0, 10)
      .map((item) => ({ project: item.project, unresolved: item.unresolved_rca_count })),
  };
}

function buildRollupRankings(
  modelGateMap: Map<string, { gates: Record<string, number[]>; runs: number }>,
  modelAssumptionMap: Map<string, { made: number; invalidated: number }>,
  modelCcMap: Map<string, { values: number[]; runs: number }>,
  agentGateMap: Map<string, AgentGateEntry>
): {
  model_gate_rankings: RollupMetrics["model_gate_rankings"];
  model_assumption_accuracy: RollupMetrics["model_assumption_accuracy"];
  model_cc_trends: RollupMetrics["model_cc_trends"];
  agent_gate_rankings: RollupMetrics["agent_gate_rankings"];
  agent_kind_rankings: RollupMetrics["agent_kind_rankings"];
  insufficient_models: string[];
} {
  const agentKindGateMap = new Map<string, { values: number[]; agents: Set<string> }>();
  const insufficient_models: string[] = [];

  const model_gate_rankings: RollupMetrics["model_gate_rankings"] = [...modelGateMap.entries()]
    .map(([model, entry]) => {
      const gates = Object.fromEntries(
        Object.entries(entry.gates).map(([gate, values]) => [gate, values.length > 0 ? average(values) : null])
      );
      const overallValues = Object.values(entry.gates).flat();
      return {
        model,
        overall_pass_rate: overallValues.length > 0 ? average(overallValues) : null,
        gates,
        runs: entry.runs,
      };
    })
    .sort((a, b) => (b.overall_pass_rate ?? -1) - (a.overall_pass_rate ?? -1));

  for (const ranking of model_gate_rankings) {
    if (ranking.runs < 2) insufficient_models.push(ranking.model);
  }

  const model_assumption_accuracy: RollupMetrics["model_assumption_accuracy"] = [...modelAssumptionMap.entries()]
    .map(([model, entry]) => ({
      model,
      accuracy: entry.made >= 5 ? ((entry.made - entry.invalidated) / entry.made) * 100 : null,
      assumptions: entry.made,
      invalidated: entry.invalidated,
    }))
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));

  const model_cc_trends: RollupMetrics["model_cc_trends"] = [...modelCcMap.entries()]
    .map(([model, entry]) => ({
      model,
      trend: trend(entry.values),
      average_slope: slope(entry.values),
      runs: entry.runs,
    }))
    .sort((a, b) => (a.average_slope ?? 999) - (b.average_slope ?? 999));

  const agent_gate_rankings: RollupMetrics["agent_gate_rankings"] = [...agentGateMap.values()]
    .map((entry) => {
      const gates = Object.fromEntries(
        Object.entries(entry.gates).map(([gate, values]) => [gate, values.length > 0 ? average(values) : null])
      );
      const overallValues = Object.values(entry.gates).flat();
      const agentKindEntry = agentKindGateMap.get(entry.agent_kind) ?? { values: [], agents: new Set<string>() };
      if (overallValues.length > 0) agentKindEntry.values.push(...overallValues);
      agentKindEntry.agents.add(entry.agent_id);
      agentKindGateMap.set(entry.agent_kind, agentKindEntry);
      return {
        agent_id: entry.agent_id,
        agent_kind: entry.agent_kind,
        session_id: entry.session_id,
        overall_pass_rate: overallValues.length > 0 ? average(overallValues) : null,
        gates,
        runs: entry.runs,
        completed_sessions: entry.completed_sessions,
        metrics_due: entry.metrics_due,
      };
    })
    .sort((a, b) => (b.overall_pass_rate ?? -1) - (a.overall_pass_rate ?? -1) || a.agent_id.localeCompare(b.agent_id));

  const agent_kind_rankings: RollupMetrics["agent_kind_rankings"] = [...agentKindGateMap.entries()]
    .map(([agent_kind, entry]) => ({
      agent_kind,
      overall_pass_rate: entry.values.length > 0 ? average(entry.values) : null,
      runs: entry.values.length,
      agents: entry.agents.size,
    }))
    .sort((a, b) => (b.overall_pass_rate ?? -1) - (a.overall_pass_rate ?? -1) || a.agent_kind.localeCompare(b.agent_kind));

  return { model_gate_rankings, model_assumption_accuracy, model_cc_trends, agent_gate_rankings, agent_kind_rankings, insufficient_models };
}

export async function getRollupMetrics(
  config: ResolvedConfig,
  since?: string
): Promise<RollupMetrics> {
  const start = Date.now();
  const notes: RollupMetrics["notes"] = [];
  const root = globPattern(config.value.metrics.db_path);
  const sinceMs = since ? Date.parse(since) : null;
  const result: RollupMetrics = {
    status: "PASS",
    since: since ?? null,
    projects: [],
    model_gate_rankings: [],
    model_assumption_accuracy: [],
    model_cc_trends: [],
    agent_gate_rankings: [],
    agent_kind_rankings: [],
    top_projects_by_complexity: [],
    lowest_mutation_projects: [],
    highest_supersession_projects: [],
    unresolved_rcas: [],
    common_violations: [],
    invalidated_assumption_categories: [],
    adoption_trend: "insufficient_data",
    insufficient_models: [],
    durationMs: 0,
    notes,
  };

  const rows = await readParquetRows(root);
  if (rows.length === 0) {
    notes.push({ code: "NO_DATA", detail: "No stored metrics data exists in the storage root yet." });
    result.durationMs = Date.now() - start;
    return result;
  }

  const { gateRows, complexityRows, mutationRows, supersessionRows, agentStateRows, violationCounts, assumptionCategoryCounts } = categorizeRollupRows(rows, sinceMs);

  const { projectMap, modelGateMap, modelAssumptionMap, modelCcMap, agentGateMap } = buildRollupMaps(gateRows, complexityRows, mutationRows, supersessionRows, agentStateRows);

  const projectResults = buildRollupProjectResults(projectMap, config);
  result.projects = projectResults.projects;
  result.top_projects_by_complexity = projectResults.top_projects_by_complexity;
  result.lowest_mutation_projects = projectResults.lowest_mutation_projects;
  result.highest_supersession_projects = projectResults.highest_supersession_projects;
  result.unresolved_rcas = projectResults.unresolved_rcas;

  const rankings = buildRollupRankings(modelGateMap, modelAssumptionMap, modelCcMap, agentGateMap);
  result.model_gate_rankings = rankings.model_gate_rankings;
  result.model_assumption_accuracy = rankings.model_assumption_accuracy;
  result.model_cc_trends = rankings.model_cc_trends;
  result.agent_gate_rankings = rankings.agent_gate_rankings;
  result.agent_kind_rankings = rankings.agent_kind_rankings;
  result.insufficient_models = rankings.insufficient_models;

  result.common_violations = [...violationCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }));
  result.invalidated_assumption_categories = [...assumptionCategoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  const complianceSeries = result.projects
    .map((item) => item.compliance_score)
    .filter((v): v is number => v !== null);
  result.adoption_trend = trend(complianceSeries);

  if (result.projects.length === 0) notes.push({ code: "NO_DATA", detail: "No cross-project records were available in the storage root." });
  result.durationMs = Date.now() - start;
  return result;
}

function formatRollupModelComparison(result: RollupMetrics): string {
  const models = result.model_gate_rankings.filter((item) => item.runs >= 2).slice(0, 5);
  const gates = ["G1", "G2", "G3", "G4", "G5"];
  const header = ["Gate".padEnd(6, " "), ...models.map((item) => trunc(item.model, 18).padEnd(18, " "))].join(" | ");
  const lines = [header, "-".repeat(header.length)];
  for (const gate of gates) {
    lines.push([gate.padEnd(6, " "), ...models.map((item) => (item.gates[gate] === null ? "n/a" : `${item.gates[gate]!.toFixed(1)}%`).padEnd(18, " "))].join(" | "));
  }
  if (models.length === 0) lines.push("No models with >=2 runs available.");
  if (result.insufficient_models.length > 0) {
    lines.push("");
    lines.push(`Insufficient data: ${result.insufficient_models.join(", ")}`);
  }
  return lines.join("\n");
}

function formatRollupMetricsText(result: RollupMetrics): string {
  const lines = [
    `Rollup Metrics — ${result.status}`,
    `Since: ${result.since ?? "all-time"}  |  Duration: ${result.durationMs}ms`,
    `Adoption trend: ${result.adoption_trend}`,
    "─".repeat(60),
    "Top Projects:",
    ...result.projects.slice(0, 10).map((item) => trunc(`  • ${item.project}: ${item.compliance_score === null ? "n/a" : item.compliance_score.toFixed(1)} ${miniBar(item.compliance_score)} max_cc=${item.max_cc ?? "n/a"} avg_cc=${item.avg_cc === null ? "n/a" : item.avg_cc.toFixed(2)} mutation=${item.latest_mutation_score === null ? "n/a" : item.latest_mutation_score.toFixed(1)} supersessions=${item.supersession_rate ?? 0}`, 120)),
    "─".repeat(60),
    "Model Gate Rankings:",
    ...result.model_gate_rankings.slice(0, 10).map((item) => `  • ${trunc(item.model, 20)}: overall=${item.overall_pass_rate === null ? "n/a" : item.overall_pass_rate.toFixed(1)} runs=${item.runs}`),
  ];
  if (result.agent_gate_rankings.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Agent Gate Rankings:");
    lines.push(...result.agent_gate_rankings.slice(0, 10).map((item) => `  • ${trunc(item.agent_id, 20)} (${item.agent_kind}): overall=${item.overall_pass_rate === null ? "n/a" : item.overall_pass_rate.toFixed(1)} runs=${item.runs} completed=${item.completed_sessions}${item.metrics_due === true ? " metrics_due" : ""}`));
  }
  if (result.agent_kind_rankings.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Agent Kind Rankings:");
    lines.push(...result.agent_kind_rankings.map((item) => `  • ${item.agent_kind}: overall=${item.overall_pass_rate === null ? "n/a" : item.overall_pass_rate.toFixed(1)} runs=${item.runs} agents=${item.agents}`));
  }
  lines.push("─".repeat(60));
  lines.push("Common Violations:");
  lines.push(...result.common_violations.map((item) => `  • ${item.id.padEnd(8, " ")} ${horizontalBar(item.count, Math.max(1, ...result.common_violations.map((v) => v.count)))} ${item.count}`));
  if (result.invalidated_assumption_categories.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Invalidated Assumption Categories:");
    lines.push(...result.invalidated_assumption_categories.map((item) => `  • ${item.category}: ${item.count}`));
  }
  if (result.notes.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Notes:");
    lines.push(...result.notes.map((item) => `  • [${item.code}] ${item.detail}`));
  }
  return lines.join("\n");
}

export function formatRollupMetrics(
  result: RollupMetrics,
  format: "text" | "json" | "mermaid" | "model_comparison" = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "mermaid") {
    return [
      "```mermaid",
      "xychart-beta",
      '  title "Project Compliance Scores"',
      `  x-axis [${result.projects.map((_, idx) => idx + 1).join(", ")}]`,
      `  bar [${result.projects.map((item) => Number((item.compliance_score ?? 0).toFixed(2))).join(", ")}]`,
      "```",
    ].join("\n");
  }
  if (format === "model_comparison") return formatRollupModelComparison(result);
  return formatRollupMetricsText(result);
}
