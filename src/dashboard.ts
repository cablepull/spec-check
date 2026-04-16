import { createServer } from "http";
import { resolve } from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";
import { loadConfig } from "./config.js";
import { detectServices } from "./monorepo.js";
import { getProjectMetrics, getRollupMetrics, type ProjectMetrics, type RollupMetrics } from "./metrics.js";
import { getAssumptionMetrics, type AssumptionMetricsResult } from "./assumptions.js";
import { checkDependencies } from "./dependencies.js";
import { findLegacyJsonlFiles, migrateLegacyJsonlRecords, type LegacyMigrationReport } from "./storage.js";
import { TOOL_DEFINITIONS, executeToolRequest } from "./index.js";
import { getRegisteredProject, listRegisteredProjects, registerProject } from "./project_registry.js";

type DependencySummary = ReturnType<typeof checkDependencies>;

interface DashboardData {
  projectPath: string;
  since: string | null;
  projectMetrics: ProjectMetrics;
  rollupMetrics: RollupMetrics;
  assumptionMetrics: AssumptionMetricsResult;
  dependencies: DependencySummary;
  legacyMigration: LegacyMigrationReport;
}

// ─── HTML utilities ──────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

function trunc(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function trendArrow(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "→0";
  if (delta > 0) return `↑${Number(delta.toFixed(2))}`;
  if (delta < 0) return `↓${Number(Math.abs(delta).toFixed(2))}`;
  return "→0";
}

function badgeClass(status: string): string {
  switch (status) {
    case "PASS": return "pass";
    case "PASSING_WITH_WARNINGS": return "warn";
    case "FAILING": return "fail";
    case "BLOCKED": return "block";
    default: return "neutral";
  }
}

// ─── SVG chart helpers ────────────────────────────────────────────────────────

const GATE_COLORS: Record<string, string> = {
  G1: "#005f73",
  G2: "#0a9396",
  G3: "#2a7f62",
  G4: "#b5838d",
  G5: "#f4a261",
};

/** Inline SVG sparkline (area + line). values are in the yMin–yMax range. */
function svgSparkline(
  values: number[],
  opts: { width?: number; height?: number; color?: string; yMin?: number; yMax?: number } = {}
): string {
  const { width = 100, height = 26, color = "#005f73", yMin = 0, yMax = 100 } = opts;
  if (values.length < 2) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="${(height / 2).toFixed(1)}" x2="${width - 2}" y2="${(height / 2).toFixed(1)}" stroke="#d9cfbf" stroke-width="1" stroke-dasharray="3,3"/></svg>`;
  }
  const pad = 2;
  const cW = width - pad * 2;
  const cH = height - pad * 2;
  const range = Math.max(yMax - yMin, 0.001);
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * cW;
    const y = pad + (1 - Math.max(0, Math.min(1, (v - yMin) / range))) * cH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${(pad + cH).toFixed(1)} ${pts.join(" ")} ${(pad + cW).toFixed(1)},${(pad + cH).toFixed(1)}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle"><polygon points="${area}" fill="${color}22"/><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

interface ChartSeries {
  label: string;
  color: string;
  data: Array<{ ts: number; value: number }>;
}

/**
 * Full SVG line chart with axes, grid, legend, and optional threshold line.
 * Returns an inline <svg> element.
 */
function svgLineChart(
  series: ChartSeries[],
  opts: {
    width?: number;
    height?: number;
    yMin?: number;
    yMax?: number;
    threshold?: number;
    thresholdLabel?: string;
  } = {}
): string {
  const { width = 560, height = 200, yMin = 0, yMax = 100, threshold, thresholdLabel } = opts;
  const padL = 36, padR = 16, padT = 12, padB = 36;
  const cW = width - padL - padR;
  const cH = height - padT - padB;

  const allTs = [...new Set(series.flatMap((s) => s.data.map((d) => d.ts)))].sort((a, b) => a - b);
  const hasSufficientData = allTs.length >= 2 && series.some((s) => s.data.length >= 2);

  if (!hasSufficientData) {
    return `<svg width="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:block"><rect x="0" y="0" width="${width}" height="${height}" fill="#f9f6ef" rx="4"/><text x="${width / 2}" y="${height / 2 - 8}" text-anchor="middle" fill="#6c655a" font-size="12" font-family="serif">No trend data yet</text><text x="${width / 2}" y="${height / 2 + 10}" text-anchor="middle" fill="#b0a898" font-size="10" font-family="serif">Run checks to build history</text></svg>`;
  }

  const tsMin = allTs[0]!;
  const tsMax = allTs[allTs.length - 1]!;
  const tsRange = Math.max(tsMax - tsMin, 1);
  const yRange = Math.max(yMax - yMin, 0.001);

  const toX = (ts: number) => padL + ((ts - tsMin) / tsRange) * cW;
  const toY = (v: number) => padT + (1 - Math.max(0, Math.min(1, (v - yMin) / yRange))) * cH;

  // Y grid lines
  const yStep = yMax <= 1 ? 0.25 : yMax <= 10 ? 2 : 25;
  const yTicks: number[] = [];
  for (let y = yMin; y <= yMax + 0.001; y += yStep) yTicks.push(y);
  const gridLines = yTicks.map((y) => {
    const cy = toY(y).toFixed(1);
    const label = yMax <= 1 ? `${(y * 100).toFixed(0)}%` : yMax <= 10 ? y.toFixed(0) : `${y.toFixed(0)}%`;
    return `<line x1="${padL}" y1="${cy}" x2="${padL + cW}" y2="${cy}" stroke="#e8e0d4" stroke-width="0.5"/>
    <text x="${(padL - 4).toFixed(1)}" y="${(parseFloat(cy) + 3.5).toFixed(1)}" text-anchor="end" fill="#a09488" font-size="9" font-family="ui-monospace,monospace">${label}</text>`;
  }).join("\n");

  // X axis ticks
  const tickCount = Math.min(allTs.length, 6);
  const xTickIndices = tickCount <= 1 ? [0] : Array.from({ length: tickCount }, (_, i) =>
    Math.round(i * (allTs.length - 1) / (tickCount - 1))
  );
  const xTicks = xTickIndices.map((idx) => {
    const ts = allTs[idx]!;
    const cx = toX(ts).toFixed(1);
    const date = new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `<line x1="${cx}" y1="${padT + cH}" x2="${cx}" y2="${padT + cH + 4}" stroke="#c8bfb4" stroke-width="1"/>
    <text x="${cx}" y="${padT + cH + 14}" text-anchor="middle" fill="#a09488" font-size="8.5" font-family="ui-monospace,monospace">${escapeHtml(date)}</text>`;
  }).join("\n");

  // Threshold line
  const thresholdEl = threshold !== undefined
    ? `<line x1="${padL}" y1="${toY(threshold).toFixed(1)}" x2="${padL + cW}" y2="${toY(threshold).toFixed(1)}" stroke="#9a6700" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>
    <text x="${padL + cW - 2}" y="${(toY(threshold) - 3).toFixed(1)}" text-anchor="end" fill="#9a6700" font-size="9" font-family="serif">${escapeHtml(thresholdLabel ?? `${threshold}`)}</text>`
    : "";

  // Series polylines + end dots
  const seriesEls = series.map((s) => {
    if (s.data.length < 2) return "";
    const sorted = [...s.data].sort((a, b) => a.ts - b.ts);
    const pts = sorted.map((d) => `${toX(d.ts).toFixed(1)},${toY(d.value).toFixed(1)}`).join(" ");
    const last = sorted[sorted.length - 1]!;
    const cx = toX(last.ts).toFixed(1);
    const cy = toY(last.value).toFixed(1);
    const tip = `${s.label}: ${yMax <= 1 ? pct(last.value * 100) : last.value.toFixed(1)}`;
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <circle cx="${cx}" cy="${cy}" r="3.5" fill="${s.color}" stroke="white" stroke-width="1"><title>${escapeHtml(tip)}</title></circle>`;
  }).join("\n");

  // Legend (horizontal at bottom)
  const legendY = padT + cH + 26;
  const legendItems = series.map((s, i) => {
    const lx = padL + i * Math.min(90, (cW / series.length));
    return `<line x1="${lx.toFixed(1)}" y1="${legendY}" x2="${(lx + 14).toFixed(1)}" y2="${legendY}" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round"/>
    <text x="${(lx + 18).toFixed(1)}" y="${legendY + 4}" fill="#6c655a" font-size="9.5" font-family="serif">${escapeHtml(s.label)}</text>`;
  }).join("\n");

  // Axes
  const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" stroke="#b0a898" stroke-width="1"/>
  <line x1="${padL}" y1="${padT + cH}" x2="${padL + cW}" y2="${padT + cH}" stroke="#b0a898" stroke-width="1"/>`;

  const totalH = legendY + 12;
  return `<svg width="100%" viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
  ${gridLines}
  ${thresholdEl}
  ${axes}
  ${xTicks}
  ${seriesEls}
  ${legendItems}
