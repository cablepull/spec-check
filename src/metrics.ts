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
  gate_pass_rates: Record<string, { value: number | null; trend: TrendDirection; history: Array<{ timestamp: string; pass_rate: number }> }>;
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
    trend: TrendDirection;
    history: Array<{ timestamp: string; avg_cc: number }>;
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
  top_projects_by_complexity: Array<{ project: string; avg_cc: number }>;
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
      cc_average: null,
      cc_max: null,
      cc_delta: null,
      cognitive_average: null,
      cognitive_delta: null,
      length_average: null,
      length_delta: null,
      nesting_average: null,
      nesting_delta: null,
      spec_complexity_ratio: null,
      trend: "insufficient_data",
      history: [],
    },
    mutation: {
      latest_score: null,
      latest_status: null,
      run_count: 0,
      trend: "insufficient_data",
      history: [],
    },
    assumptions: {
      invalidation_rate: null,
      supersession_rate: null,
      average_days_to_supersession: null,
    },
    lifecycle: {
      story_cycle_days: null,
      rca_resolution_days: null,
    },
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

  const gateRecords: GateRecord[] = [];
  const complexityRecords: ComplexityRecord[] = [];
  const mutationRecords: MutationRecord[] = [];
  const supersessionRecords: SupersessionRecord[] = [];
  const diffRecords: Array<{ timestamp: string; criteria: Array<{ id: string; status: string }> }> = [];
  const reconciliationRecords: Array<{ timestamp: string; status: string; criteria: string }> = [];
  const evidenceRecords: Array<{ timestamp: string; status: string; criteria: string }> = [];
  const agentStateRows: any[] = [];

  for (const row of rows) {
    const stamp = Date.parse(row.timestamp ?? "");
    if (sinceMs !== null && !Number.isNaN(stamp) && stamp < sinceMs) continue;
    if (row.check_type === "gate" || /^G[1-5]$/.test(row.gate ?? "")) gateRecords.push(row);
    else if (row.check_type === "complexity") {
      complexityRecords.push({
        ...row,
        results: parseJsonArray<ComplexityRecord["results"][number]>(row.results),
      });
    } else if (row.check_type === "mutation") mutationRecords.push(row);
    else if (row.check_type === "supersession") supersessionRecords.push(row);
    else if (row.check_type === "diff") diffRecords.push({ timestamp: row.timestamp, criteria: parseResults(row.criteria) });
    else if (row.check_type === "reconciliation") reconciliationRecords.push({ timestamp: row.timestamp, status: row.status, criteria: row.criteria });
    else if (row.check_type === "evidence") evidenceRecords.push({ timestamp: row.timestamp, status: row.status, criteria: row.criteria });
    else if (row.check_type === "agent-state") agentStateRows.push(row);
  }

  const violationCounts = new Map<string, number>();
  for (const record of gateRecords) {
    const parsed = parseResults(record.criteria ?? record.results);
    for (const item of parsed) {
      if (item.status === "VIOLATION" || item.status === "BLOCK") {
        violationCounts.set(item.id, (violationCounts.get(item.id) ?? 0) + 1);
      }
    }
  }
  metrics.top_violations = [...violationCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  for (const gate of ["G1", "G2", "G3", "G4", "G5"] as const) {
    const records = gateRecords.filter((record) => record.gate === gate).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const history = records.map((record) => ({ timestamp: record.timestamp, pass_rate: gateStatusPass(record.gate_status) ? 1 : 0 }));
    metrics.gate_pass_rates[gate] = {
      value: history.length > 0 ? (history.filter((item) => item.pass_rate === 1).length / history.length) * 100 : null,
      trend: trend(history.map((item) => item.pass_rate)),
      history,
    };
  }

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
        avg_gap: average(values.map((item) => (item.cc ?? 0) - (item.scenario_count ?? 0))),
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latestComplexity = latest(complexityHistory);
  if (latestComplexity) {
    metrics.complexity.cc_average = latestComplexity.avg_cc;
    metrics.complexity.cc_max = latestComplexity.max_cc;
    metrics.complexity.cc_delta = latestComplexity.avg_cc_delta;
    metrics.complexity.cognitive_average = latestComplexity.avg_cognitive;
    metrics.complexity.cognitive_delta = latestComplexity.avg_cognitive_delta;
    metrics.complexity.length_average = latestComplexity.avg_length;
    metrics.complexity.length_delta = latestComplexity.avg_length_delta;
    metrics.complexity.nesting_average = latestComplexity.avg_nesting;
    metrics.complexity.nesting_delta = latestComplexity.avg_nesting_delta;
    metrics.complexity.spec_complexity_ratio = latestComplexity.avg_gap;
    metrics.complexity.history = complexityHistory.map((item) => ({ timestamp: item.timestamp, avg_cc: item.avg_cc }));
    metrics.complexity.trend = trend(complexityHistory.map((item) => item.avg_cc));
  }

  const mutationHistory = mutationRecords
    .map((record) => ({ timestamp: record.timestamp, score: numberOrNull(record.score) }))
    .filter((record): record is { timestamp: string; score: number } => record.score !== null)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  metrics.mutation.history = mutationHistory;
  metrics.mutation.latest_score = mutationHistory.at(-1)?.score ?? null;
  metrics.mutation.latest_status = latest(mutationRecords)?.status ?? null;
  metrics.mutation.run_count = mutationRecords.length;
  metrics.mutation.trend = trend(mutationHistory.map((item) => item.score));

  if (diffRecords.length > 0) {
    const drift = diffRecords.filter((record) => record.criteria.some((item) => item.id === "R-26" && item.status === "VIOLATION")).length;
    metrics.drift_rate = (drift / diffRecords.length) * 100;
  }

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
  metrics.agent_activity = [...new Set([...gateRowsByAgent.keys(), ...latestStateByAgent.keys()])]
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

  if (supersessionRecords.length > 0) {
    metrics.assumptions.invalidation_rate = supersessionRecords.length;
    metrics.assumptions.supersession_rate = supersessionRecords.length;
    metrics.assumptions.average_days_to_supersession = average(
      supersessionRecords.map((item) => item.days_to_invalidation).filter((v): v is number => typeof v === "number")
    );
  }

  const storyDir = join(resolve(targetPath), "stories");
  if (existsSync(storyDir)) {
    const stories = readdirSync(storyDir).filter((file) => file.endsWith(".md"));
    if (stories.length > 0) {
      const g1 = metrics.gate_pass_rates.G1.value ?? 0;
      const g2 = metrics.gate_pass_rates.G2.value ?? 0;
      const g3 = metrics.gate_pass_rates.G3.value ?? 0;
      const g4 = metrics.gate_pass_rates.G4.value ?? 0;
      metrics.spec_coverage = (g1 + g2 + g3 + g4) / 4;
    }
  }

  const weights = config.value.compliance_weights;
  if (Object.values(metrics.gate_pass_rates).some((item) => item.value !== null)) {
    metrics.compliance_score =
      ((metrics.gate_pass_rates.G1.value ?? 0) * weights.G1) +
      ((metrics.gate_pass_rates.G2.value ?? 0) * weights.G2) +
      ((metrics.gate_pass_rates.G3.value ?? 0) * weights.G3) +
      ((metrics.gate_pass_rates.G4.value ?? 0) * weights.G4) +
      ((metrics.gate_pass_rates.G5.value ?? 0) * weights.G5);
  }

  const tasksPath = join(resolve(targetPath), "tasks.md");
  const storyPath = join(resolve(targetPath), "stories");
  if (existsSync(tasksPath) && existsSync(storyPath)) {
    const created = gitCreatedAt(tasksPath);
    const tasksText = readFileSync(tasksPath, "utf-8");
    if (created && /- \[x\]/.test(tasksText) && !/- \[ \]/.test(tasksText)) {
      metrics.lifecycle.story_cycle_days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
    }
  }

  const rcaDir = join(resolve(targetPath), "rca");
  if (existsSync(rcaDir)) {
    const rcas = readdirSync(rcaDir).filter((file) => file.endsWith(".md"));
    const resolvedDays: number[] = [];
    for (const file of rcas) {
      const full = join(rcaDir, file);
      const text = readFileSync(full, "utf-8");
      const created = gitCreatedAt(full);
      const specNo = /^\s*## Spec Update Required\s*[\r\n]+yes\s*$/im.test(text) ? false : /## Spec Update Required[\s\S]*?\bNo\b/i.test(text);
      const adrNo = /^\s*## ADR Required\s*[\r\n]+yes\s*$/im.test(text) ? false : /## ADR Required[\s\S]*?\bNo\b/i.test(text);
      if (created && specNo && adrNo) {
        resolvedDays.push(Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000)));
      }
    }
    metrics.lifecycle.rca_resolution_days = average(resolvedDays);
  }

  const assumptionListing = listAssumptions(resolve(targetPath), true);
  const totalAssumptions = assumptionListing.items.reduce((sum, item) => sum + item.assumptions.length, 0);
  const invalidatedAssumptions = assumptionListing.items.reduce(
    (sum, item) => sum + item.assumptions.filter((row) => /invalidated/i.test(row.status)).length,
    0
  );
  if (totalAssumptions > 0) {
    metrics.assumptions.invalidation_rate = (invalidatedAssumptions / totalAssumptions) * 100;
  }

  const markdownArtifacts = walkMarkdown(resolve(targetPath));
  const totalArtifactsCreated = markdownArtifacts.length;
  const supersededArtifacts = new Set(supersessionRecords.map((item: any) => item.archive_artifact ?? item.original_artifact).filter(Boolean)).size;
  if (totalArtifactsCreated > 0) {
    metrics.assumptions.supersession_rate = (supersededArtifacts / totalArtifactsCreated) * 100;
  }

  // ── Reconciliation pass rates ─────────────────────────────────────────────────
  if (reconciliationRecords.length > 0) {
    const parseCriteria = (rec: { criteria: unknown }) => parseResults(rec.criteria);
    const rc1Passes = reconciliationRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "RC-1")?.status === "PASS").length;
    const rc2Passes = reconciliationRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "RC-2")?.status === "PASS").length;
    const latestRec = latest(reconciliationRecords);
    metrics.reconciliation = {
      rc1_pass_rate: (rc1Passes / reconciliationRecords.length) * 100,
      rc2_pass_rate: (rc2Passes / reconciliationRecords.length) * 100,
      latest_status: (latestRec?.status as GateStatus) ?? null,
      run_count: reconciliationRecords.length,
    };
  }

  // ── Evidence pass rates ───────────────────────────────────────────────────────
  if (evidenceRecords.length > 0) {
    const parseCriteria = (rec: { criteria: unknown }) => parseResults(rec.criteria);
    const ev1Passes = evidenceRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "EV-1")?.status === "PASS").length;
    const ev2Passes = evidenceRecords.filter((rec) => parseCriteria(rec).find((c) => c.id === "EV-2")?.status === "PASS").length;
    const latestEv = latest(evidenceRecords);
    metrics.evidence = {
      ev1_pass_rate: (ev1Passes / evidenceRecords.length) * 100,
      ev2_pass_rate: (ev2Passes / evidenceRecords.length) * 100,
      latest_status: (latestEv?.status as GateStatus) ?? null,
      run_count: evidenceRecords.length,
    };
  }

  // ── Diff ADR coverage rates ───────────────────────────────────────────────────
  if (diffRecords.length > 0) {
    const diffsWithDep = diffRecords.filter((rec) => rec.criteria.some((c) => c.id === "D-ADR-1"));
    const diffsWithSec = diffRecords.filter((rec) => rec.criteria.some((c) => c.id === "D-ADR-2"));
    const diffsWithDep3 = diffRecords.filter((rec) => rec.criteria.some((c) => c.id === "D-ADR-3"));
    const passRate = (recs: typeof diffRecords, id: string) =>
      recs.length === 0 ? null
        : (recs.filter((rec) => rec.criteria.find((c) => c.id === id)?.status === "PASS").length / recs.length) * 100;
    metrics.diff_adr = {
      dadr1_pass_rate: passRate(diffsWithDep, "D-ADR-1"),
      dadr2_pass_rate: passRate(diffsWithSec, "D-ADR-2"),
      dadr3_pass_rate: passRate(diffsWithDep3, "D-ADR-3"),
      checked_diffs: diffRecords.length,
    };
  }

  if (gateRecords.length === 0 && complexityRecords.length === 0 && mutationRecords.length === 0 && supersessionRecords.length === 0 && diffRecords.length === 0) {
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

export function formatProjectMetrics(result: ProjectMetrics, format: Extract<Format, "text" | "json" | "mermaid"> = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "mermaid") {
    const gatePoints = Object.entries(result.gate_pass_rates)
      .map(([gate, item]) => `${gate}:${item.value === null ? 0 : Number(item.value.toFixed(1))}`)
      .join(", ");
    const complexityPoints = result.complexity.history
      .map((item, idx) => `${idx}:${Number(item.avg_cc.toFixed(2))}`)
      .join(", ");
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
  lines.push("─".repeat(60));
  lines.push(`Compliance Score: ${result.compliance_score === null ? "n/a" : result.compliance_score.toFixed(1)}  ${miniBar(result.compliance_score)}`);
  lines.push(`Spec Coverage: ${result.spec_coverage === null ? "n/a" : `${result.spec_coverage.toFixed(1)}%`}`);
  lines.push(`Drift Rate: ${result.drift_rate === null ? "n/a" : `${result.drift_rate.toFixed(1)}%`}`);
  lines.push("─".repeat(60));
  lines.push(`Complexity: avg CC ${result.complexity.cc_average?.toFixed(2) ?? "n/a"} ${arrow(result.complexity.trend)} | max CC ${result.complexity.cc_max ?? "n/a"} | gap ${result.complexity.spec_complexity_ratio?.toFixed(2) ?? "n/a"} | ${numericSparkline(result.complexity.history.map((item) => item.avg_cc))}`);
  lines.push(`Mutation: ${result.mutation.latest_score === null ? "n/a" : `${result.mutation.latest_score.toFixed(1)}%`} ${arrow(result.mutation.trend)} | ${numericSparkline(result.mutation.history.map((item) => item.score), 10)}`);
  lines.push(`Assumptions: invalidation ${result.assumptions.invalidation_rate === null ? "n/a" : result.assumptions.invalidation_rate.toFixed(1)} | supersession ${result.assumptions.supersession_rate === null ? "n/a" : result.assumptions.supersession_rate.toFixed(1)}`);
  lines.push("─".repeat(60));
  lines.push("Quality Signals:");
  const pct = (v: number | null) => v === null ? "n/a" : `${v.toFixed(0)}%`;
  lines.push(`  Reconciliation (${result.reconciliation.run_count} runs): RC-1 ${pct(result.reconciliation.rc1_pass_rate)} | RC-2 ${pct(result.reconciliation.rc2_pass_rate)}`);
  lines.push(`  Evidence (${result.evidence.run_count} runs):      EV-1 ${pct(result.evidence.ev1_pass_rate)} | EV-2 ${pct(result.evidence.ev2_pass_rate)}`);
  lines.push(`  Diff ADR (${result.diff_adr.checked_diffs} diffs): D-ADR-1 ${pct(result.diff_adr.dadr1_pass_rate)} | D-ADR-2 ${pct(result.diff_adr.dadr2_pass_rate)} | D-ADR-3 ${pct(result.diff_adr.dadr3_pass_rate)}`);
  if (result.agent_activity.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Agent Activity:");
    for (const item of result.agent_activity.slice(0, 10)) {
      lines.push(`  • ${trunc(item.agent_id, 20)} (${item.agent_kind}): pass=${item.gate_pass_rate === null ? "n/a" : `${item.gate_pass_rate.toFixed(1)}%`} runs=${item.run_count} phase=${item.last_reported_phase ?? "n/a"}${item.metrics_due === true ? " metrics_due" : ""}`);
    }
  }
  lines.push("─".repeat(60));
  lines.push("Top Violations:");
  if (result.top_violations.length === 0) lines.push("  none");
  const maxViolation = Math.max(0, ...result.top_violations.map((item) => item.count));
  for (const item of result.top_violations) {
    lines.push(`  • ${item.id.padEnd(8, " ")} ${horizontalBar(item.count, maxViolation)} ${item.count}`);
  }
  if (result.notes.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Notes:");
    for (const note of result.notes) lines.push(`  • [${note.code}] ${note.detail}`);
  }
  return lines.join("\n");
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

  const gateRows: any[] = [];
  const complexityRows: any[] = [];
  const mutationRows: any[] = [];
  const supersessionRows: any[] = [];
  const agentStateRows: any[] = [];
  const violationCounts = new Map<string, number>();
  const assumptionCategoryCounts = new Map<string, number>();

  for (const row of rows) {
    const stamp = Date.parse(row.timestamp ?? "");
    if (sinceMs !== null && !Number.isNaN(stamp) && stamp < sinceMs) continue;
    if (row.check_type === "gate" || /^G[1-5]$/.test(row.gate ?? "")) {
      gateRows.push(row);
      for (const criterion of parseResults(row.criteria ?? row.results)) {
        if (criterion.status === "VIOLATION" || criterion.status === "BLOCK") {
          violationCounts.set(criterion.id, (violationCounts.get(criterion.id) ?? 0) + 1);
        }
      }
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

  const projectMap = new Map<string, {
    gates: Record<string, number[]>;
    ccs: number[];
    mutationScores: number[];
    supersessions: number;
    unresolvedRcas: number;
  }>();
  const modelGateMap = new Map<string, { gates: Record<string, number[]>; runs: number }>();
  const modelAssumptionMap = new Map<string, { made: number; invalidated: number }>();
  const modelCcMap = new Map<string, { values: number[]; runs: number }>();
  const agentGateMap = new Map<string, {
    agent_id: string;
    agent_kind: string;
    session_id: string | null;
    gates: Record<string, number[]>;
    runs: number;
    completed_sessions: number;
    metrics_due: boolean | null;
  }>();
  const agentKindGateMap = new Map<string, { values: number[]; agents: Set<string> }>();

  for (const row of gateRows) {
    const project = `${row.org ?? "local"}/${row.repo ?? "unknown"}/${row.service ?? "root"}`;
    const projectEntry = projectMap.get(project) ?? {
      gates: { G1: [], G2: [], G3: [], G4: [], G5: [] },
      ccs: [],
      mutationScores: [],
      supersessions: 0,
      unresolvedRcas: 0,
    };
    const pass = gateStatusPass(row.gate_status) ? 100 : 0;
    if (projectEntry.gates[row.gate]) projectEntry.gates[row.gate]!.push(pass);
    projectMap.set(project, projectEntry);

    const model = row.llm_model ?? row.llm_id ?? "unknown";
    const modelEntry = modelGateMap.get(model) ?? { gates: { G1: [], G2: [], G3: [], G4: [], G5: [] }, runs: 0 };
    if (modelEntry.gates[row.gate]) modelEntry.gates[row.gate]!.push(pass);
    modelEntry.runs += 1;
    modelGateMap.set(model, modelEntry);

    if (row.agent_id) {
      const agentEntry = agentGateMap.get(String(row.agent_id)) ?? {
        agent_id: String(row.agent_id),
        agent_kind: String(row.agent_kind ?? "unknown"),
        session_id: row.session_id ? String(row.session_id) : null,
        gates: { G1: [], G2: [], G3: [], G4: [], G5: [] },
        runs: 0,
        completed_sessions: 0,
        metrics_due: null,
      };
      if (agentEntry.gates[row.gate]) agentEntry.gates[row.gate]!.push(pass);
      agentEntry.runs += 1;
      agentGateMap.set(agentEntry.agent_id, agentEntry);
    }
  }

  for (const row of complexityRows) {
    const project = `${row.org ?? "local"}/${row.repo ?? "unknown"}/${row.service ?? "root"}`;
    const projectEntry = projectMap.get(project) ?? {
      gates: { G1: [], G2: [], G3: [], G4: [], G5: [] },
      ccs: [],
      mutationScores: [],
      supersessions: 0,
      unresolvedRcas: 0,
    };
    const ccs = (row.results ?? []).map((item: any) => item.cc).filter((v: any) => typeof v === "number");
    projectEntry.ccs.push(...ccs);
    projectMap.set(project, projectEntry);

    const model = row.llm_model ?? row.llm_id ?? "unknown";
    const modelEntry = modelCcMap.get(model) ?? { values: [], runs: 0 };
    modelEntry.values.push(average(ccs) ?? 0);
    modelEntry.runs += 1;
    modelCcMap.set(model, modelEntry);
  }

  for (const row of mutationRows) {
    const project = `${row.org ?? "local"}/${row.repo ?? "unknown"}/${row.service ?? "root"}`;
    const projectEntry = projectMap.get(project) ?? {
      gates: { G1: [], G2: [], G3: [], G4: [], G5: [] },
      ccs: [],
      mutationScores: [],
      supersessions: 0,
      unresolvedRcas: 0,
    };
    const score = numberOrNull(row.score);
    if (score !== null) projectEntry.mutationScores.push(score);
    projectMap.set(project, projectEntry);
  }

  for (const row of supersessionRows) {
    const project = `${row.org ?? "local"}/${row.repo ?? "unknown"}/${row.service ?? "root"}`;
    const projectEntry = projectMap.get(project) ?? {
      gates: { G1: [], G2: [], G3: [], G4: [], G5: [] },
      ccs: [],
      mutationScores: [],
      supersessions: 0,
      unresolvedRcas: 0,
    };
    projectEntry.supersessions += 1;
    projectMap.set(project, projectEntry);

    const model = row.llm_model ?? row.llm_id ?? row.original_model ?? "unknown";
    const modelEntry = modelAssumptionMap.get(model) ?? { made: 0, invalidated: 0 };
    modelEntry.invalidated += 1;
    modelAssumptionMap.set(model, modelEntry);
  }

  for (const row of agentStateRows.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")))) {
    if (!row.agent_id) continue;
    const agentEntry = agentGateMap.get(String(row.agent_id)) ?? {
      agent_id: String(row.agent_id),
      agent_kind: String(row.agent_kind ?? "unknown"),
      session_id: row.session_id ? String(row.session_id) : null,
      gates: { G1: [], G2: [], G3: [], G4: [], G5: [] },
      runs: 0,
      completed_sessions: 0,
      metrics_due: null,
    };
    agentEntry.agent_kind = String(row.agent_kind ?? agentEntry.agent_kind);
    agentEntry.session_id = row.session_id ? String(row.session_id) : agentEntry.session_id;
    agentEntry.metrics_due = typeof row.metrics_due === "boolean" ? row.metrics_due : agentEntry.metrics_due;
    if (row.status === "completed") agentEntry.completed_sessions += 1;
    agentGateMap.set(agentEntry.agent_id, agentEntry);
  }

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
    result.projects.push({
      project,
      compliance_score: Object.values(gateBreakdown).some((v) => v !== null) ? complianceScore : null,
      gate_breakdown: gateBreakdown,
      avg_cc: average(entry.ccs),
      latest_mutation_score: entry.mutationScores.length > 0 ? entry.mutationScores[entry.mutationScores.length - 1]! : null,
      supersession_rate: entry.supersessions,
      unresolved_rca_count: entry.unresolvedRcas,
    });
  }

  result.projects.sort((a, b) => (b.compliance_score ?? -1) - (a.compliance_score ?? -1));
  result.top_projects_by_complexity = [...result.projects]
    .filter((item) => item.avg_cc !== null)
    .sort((a, b) => (b.avg_cc ?? 0) - (a.avg_cc ?? 0))
    .slice(0, 10)
    .map((item) => ({ project: item.project, avg_cc: item.avg_cc! }));
  result.lowest_mutation_projects = [...result.projects]
    .filter((item) => item.latest_mutation_score !== null)
    .sort((a, b) => (a.latest_mutation_score ?? 101) - (b.latest_mutation_score ?? 101))
    .slice(0, 10)
    .map((item) => ({ project: item.project, mutation_score: item.latest_mutation_score! }));
  result.highest_supersession_projects = [...result.projects]
    .sort((a, b) => (b.supersession_rate ?? 0) - (a.supersession_rate ?? 0))
    .slice(0, 10)
    .map((item) => ({ project: item.project, supersession_rate: item.supersession_rate ?? 0 }));
  result.unresolved_rcas = [...result.projects]
    .filter((item) => item.unresolved_rca_count > 0)
    .sort((a, b) => b.unresolved_rca_count - a.unresolved_rca_count)
    .slice(0, 10)
    .map((item) => ({ project: item.project, unresolved: item.unresolved_rca_count }));

  result.model_gate_rankings = [...modelGateMap.entries()]
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

  for (const ranking of result.model_gate_rankings) {
    if (ranking.runs < 2) result.insufficient_models.push(ranking.model);
  }

  result.model_assumption_accuracy = [...modelAssumptionMap.entries()]
    .map(([model, entry]) => ({
      model,
      accuracy: entry.made >= 5 ? ((entry.made - entry.invalidated) / entry.made) * 100 : null,
      assumptions: entry.made,
      invalidated: entry.invalidated,
    }))
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));

  result.model_cc_trends = [...modelCcMap.entries()]
    .map(([model, entry]) => ({
      model,
      trend: trend(entry.values),
      average_slope: slope(entry.values),
      runs: entry.runs,
    }))
    .sort((a, b) => (a.average_slope ?? 999) - (b.average_slope ?? 999));

  result.agent_gate_rankings = [...agentGateMap.values()]
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

  result.agent_kind_rankings = [...agentKindGateMap.entries()]
    .map(([agent_kind, entry]) => ({
      agent_kind,
      overall_pass_rate: entry.values.length > 0 ? average(entry.values) : null,
      runs: entry.values.length,
      agents: entry.agents.size,
    }))
    .sort((a, b) => (b.overall_pass_rate ?? -1) - (a.overall_pass_rate ?? -1) || a.agent_kind.localeCompare(b.agent_kind));

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
  if (format === "model_comparison") {
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

  const lines = [
    `Rollup Metrics — ${result.status}`,
    `Since: ${result.since ?? "all-time"}  |  Duration: ${result.durationMs}ms`,
    `Adoption trend: ${result.adoption_trend}`,
    "─".repeat(60),
    "Top Projects:",
    ...result.projects.slice(0, 10).map((item) => trunc(`  • ${item.project}: ${item.compliance_score === null ? "n/a" : item.compliance_score.toFixed(1)} ${miniBar(item.compliance_score)} cc=${item.avg_cc === null ? "n/a" : item.avg_cc.toFixed(2)} mutation=${item.latest_mutation_score === null ? "n/a" : item.latest_mutation_score.toFixed(1)} supersessions=${item.supersession_rate ?? 0}`, 120)),
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