</svg>`;
}

/** SVG horizontal bar chart. items[].value normalized against max. */
function svgHBarChart(
  items: Array<{ label: string; value: number; color?: string }>,
  opts: { width?: number; barH?: number; max?: number; defaultColor?: string } = {}
): string {
  if (items.length === 0) return "";
  const { width = 320, barH = 18, defaultColor = "#005f73" } = opts;
  const max = opts.max ?? Math.max(...items.map((i) => i.value), 1);
  const padL = 110, padR = 40, gap = 5;
  const cW = width - padL - padR;
  const totalH = items.length * (barH + gap) + gap;

  const bars = items.map((item, i) => {
    const bW = Math.max(2, (item.value / max) * cW);
    const y = gap + i * (barH + gap);
    const midY = y + barH / 2 + 4;
    const c = item.color ?? defaultColor;
    return `<text x="${padL - 6}" y="${midY.toFixed(1)}" text-anchor="end" fill="#3a3730" font-size="11" font-family="serif">${escapeHtml(trunc(item.label, 16))}</text>
    <rect x="${padL}" y="${y}" width="${bW.toFixed(1)}" height="${barH}" fill="${c}" rx="2" opacity="0.85"/>
    <text x="${(padL + bW + 5).toFixed(1)}" y="${midY.toFixed(1)}" fill="#6c655a" font-size="10" font-family="ui-monospace,monospace">${item.value}</text>`;
  }).join("\n");

  return `<svg width="100%" viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="display:block">${bars}</svg>`;
}

/** Gate heatmap: rows = gates, columns = run iterations. Color encodes pass/fail. */
function svgGateHeatmap(
  gatePassRates: Record<string, { history: Array<{ timestamp: string; pass_rate: number; run_batch_id: string | null }> }>
): string {
  const gates = ["G1", "G2", "G3", "G4", "G5"];
  const N = 16;
  const cellW = 30, cellH = 28, padL = 26, padT = 10, padB = 22;

  // Each entry maps to an iteration key: run_batch_id when present (groups all gates
  // from one run_all call), otherwise the raw timestamp string (gate_check records).
  const entries: Array<{ iterKey: string; ts: number; gate: string; rate: number }> = [];
  for (const gate of gates) {
    for (const h of gatePassRates[gate]?.history ?? []) {
      const ts = new Date(h.timestamp).getTime();
      const iterKey = h.run_batch_id ?? h.timestamp;
      entries.push({ iterKey, ts, gate, rate: h.pass_rate });
    }
  }

  // Build iteration list: unique keys sorted by their earliest timestamp, last N
  const iterTs = new Map<string, number>();
  for (const e of entries) {
    const existing = iterTs.get(e.iterKey);
    if (existing === undefined || e.ts < existing) iterTs.set(e.iterKey, e.ts);
  }
  const allIters = [...iterTs.entries()].sort((a, b) => a[1] - b[1]).slice(-N);

  if (allIters.length === 0) {
    return `<svg width="100%" viewBox="0 0 300 60" xmlns="http://www.w3.org/2000/svg"><text x="8" y="34" fill="#6c655a" font-size="12" font-family="serif">No gate history yet</text></svg>`;
  }

  // Determine label format: show HH:MM when a calendar day has multiple iterations
  const iterationsPerDay = new Map<string, number>();
  for (const [, ts] of allIters) {
    const day = new Date(ts).toDateString();
    iterationsPerDay.set(day, (iterationsPerDay.get(day) ?? 0) + 1);
  }
  function iterLabel(ts: number): string {
    const d = new Date(ts);
    if ((iterationsPerDay.get(d.toDateString()) ?? 0) > 1) {
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Lookup: gate -> iterKey -> rate
  const lookup = new Map<string, Map<string, number>>();
  for (const gate of gates) lookup.set(gate, new Map());
  for (const e of entries) lookup.get(e.gate)?.set(e.iterKey, e.rate);

  function rateColor(rate: number | undefined): string {
    if (rate === undefined) return "#ece7db";
    if (rate >= 1.0) return "#2a7f62";
    if (rate >= 0.75) return "#52b788";
    if (rate >= 0.5) return "#e9c46a";
    if (rate > 0) return "#f4a261";
    return "#c1392b";
  }

  const totalW = padL + allIters.length * cellW + 6;

  const cells = gates.flatMap((gate, row) =>
    allIters.map(([iterKey, ts], col) => {
      const rate = lookup.get(gate)?.get(iterKey);
      const x = padL + col * cellW;
      const y = padT + row * cellH;
      const tip = rate !== undefined
        ? `${gate} ${pct(rate * 100)} — ${iterLabel(ts)} ${new Date(ts).toLocaleDateString()}`
        : `${gate} — no data`;
      return `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="${rateColor(rate)}" rx="2"><title>${escapeHtml(tip)}</title></rect>`;
    })
  );

  const gateLabels = gates.map((gate, row) => {
    const y = padT + row * cellH + cellH / 2 + 4;
    return `<text x="${padL - 4}" y="${y.toFixed(1)}" text-anchor="end" fill="#3a3730" font-size="10" font-weight="bold" font-family="serif">${gate}</text>`;
  });

  const dateLabels = allIters.map(([, ts], col) => {
    if (col % Math.max(1, Math.floor(allIters.length / 4)) !== 0 && col !== allIters.length - 1) return "";
    const x = padL + col * cellW + cellW / 2;
    const y = padT + gates.length * cellH + 14;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="#a09488" font-size="8" font-family="ui-monospace,monospace">${escapeHtml(iterLabel(ts))}</text>`;
  });

  // Color scale legend
  const scaleItems = [
    { color: "#2a7f62", label: "100%" },
    { color: "#52b788", label: "75–99%" },
    { color: "#e9c46a", label: "50–74%" },
    { color: "#f4a261", label: "1–49%" },
    { color: "#c1392b", label: "0%" },
    { color: "#ece7db", label: "no data" },
  ];
  const legendY = padT + gates.length * cellH + padB + 4;
  const legendItems = scaleItems.map((item, i) => {
    const lx = padL + i * 70;
    return `<rect x="${lx}" y="${legendY}" width="10" height="10" fill="${item.color}" rx="1"/>
    <text x="${lx + 13}" y="${legendY + 9}" fill="#6c655a" font-size="8.5" font-family="serif">${escapeHtml(item.label)}</text>`;
  });

  const fullH = legendY + 20;
  return `<svg width="100%" viewBox="0 0 ${Math.max(totalW, 460)} ${fullH}" xmlns="http://www.w3.org/2000/svg" style="display:block">
  ${cells.join("\n")}
  ${gateLabels.join("\n")}
  ${dateLabels.join("\n")}
  ${legendItems.join("\n")}
</svg>`;
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderProjectSection(metrics: ProjectMetrics): string {
  // Gate table with SVG sparklines
  const gates = Object.entries(metrics.gate_pass_rates).map(([gate, item]) => {
    const histVals = item.history.map((e) => e.pass_rate * 100);
    const sparkSvg = svgSparkline(histVals, { width: 100, height: 24, color: GATE_COLORS[gate] ?? "#005f73" });
    const trendClass = item.trend === "improving" ? "trend-up" : item.trend === "declining" ? "trend-down" : "trend-flat";
    return `<tr>
      <td><strong>${gate}</strong></td>
      <td>${pct(item.value)}</td>
      <td><span class="${trendClass}">${item.trend.replace("_", " ")}</span></td>
      <td>${sparkSvg}</td>
    </tr>`;
  }).join("");

  // Violations as SVG horizontal bar chart
  const maxCount = metrics.top_violations.length > 0
    ? Math.max(...metrics.top_violations.map((v) => v.count))
    : 1;
  const violationChart = metrics.top_violations.length > 0
    ? svgHBarChart(
        metrics.top_violations.map((v) => ({ label: v.id, value: v.count, color: "#b42318" })),
        { width: 320, max: maxCount, defaultColor: "#b42318" }
      )
    : `<p class="muted">No violations recorded.</p>`;

  const agentRows = metrics.agent_activity.length > 0
    ? metrics.agent_activity.slice(0, 8).map((item) => `
      <tr>
        <td><code>${escapeHtml(trunc(item.agent_id, 22))}</code></td>
        <td>${escapeHtml(item.agent_kind)}</td>
        <td>${pct(item.gate_pass_rate)}</td>
        <td>${item.run_count}</td>
        <td>${escapeHtml(item.last_reported_phase ?? "n/a")}</td>
        <td>${item.open_violations > 0 ? `<span class="badge fail">${item.open_violations}</span>` : "0"}</td>
        <td>${item.metrics_due === true ? `<span class="badge warn">due</span>` : item.metrics_due === false ? `<span class="badge pass">clear</span>` : `<span class="badge neutral">n/a</span>`}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">No agent state records yet.</td></tr>`;

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Project Metrics</h2>
        <span class="badge ${badgeClass(metrics.status)}">${metrics.status}</span>
      </div>
      <div class="cards">
        <article class="card">
          <h3>Compliance</h3>
          <p class="big">${pct(metrics.compliance_score)}</p>
          <p class="muted">Spec coverage ${pct(metrics.spec_coverage)}</p>
        </article>
        <article class="card">
          <h3>Complexity</h3>
          <p class="big">${num(metrics.complexity.cc_max, 0)}</p>
          <p class="muted">Max CC · ${metrics.complexity.violation_count !== null ? `${metrics.complexity.violation_count} fn ≥ threshold` : "violations unknown"} · avg ${num(metrics.complexity.cc_average)}</p>
        </article>
        <article class="card">
          <h3>Mutation Score</h3>
          <p class="big">${pct(metrics.mutation.latest_score)}</p>
          <p class="muted">Status: ${metrics.mutation.latest_status ?? "no data"} · Runs: ${metrics.mutation.run_count}</p>
        </article>
        <article class="card">
          <h3>Assumptions</h3>
          <p class="big">${pct(metrics.assumptions.invalidation_rate)}</p>
          <p class="muted">Supersession ${pct(metrics.assumptions.supersession_rate)}</p>
        </article>
      </div>

      <div class="subpanel" style="margin-top:1rem">
        <h3>Gate Timeline Heatmap</h3>
        <p class="muted small">Each column is one recorded run. Hover for details.</p>
        ${svgGateHeatmap(metrics.gate_pass_rates)}
      </div>

      <div class="grid" style="margin-top:1rem">
        <article class="subpanel">
          <h3>Gate Pass Rates</h3>
          <table>
            <thead><tr><th>Gate</th><th>Rate</th><th>Trend</th><th>History</th></tr></thead>
            <tbody>${gates}</tbody>
          </table>
        </article>
        <article class="subpanel">
          <h3>Top Violations</h3>
          ${violationChart}
        </article>
      </div>

      <div class="grid" style="margin-top:1rem">
        <article class="subpanel">
          <h3>Lifecycle</h3>
          <dl class="dl-row">
            <dt>Story cycle</dt><dd>${num(metrics.lifecycle.story_cycle_days, 1)} days</dd>
            <dt>RCA resolution</dt><dd>${num(metrics.lifecycle.rca_resolution_days, 1)} days</dd>
            <dt>Drift rate</dt><dd>${pct(metrics.drift_rate)}</dd>
            <dt>Spec complexity ratio</dt><dd>${num(metrics.complexity.spec_complexity_ratio)}</dd>
          </dl>
        </article>
        <article class="subpanel">
          <h3>Notes</h3>
          ${metrics.notes.length > 0
            ? `<ul>${metrics.notes.map((n) => `<li><strong>${escapeHtml(n.code)}</strong> ${escapeHtml(n.detail)}</li>`).join("")}</ul>`
            : "<p class=\"muted\">No metric warnings.</p>"}
        </article>
      </div>
      <div style="margin-top:1rem">
        <article class="subpanel">
          <h3>Agent Activity</h3>
          <p class="muted small">Per-agent workflow state and gate outcomes from persisted agent-state and gate records.</p>
          <table>
            <thead><tr><th>Agent</th><th>Kind</th><th>Pass rate</th><th>Runs</th><th>Phase</th><th>Violations</th><th>Metrics</th></tr></thead>
            <tbody>${agentRows}</tbody>
          </table>
        </article>
      </div>
    </section>
  `;
}

function renderQualitySignalsSection(metrics: ProjectMetrics): string {
  function passCell(rate: number | null): string {
    if (rate === null) return `<td class="muted">n/a</td>`;
    const cls = rate >= 90 ? "pass" : rate >= 60 ? "warn" : "fail";
    return `<td><span class="badge ${cls}">${rate.toFixed(0)}%</span></td>`;
  }

  // Reconciliation rows
  const recRows = [
    { id: "RC-1", label: "README consistency", rate: metrics.reconciliation.rc1_pass_rate, tip: "README backtick-quoted paths exist in the repository" },
    { id: "RC-2", label: "Task completion accuracy", rate: metrics.reconciliation.rc2_pass_rate, tip: "Completed tasks reference artifact paths that exist" },
  ];

  // Evidence rows
  const evRows = [
    { id: "EV-1", label: "Release verification", rate: metrics.evidence.ev1_pass_rate, tip: "Every release artifact has a matching verification file" },
    { id: "EV-2", label: "Benchmark coverage", rate: metrics.evidence.ev2_pass_rate, tip: "Benchmark-annotated components have result files" },
  ];

  // Diff ADR coverage rows
  const adrRows = [
    { id: "D-ADR-1", label: "Dependency ADR coverage", rate: metrics.diff_adr.dadr1_pass_rate, tip: "New manifest dependencies blocked until ADR exists" },
    { id: "D-ADR-2", label: "Security change ADR coverage", rate: metrics.diff_adr.dadr2_pass_rate, tip: "Security-related file changes blocked until ADR exists" },
    { id: "D-ADR-3", label: "Deployment change ADR coverage", rate: metrics.diff_adr.dadr3_pass_rate, tip: "Deployment manifest changes blocked until ADR exists" },
  ];

  const recTable = `
    <table>
      <thead><tr><th>Check</th><th>Description</th><th>Pass rate</th></tr></thead>
      <tbody>
        ${recRows.map((r) => `<tr><td><code>${r.id}</code></td><td title="${escapeHtml(r.tip)}">${escapeHtml(r.label)}</td>${passCell(r.rate)}</tr>`).join("")}
      </tbody>
      <tfoot><tr><td colspan="2" class="muted small">Runs recorded</td><td class="muted small">${metrics.reconciliation.run_count}</td></tr></tfoot>
    </table>`;

  const evTable = `
    <table>
      <thead><tr><th>Check</th><th>Description</th><th>Pass rate</th></tr></thead>
      <tbody>
        ${evRows.map((r) => `<tr><td><code>${r.id}</code></td><td title="${escapeHtml(r.tip)}">${escapeHtml(r.label)}</td>${passCell(r.rate)}</tr>`).join("")}
      </tbody>
      <tfoot><tr><td colspan="2" class="muted small">Runs recorded</td><td class="muted small">${metrics.evidence.run_count}</td></tr></tfoot>
    </table>`;

  const adrTable = `
    <table>
      <thead><tr><th>Check</th><th>Description</th><th>Pass rate</th></tr></thead>
      <tbody>
        ${adrRows.map((r) => `<tr><td><code>${r.id}</code></td><td title="${escapeHtml(r.tip)}">${escapeHtml(r.label)}</td>${passCell(r.rate)}</tr>`).join("")}
      </tbody>
      <tfoot><tr><td colspan="2" class="muted small">Diff records</td><td class="muted small">${metrics.diff_adr.checked_diffs}</td></tr></tfoot>
    </table>`;

  const recStatus = metrics.reconciliation.latest_status ?? "no data";
  const evStatus = metrics.evidence.latest_status ?? "no data";

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Quality Signals</h2>
        <span class="badge neutral">reconciliation · evidence · ADR</span>
      </div>
      <p class="muted small" style="margin-bottom:1rem">
        These checks run outside the G1–G5 gate chain.
        Run <code>check_reconciliation</code>, <code>check_evidence</code>, and <code>diff_check</code> to populate this section.
      </p>
      <div class="grid">
        <article class="subpanel">
          <h3>Reconciliation <span class="badge ${badgeClass(recStatus)}" style="font-size:0.75em">${recStatus}</span></h3>
          <p class="muted small">README and task artifact consistency (RC-1, RC-2)</p>
          ${recTable}
        </article>
        <article class="subpanel">
          <h3>Evidence Artifacts <span class="badge ${badgeClass(evStatus)}" style="font-size:0.75em">${evStatus}</span></h3>
          <p class="muted small">Release verification and benchmark coverage (EV-1, EV-2)</p>
          ${evTable}
        </article>
      </div>
      <div style="margin-top:1rem">
        <article class="subpanel">
          <h3>ADR Coverage (Diff Triggers)</h3>
          <p class="muted small">Rates at which structural diff triggers were accompanied by an ADR. 100% = every triggering diff had a matching ADR.</p>
          ${adrTable}
        </article>
      </div>
    </section>
  `;
}

function renderTrendsSection(metrics: ProjectMetrics): string {
  // Gate pass rate trends — use only full-sweep (run_all) records so targeted
  // gate_check re-runs don't create misleading intermediate data points.
  // Falls back to all records for gates that have no run_all history yet.
  const gateSeries: ChartSeries[] = Object.entries(metrics.gate_pass_rates).map(([gate, item]) => {
    const sweepPoints = item.history.filter((h) => h.run_batch_id !== null);
    const points = sweepPoints.length > 0 ? sweepPoints : item.history;
    return {
      label: gate,
      color: GATE_COLORS[gate] ?? "#888",
      data: points.map((h) => ({
        ts: new Date(h.timestamp).getTime(),
        value: h.pass_rate * 100,
      })),
    };
  });

  const gateChart = svgLineChart(gateSeries, {
    width: 560,
    height: 200,
    yMin: 0,
    yMax: 100,
  });

  // Complexity trend — max_cc is directly comparable to the per-function threshold;
  // avg_cc is shown as a secondary context series (it sits well below the threshold
  // even when many individual functions violate it, so plotting avg against the
  // threshold line is a category error).
  const ccSeries: ChartSeries[] = [
    {
      label: "Max CC",
      color: "#9a6700",
      data: metrics.complexity.history.map((h) => ({
        ts: new Date(h.timestamp).getTime(),
        value: h.max_cc,
      })),
    },
    {
      label: "Avg CC",
      color: "#aaaaaa",
      data: metrics.complexity.history.map((h) => ({
        ts: new Date(h.timestamp).getTime(),
        value: h.avg_cc,
      })),
    },
  ];
  const ccMax = metrics.complexity.history.length > 0
    ? Math.max(...metrics.complexity.history.map((h) => h.max_cc)) * 1.2
    : 20;
  const ccChart = svgLineChart(ccSeries, {
    width: 560,
    height: 180,
    yMin: 0,
    yMax: Math.max(ccMax, 15),
    threshold: 10,
    thresholdLabel: "CC-1 threshold (10)",
  });

  // Mutation trend
  const mutSeries: ChartSeries[] = [{
    label: "Mutation Score",
    color: "#b42318",
    data: metrics.mutation.history.map((h) => ({
      ts: new Date(h.timestamp).getTime(),
      value: h.score,
    })),
  }];
  const mutChart = svgLineChart(mutSeries, {
    width: 560,
    height: 180,
    yMin: 0,
    yMax: 100,
    threshold: 80,
    thresholdLabel: "80% target",
  });

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Trends Over Time</h2>
        <span class="badge neutral">history</span>
      </div>
      <div class="subpanel" style="margin-bottom:1rem">
        <h3>Gate Pass Rates</h3>
        <p class="muted small">Full-sweep (run_all) results per gate. Y axis = pass rate %. Targeted gate_check re-runs are excluded to avoid distorting the trend.</p>
        ${gateChart}
      </div>
      <div class="grid">
        <article class="subpanel">
          <h3>Cyclomatic Complexity</h3>
          <p class="muted small">Average CC across functions. Dashed line = CC 10 threshold.</p>
          ${ccChart}
        </article>
        <article class="subpanel">
          <h3>Mutation Score</h3>
          <p class="muted small">Score per run. Dashed line = 80% target.</p>
          ${mutChart}
        </article>
      </div>
    </section>
  `;
}

function renderProjectRollupRows(rollup: RollupMetrics): string {
  if (rollup.projects.length === 0) return `<tr><td colspan="6">No rollup data available.</td></tr>`;
  return rollup.projects.slice(0, 10).map((item) => `
    <tr>
      <td>${escapeHtml(item.project)}</td>
      <td>${pct(item.compliance_score)}</td>
      <td>${svgSparkline(
        item.compliance_score !== null ? [item.compliance_score] : [],
        { width: 80, height: 20, color: (item.compliance_score ?? 0) >= 80 ? "#2a7f62" : "#b42318" }
      )}</td>
      <td title="avg ${num(item.avg_cc)}">${num(item.max_cc, 0)}</td>
      <td>${pct(item.latest_mutation_score)}</td>
      <td>${item.unresolved_rca_count > 0 ? `<span class="badge fail">${item.unresolved_rca_count}</span>` : "·"}</td>
    </tr>
  `).join("");
}

function renderModelRollupRows(rollup: RollupMetrics): string {
  if (rollup.model_gate_rankings.length === 0) return `<tr><td colspan="7">Not enough model-tagged runs yet.</td></tr>`;
  return rollup.model_gate_rankings.slice(0, 6).map((item) => `
    <tr>
      <td>${escapeHtml(item.model)}</td>
      <td>${pct(item.overall_pass_rate)}</td>
      <td>${pct(item.gates.G1)}</td>
      <td>${pct(item.gates.G2)}</td>
      <td>${pct(item.gates.G3)}</td>
      <td>${pct(item.gates.G4)}</td>
      <td>${pct(item.gates.G5)}</td>
    </tr>
  `).join("");
}

function renderMetricsDueBadge(value: boolean | null | undefined): string {
  if (value === true) return `<span class="badge warn">due</span>`;
  if (value === false) return `<span class="badge pass">clear</span>`;
  return `<span class="badge neutral">n/a</span>`;
}

function renderAgentRollupRows(rollup: RollupMetrics): string {
  if (rollup.agent_gate_rankings.length === 0) return `<tr><td colspan="6">No agent-attributed runs yet.</td></tr>`;
  return rollup.agent_gate_rankings.slice(0, 8).map((item) => `
    <tr>
      <td><code>${escapeHtml(trunc(item.agent_id, 20))}</code></td>
      <td>${escapeHtml(item.agent_kind)}</td>
      <td>${pct(item.overall_pass_rate)}</td>
      <td>${item.runs}</td>
      <td>${item.completed_sessions}</td>
      <td>${renderMetricsDueBadge(item.metrics_due)}</td>
    </tr>
  `).join("");
}

function renderAgentKindRollupRows(rollup: RollupMetrics): string {
  if (rollup.agent_kind_rankings.length === 0) return `<tr><td colspan="4">No agent-kind data yet.</td></tr>`;
  return rollup.agent_kind_rankings.map((item) => `
    <tr>
      <td>${escapeHtml(item.agent_kind)}</td>
      <td>${pct(item.overall_pass_rate)}</td>
      <td>${item.runs}</td>
      <td>${item.agents}</td>
    </tr>
  `).join("");
}

function renderCommonViolations(rollup: RollupMetrics): string {
  if (rollup.common_violations.length === 0) return `<p class="muted">No violations recorded.</p>`;
  return svgHBarChart(
    rollup.common_violations.slice(0, 8).map((v) => ({ label: v.id, value: v.count, color: "#9a6700" })),
    { width: 320, defaultColor: "#9a6700" }
  );
}

function renderInvalidatedAssumptionCategories(rollup: RollupMetrics): string {
  if (rollup.invalidated_assumption_categories.length === 0) {
    return "<p class=\"muted\">No invalidated assumption categories yet.</p>";
  }
  return svgHBarChart(
    rollup.invalidated_assumption_categories.map((c) => ({ label: c.category, value: c.count })),
    { width: 320, defaultColor: "#005f73" }
  );
}

function renderUnresolvedRcaSection(rollup: RollupMetrics): string {
  const unresolvedRcas = (rollup.unresolved_rcas as Array<{ project: string; unresolved: number }> | undefined) ?? [];
  if (unresolvedRcas.length === 0) return "";
  return `
      <div style="margin-top:1rem">
        <article class="subpanel">
          <h3>Unresolved RCAs</h3>
          <table>
            <thead><tr><th>Project</th><th>Unresolved</th></tr></thead>
            <tbody>${unresolvedRcas.map((r) => `<tr><td>${escapeHtml(r.project)}</td><td><span class="badge ${r.unresolved > 0 ? "fail" : "pass"}">${r.unresolved}</span></td></tr>`).join("")}</tbody>
          </table>
        </article>
      </div>`;
}

function renderAdoptionTrendBadge(adoptionTrend: string | null | undefined): string {
  if (adoptionTrend === "improving") return `<span class="badge pass">${adoptionTrend}</span>`;
  if (adoptionTrend === "declining") return `<span class="badge fail">${adoptionTrend}</span>`;
  return `<span class="badge neutral">${adoptionTrend?.replace("_", " ") ?? "unknown"}</span>`;
}

function renderRollupSection(rollup: RollupMetrics): string {
  const projects = renderProjectRollupRows(rollup);
  const models = renderModelRollupRows(rollup);
  const agents = renderAgentRollupRows(rollup);
  const agentKinds = renderAgentKindRollupRows(rollup);
  const commonViolations = renderCommonViolations(rollup);
  const invalidatedAssumptions = renderInvalidatedAssumptionCategories(rollup);
  const unresolvedRcaSection = renderUnresolvedRcaSection(rollup);
  const adoptionBadge = renderAdoptionTrendBadge(rollup.adoption_trend);

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Rollup</h2>
        <div style="display:flex;gap:.5rem;align-items:center">
          ${adoptionBadge}
          <span class="badge ${badgeClass(rollup.status)}">${rollup.status}</span>
        </div>
      </div>
      <div class="grid">
        <article class="subpanel">
          <h3>Cross-Project Ranking</h3>
          <table>
            <thead><tr><th>Project</th><th>Compliance</th><th></th><th>Avg CC</th><th>Mutation</th><th>RCAs</th></tr></thead>
            <tbody>${projects}</tbody>
          </table>
        </article>
        <article class="subpanel">
          <h3>Model Comparison</h3>
          <table>
            <thead><tr><th>Model</th><th>Overall</th><th>G1</th><th>G2</th><th>G3</th><th>G4</th><th>G5</th></tr></thead>
            <tbody>${models}</tbody>
          </table>
        </article>
      </div>
      <div class="grid" style="margin-top:1rem">
        <article class="subpanel">
          <h3>Agent Comparison</h3>
          <table>
            <thead><tr><th>Agent</th><th>Kind</th><th>Overall</th><th>Runs</th><th>Completed</th><th>Metrics</th></tr></thead>
            <tbody>${agents}</tbody>
          </table>
        </article>
        <article class="subpanel">
          <h3>Agent Kind Ranking</h3>
          <table>
            <thead><tr><th>Kind</th><th>Overall</th><th>Runs</th><th>Agents</th></tr></thead>
            <tbody>${agentKinds}</tbody>
          </table>
        </article>
      </div>
      <div class="grid" style="margin-top:1rem">
        <article class="subpanel">
          <h3>Common Violations</h3>
          ${commonViolations}
        </article>
        <article class="subpanel">
          <h3>Invalidated Assumption Categories</h3>
          ${invalidatedAssumptions}
        </article>
      </div>
      ${unresolvedRcaSection}
    </section>
  `;
}

function renderAssumptionsSection(metrics: AssumptionMetricsResult, dependencies: DependencySummary): string {
  const categories = metrics.top_invalidated_categories.length > 0
    ? svgHBarChart(
        metrics.top_invalidated_categories.map((c) => ({ label: c.category, value: c.count })),
        { width: 320, defaultColor: "#005f73" }
      )
    : `<p class="muted">No invalidations yet.</p>`;

  const missing = dependencies.missing.length > 0
    ? dependencies.missing.map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.requires_runtime)}</td>
        <td>${escapeHtml(item.missing_reason ?? "missing")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">All registered tools available.</td></tr>`;

  const available = dependencies.installed.length > 0
    ? dependencies.installed.map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="badge pass" style="font-size:.78rem">present</td>
      </tr>
    `).join("")
    : `<tr><td colspan="2">—</td></tr>`;

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Assumptions and Dependencies</h2>
        <span class="badge neutral">${metrics.totals.trend}</span>
      </div>
      <div class="cards">
        <article class="card">
          <h3>Made</h3>
          <p class="big">${metrics.totals.assumptions_made}</p>
        </article>
        <article class="card">
          <h3>Invalidated</h3>
          <p class="big">${metrics.totals.assumptions_invalidated}</p>
        </article>
        <article class="card">
          <h3>Invalidation Rate</h3>
          <p class="big">${pct(metrics.totals.invalidation_rate)}</p>
        </article>
        <article class="card">
          <h3>Avg Days</h3>
          <p class="big">${num(metrics.totals.average_days_to_invalidation)}</p>
        </article>
      </div>
      <div class="grid" style="margin-top:1rem">
        <article class="subpanel">
          <h3>Top Invalidated Categories</h3>
          ${categories}
        </article>
        <article class="subpanel">
          <h3>Missing Dependencies</h3>
          <table>
            <thead><tr><th>Tool</th><th>Runtime</th><th>Reason</th></tr></thead>
            <tbody>${missing}</tbody>
          </table>
          ${dependencies.installed.length > 0 ? `
          <h3 style="margin-top:1rem">Available</h3>
          <table><thead><tr><th>Tool</th><th>Status</th></tr></thead><tbody>${available}</tbody></table>` : ""}
        </article>
      </div>
    </section>
  `;
}

// ─── Full HTML document ───────────────────────────────────────────────────────

function renderHtml(data: DashboardData): string {
  const title = `spec-check dashboard — ${trunc(data.projectPath, 72)}`;
  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f4efe4;
      --panel: #fffaf0;
      --ink: #1c1b19;
      --muted: #6c655a;
      --line: #d9cfbf;
      --accent: #005f73;
      --accent-soft: #d8efe8;
      --pass: #2a7f62;
      --warn: #9a6700;
      --fail: #b42318;
      --block: #6b1f1f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(0,95,115,0.15), transparent 28rem),
        linear-gradient(180deg, #f7f2e9 0%, var(--bg) 100%);
    }
    header {
      padding: 1.5rem 2rem 1rem;
      border-bottom: 1px solid var(--line);
      background: rgba(255,250,240,0.88);
      backdrop-filter: blur(10px);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    h1, h2, h3 { margin: 0; font-weight: 700; }
    h1 { font-size: 1.8rem; letter-spacing: -0.04em; }
    h3 { font-size: 1rem; margin-bottom: .55rem; color: var(--ink); }
    p { margin: 0.25rem 0 0; }
    main { padding: 1.5rem 2rem 3rem; display: grid; gap: 1.25rem; }
    form {
      margin-top: 0.8rem;
      display: grid;
      grid-template-columns: minmax(16rem, 1fr) minmax(11rem, 13rem) auto;
      gap: 0.6rem;
      align-items: end;
    }
    label { display: grid; gap: 0.3rem; font-size: 0.88rem; color: var(--muted); }
    input {
      width: 100%; padding: 0.65rem 0.9rem;
      border: 1px solid var(--line); background: white;
      color: var(--ink); font: inherit;
    }
    button {
      padding: 0.7rem 1.1rem; border: 0;
      background: var(--accent); color: white;
      font: inherit; cursor: pointer;
    }
    button:hover { background: #004a5c; }
    .presets { display: flex; gap: .4rem; margin-top: .4rem; flex-wrap: wrap; }
    .preset-btn {
      padding: .3rem .65rem; font-size: .82rem;
      background: #ece7db; color: var(--muted);
      border: 1px solid var(--line); cursor: pointer;
      font-family: inherit;
    }
    .preset-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .preset-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    .meta { display: flex; gap: 1rem; flex-wrap: wrap; color: var(--muted); font-size: .88rem; margin-top: .45rem; align-items: center; }
    .meta label { display: flex; align-items: center; gap: .35rem; cursor: pointer; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 1.1rem;
      box-shadow: 0 0.5rem 1.2rem rgba(28,27,25,0.05);
    }
    .panel-header {
      display: flex; justify-content: space-between;
      align-items: center; gap: 1rem; margin-bottom: .8rem;
    }
    .cards, .grid { display: grid; gap: 0.85rem; margin-top: 1rem; }
    .cards { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
    .grid { grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); }
    .card, .subpanel { padding: 0.9rem; background: white; border: 1px solid var(--line); }
    .big { font-size: 1.7rem; margin-top: .3rem; color: var(--accent); font-weight: 700; }
    .muted { color: var(--muted) !important; }
    .small { font-size: .85rem; }
    .badge {
      padding: .25rem .55rem; border-radius: 999px;
      font-size: .8rem; text-transform: uppercase;
      letter-spacing: .04em; background: #ece7db;
      display: inline-block; white-space: nowrap;
    }
    .pass { background: #dff5ea; color: var(--pass); }
    .warn { background: #fff0cc; color: var(--warn); }
    .fail { background: #ffe1dc; color: var(--fail); }
    .block { background: #f2d7d7; color: var(--block); }
    .neutral { background: #ece7db; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: .93rem; }
    th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
    th { color: var(--muted); font-weight: 600; font-size: .87rem; }
    tr:last-child td { border-bottom: none; }
    .trend-up { color: var(--pass); }
    .trend-down { color: var(--fail); }
    .trend-flat { color: var(--muted); }
    .dl-row { display: grid; grid-template-columns: auto 1fr; gap: .3rem .75rem; margin: 0; }
    .dl-row dt { color: var(--muted); font-size: .9rem; }
    .dl-row dd { margin: 0; font-size: .9rem; }
    ul { margin: .4rem 0 0; padding-left: 1.1rem; }
    li { margin-bottom: .25rem; }
    .note { margin-top: .75rem; color: var(--muted); font-size: .9rem; }
    @media (max-width: 720px) {
      header, main { padding-left: 1rem; padding-right: 1rem; }
      form { grid-template-columns: 1fr; }
      .cards { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <header>
    <h1>spec-check dashboard</h1>
    <div class="meta">
      <span>Path: ${escapeHtml(data.projectPath)}</span>
      <span>Since: ${escapeHtml(data.since ?? "all-time")}</span>
      <span>Updated: ${escapeHtml(generatedAt)}</span>
      <label><input type="checkbox" id="autorefresh" /> Auto-refresh 30s</label>
    </div>
    <form method="GET" action="/" id="filterForm">
      <label>Project Path
        <input type="text" name="path" value="${escapeHtml(data.projectPath)}" />
      </label>
      <label>Since
        <input type="text" name="since" id="sinceInput" value="${escapeHtml(data.since ?? "")}" placeholder="2026-04-01" />
      </label>
      <button type="submit">Refresh</button>
    </form>
    <div class="presets">
      <button class="preset-btn" data-days="1">1d</button>
      <button class="preset-btn" data-days="7">7d</button>
      <button class="preset-btn" data-days="30">30d</button>
      <button class="preset-btn" data-days="90">90d</button>
      <button class="preset-btn" data-days="0">All time</button>
    </div>
    <p class="note" style="margin-top:.5rem;font-size:.82rem;color:var(--muted)">JSON: <code>/api/project</code> · <code>/api/rollup</code> · <code>/api/assumptions</code> · <code>/api/dependencies</code></p>
    ${data.legacyMigration.remaining > 0 || data.legacyMigration.failed > 0 ? `<p class="note" style="margin-top:.35rem;font-size:.82rem;color:var(--fail)">Legacy JSONL remains: ${data.legacyMigration.remaining} file(s). Migration failed for ${data.legacyMigration.failed} file(s).</p>` : ""}
  </header>
  <main>
    ${renderProjectSection(data.projectMetrics)}
    ${renderQualitySignalsSection(data.projectMetrics)}
    ${renderTrendsSection(data.projectMetrics)}
    ${renderRollupSection(data.rollupMetrics)}
    ${renderAssumptionsSection(data.assumptionMetrics, data.dependencies)}
  </main>
  <script>
    // Time range presets
    var sinceInput = document.getElementById('sinceInput');
    var presetBtns = document.querySelectorAll('.preset-btn');
    var currentSince = sinceInput.value;
    presetBtns.forEach(function(btn) {
      var days = parseInt(btn.dataset.days, 10);
      var isoDate = days > 0 ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '';
      if (currentSince && isoDate && currentSince === isoDate) btn.classList.add('active');
      if (!currentSince && days === 0) btn.classList.add('active');
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        presetBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        sinceInput.value = isoDate;
        document.getElementById('filterForm').submit();
      });
    });
    // Auto-refresh
    var arBox = document.getElementById('autorefresh');
    var arTimer = null;
    function scheduleRefresh() {
      if (arTimer) clearTimeout(arTimer);
      if (arBox.checked) arTimer = setTimeout(function() { location.reload(); }, 30000);
    }
    arBox.addEventListener('change', scheduleRefresh);
    scheduleRefresh();
  </script>
</body>
</html>`;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadDashboardData(targetPath: string, since?: string): Promise<DashboardData> {
  const absPath = resolve(targetPath);
  if (!existsSync(absPath)) throw new Error(`Path not found: ${absPath}`);
  const { config } = loadConfig(absPath);
  const legacyMigration = migrateLegacyJsonlRecords(config.value.metrics.db_path, absPath);
  const service = detectServices(absPath, config).services[0]!;
  const [projectMetrics, rollupMetrics] = await Promise.all([
    getProjectMetrics(absPath, service, config, since),
    getRollupMetrics(config, since),
  ]);
  const assumptionMetrics = getAssumptionMetrics(absPath, service, config, since);
  const dependencies = checkDependencies(absPath);
  return { projectPath: absPath, since: since ?? null, projectMetrics, rollupMetrics, assumptionMetrics, dependencies, legacyMigration };
}

function sendJson(res: import("http").ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

function sendHtml(res: import("http").ServerResponse, value: string, status = 200): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(value);
}

async function readJsonBody(req: import("http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected JSON object body.");
  return parsed as Record<string, unknown>;
}

function getToolDefinition(name: string) {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name) ?? null;
}

function mergeActorIntoArguments(
  args: Record<string, unknown>,
  actor: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!actor) return args;
  return {
    ...args,
    llm: args.llm ?? actor.llm ?? actor.model,
    agent_id: args.agent_id ?? actor.agent_id,
    agent_kind: args.agent_kind ?? actor.agent_kind,
    parent_agent_id: args.parent_agent_id ?? actor.parent_agent_id,
    session_id: args.session_id ?? actor.session_id,
    run_id: args.run_id ?? actor.run_id,
  };
}

function getToolName(body: Record<string, unknown>): string {
  const toolName = typeof body.tool === "string" ? body.tool : typeof body.name === "string" ? body.name : null;
  if (!toolName) throw new Error("Request body must include `tool`.");
  return toolName;
}

function getRequestObject(
  body: Record<string, unknown>,
  key: "arguments" | "actor"
): Record<string, unknown> | undefined {
  const value = body[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return { ...(value as Record<string, unknown>) };
}

function resolveRequestProjectPath(
  args: Record<string, unknown>,
  body: Record<string, unknown>
): Record<string, unknown> {
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  if (!projectId || args.path) return args;
  const project = getRegisteredProject(projectId);
  if (!project) throw new Error(`Unknown project_id: ${projectId}`);
  return { ...args, path: project.path };
}

function applyDefaultToolPath(
  args: Record<string, unknown>,
  toolDefinition: { inputSchema: { required?: unknown } },
  defaultPath: string
): Record<string, unknown> {
  const required = Array.isArray(toolDefinition.inputSchema.required) ? toolDefinition.inputSchema.required : [];
  if (args.path || !required.includes("path")) return args;
  const registeredProjects = listRegisteredProjects();
  if (registeredProjects.length === 1) return { ...args, path: registeredProjects[0]!.path };
  if (registeredProjects.length > 1) {
    throw new Error("This tool requires `path` or `project_id` when multiple projects are registered.");
  }
  return { ...args, path: defaultPath };
}

async function executeHttpToolCall(body: Record<string, unknown>, defaultPath: string): Promise<unknown> {
  const toolName = getToolName(body);
  const toolDefinition = getToolDefinition(toolName);
  if (!toolDefinition) throw new Error(`Unknown tool: ${toolName}`);

  const rawArgs = getRequestObject(body, "arguments") ?? {};
  const actor = getRequestObject(body, "actor");
  const mergedArgs = mergeActorIntoArguments(rawArgs, actor);
  const scopedArgs = resolveRequestProjectPath(mergedArgs, body);
  const args = applyDefaultToolPath(scopedArgs, toolDefinition, defaultPath);
  const response = await executeToolRequest(toolName, args);
  return JSON.parse(response.content[0]?.text ?? "null");
}

async function registerHttpProject(req: import("http").IncomingMessage): Promise<{ project: ReturnType<typeof registerProject> }> {
  const body = await readJsonBody(req);
  const projectPath = typeof body.path === "string" ? body.path : null;
  if (!projectPath) throw new Error("MISSING_PATH");
  const projectName = typeof body.name === "string" ? body.name : undefined;
  return { project: registerProject(projectPath, projectName) };
}

function sendToolMetadata(res: import("http").ServerResponse): void {
  sendJson(res, {
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  });
}

async function handleProjectRegistration(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse
): Promise<boolean> {
  try {
    sendJson(res, await registerHttpProject(req), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message === "MISSING_PATH" ? "Request body must include `path`." : message;
    sendJson(res, { error: message, detail }, message === "MISSING_PATH" ? 400 : 500);
  }
  return true;
}

async function handleHttpToolCall(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
  targetPath: string
): Promise<boolean> {
  const body = await readJsonBody(req);
  const result = await executeHttpToolCall(body, targetPath);
  sendJson(res, result);
  return true;
}

export function resolveDashboardOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): {
  defaultPath: string;
  port: number;
  host: string;
} {
  const defaultPath = argv.find((arg) => !arg.startsWith("--")) ?? process.cwd();
  const port = Number(argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length) ?? env.PORT ?? 4319);
  const host = env.HOST ?? "127.0.0.1";
  return { defaultPath, port, host };
}

type DashboardApiContext = {
  defaultPath: string;
  host: string;
  port: number;
};

type DashboardServerContext = DashboardApiContext;

async function handleDashboardApiRequest(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
  url: URL,
  context: DashboardApiContext
): Promise<boolean> {
  const targetPath = url.searchParams.get("path") || context.defaultPath;
  if (url.pathname === "/health") {
    sendJson(res, { ok: true, path: resolve(targetPath), port: context.port, host: context.host });
    return true;
  }

  switch (`${req.method}:${url.pathname}`) {
    case "GET:/api/tools":
      sendToolMetadata(res);
      return true;
    case "GET:/api/projects":
      sendJson(res, { projects: listRegisteredProjects() });
      return true;
    case "POST:/api/projects":
      return handleProjectRegistration(req, res);
    case "POST:/api/tools/call":
      return handleHttpToolCall(req, res, targetPath);
    default:
      return false;
  }
}

async function handleDashboardPageRequest(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
  context: DashboardServerContext
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${context.host}:${context.port}`}`);
    const handled = await handleDashboardApiRequest(req, res, url, context);
    if (handled) return;

    const targetPath = url.searchParams.get("path") || context.defaultPath;
    const since = url.searchParams.get("since") || undefined;
    const data = await loadDashboardData(targetPath, since);
    if (url.pathname === "/api/project") return sendJson(res, data.projectMetrics);
    if (url.pathname === "/api/rollup") return sendJson(res, data.rollupMetrics);
    if (url.pathname === "/api/assumptions") return sendJson(res, data.assumptionMetrics);
    if (url.pathname === "/api/dependencies") return sendJson(res, data.dependencies);
    if (url.pathname !== "/") return sendJson(res, { error: "Not found" }, 404);
    return sendHtml(res, renderHtml(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sendJson(res, { error: "DASHBOARD_ERROR", detail: message }, 500);
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

export async function startDashboardServer(argv: string[] = process.argv.slice(2)) {
  const args = argv;
  const { defaultPath, port, host } = resolveDashboardOptions(args);
  const { config } = loadConfig(defaultPath);
  const startupMigration = migrateLegacyJsonlRecords(config.value.metrics.db_path, defaultPath);
  if (startupMigration.migrated > 0 || startupMigration.removed > 0 || startupMigration.failed > 0 || findLegacyJsonlFiles(config.value.metrics.db_path, defaultPath).length > 0) {
    process.stderr.write(
      `[spec-check] dashboard storage migration: migrated=${startupMigration.migrated} removed=${startupMigration.removed} failed=${startupMigration.failed} remaining=${startupMigration.remaining}\n`
    );
  }

  const server = createServer((req, res) => {
    void handleDashboardPageRequest(req, res, { defaultPath, host, port });
  });

  server.listen(port, host, () => {
    process.stdout.write(`spec-check dashboard listening on http://${host}:${port}\n`);
  });
}

const entryArg = process.argv[1];
if (!process.env.VITEST && entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  startDashboardServer().catch((error) => {
    process.stderr.write(`[spec-check] dashboard startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
