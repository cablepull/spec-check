import { createServer } from "http";
import { resolve } from "path";
import { existsSync } from "fs";
import { loadConfig } from "./config.js";
import { detectServices } from "./monorepo.js";
import { getProjectMetrics, getRollupMetrics, type ProjectMetrics, type RollupMetrics } from "./metrics.js";
import { getAssumptionMetrics, type AssumptionMetricsResult } from "./assumptions.js";
import { checkDependencies } from "./dependencies.js";

type DependencySummary = ReturnType<typeof checkDependencies>;

interface DashboardData {
  projectPath: string;
  since: string | null;
  projectMetrics: ProjectMetrics;
  rollupMetrics: RollupMetrics;
  assumptionMetrics: AssumptionMetricsResult;
  dependencies: DependencySummary;
}

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

function miniBar(value: number | null | undefined, max = 100, width = 10): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "·".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function statusSparkline(values: Array<number | null | undefined>, warnCutoff = 50): string {
  return values.slice(-14).map((value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "·";
    if (value >= 100) return "✓";
    if (value <= 0) return "✗";
    if (value < warnCutoff) return "△";
    return "✓";
  }).join("");
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

function trendArrow(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "→0";
  if (delta > 0) return `↑${Number(delta.toFixed(2))}`;
  if (delta < 0) return `↓${Number(Math.abs(delta).toFixed(2))}`;
  return "→0";
}

function badgeClass(status: string): string {
  switch (status) {
    case "PASS":
      return "pass";
    case "PASSING_WITH_WARNINGS":
      return "warn";
    case "FAILING":
      return "fail";
    case "BLOCKED":
      return "block";
    default:
      return "neutral";
  }
}

function renderProjectSection(metrics: ProjectMetrics): string {
  const gates = Object.entries(metrics.gate_pass_rates).map(([gate, item]) => `
    <tr>
      <td>${gate}</td>
      <td>${pct(item.value)}</td>
      <td><span class="spark">${escapeHtml(statusSparkline(item.history.map((entry) => entry.pass_rate * 100)))}</span></td>
    </tr>
  `).join("");

  const violations = metrics.top_violations.length > 0
    ? metrics.top_violations.map((item) => `
      <tr>
        <td>${escapeHtml(item.id)}</td>
        <td><span class="bar">${escapeHtml(miniBar(item.count, Math.max(...metrics.top_violations.map((entry) => entry.count)), 12))}</span></td>
        <td>${item.count}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">No violations recorded.</td></tr>`;

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
          <p>Spec coverage ${pct(metrics.spec_coverage)}</p>
        </article>
        <article class="card">
          <h3>Complexity</h3>
          <p class="big">${num(metrics.complexity.cc_average)}</p>
          <p>Max CC ${num(metrics.complexity.cc_max, 0)} · Δ ${trendArrow(metrics.complexity.cc_delta)}</p>
        </article>
        <article class="card">
          <h3>Mutation</h3>
          <p class="big">${pct(metrics.mutation.latest_score)}</p>
          <p>${escapeHtml(numericSparkline(metrics.mutation.history.map((item) => item.score), 10))}</p>
        </article>
        <article class="card">
          <h3>Assumptions</h3>
          <p class="big">${pct(metrics.assumptions.invalidation_rate)}</p>
          <p>Supersession ${pct(metrics.assumptions.supersession_rate)}</p>
        </article>
      </div>
      <div class="grid">
        <article class="subpanel">
          <h3>Gate Timeline</h3>
          <table>
            <thead><tr><th>Gate</th><th>Pass Rate</th><th>History</th></tr></thead>
            <tbody>${gates}</tbody>
          </table>
        </article>
        <article class="subpanel">
          <h3>Top Violations</h3>
          <table>
            <thead><tr><th>ID</th><th>Frequency</th><th>Count</th></tr></thead>
            <tbody>${violations}</tbody>
          </table>
        </article>
      </div>
      <div class="grid">
        <article class="subpanel">
          <h3>Complexity Trend</h3>
          <p class="spark large">${escapeHtml(numericSparkline(metrics.complexity.history.map((item) => item.avg_cc), 18))}</p>
          <p>Trend ${metrics.complexity.trend} · CC Δ ${trendArrow(metrics.complexity.cc_delta)} · Cognitive Δ ${trendArrow(metrics.complexity.cognitive_delta)}</p>
        </article>
        <article class="subpanel">
          <h3>Notes</h3>
          ${metrics.notes.length > 0
            ? `<ul>${metrics.notes.map((note) => `<li><strong>${escapeHtml(note.code)}</strong> ${escapeHtml(note.detail)}</li>`).join("")}</ul>`
            : "<p>No metric warnings.</p>"}
        </article>
      </div>
    </section>
  `;
}

function renderRollupSection(rollup: RollupMetrics): string {
  const projects = rollup.projects.length > 0
    ? rollup.projects.slice(0, 10).map((item) => `
      <tr>
        <td>${escapeHtml(item.project)}</td>
        <td>${pct(item.compliance_score)}</td>
        <td><span class="bar">${escapeHtml(miniBar(item.compliance_score, 100, 12))}</span></td>
        <td>${num(item.avg_cc)}</td>
        <td>${pct(item.latest_mutation_score)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">No rollup data available.</td></tr>`;

  const models = rollup.model_gate_rankings.length > 0
    ? rollup.model_gate_rankings.slice(0, 6).map((item) => `
      <tr>
        <td>${escapeHtml(item.model)}</td>
        <td>${pct(item.overall_pass_rate)}</td>
        <td>${pct(item.gates.G1)}</td>
        <td>${pct(item.gates.G2)}</td>
        <td>${pct(item.gates.G3)}</td>
        <td>${pct(item.gates.G4)}</td>
        <td>${pct(item.gates.G5)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">Not enough model-tagged runs yet.</td></tr>`;

  const categories = rollup.invalidated_assumption_categories.length > 0
    ? `<ul>${rollup.invalidated_assumption_categories.map((item) => `<li>${escapeHtml(item.category)} <strong>${item.count}</strong></li>`).join("")}</ul>`
    : "<p>No invalidated assumption categories yet.</p>";

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Rollup</h2>
        <span class="badge ${badgeClass(rollup.status)}">${rollup.status}</span>
      </div>
      <div class="grid">
        <article class="subpanel">
          <h3>Cross-Project Ranking</h3>
          <table>
            <thead><tr><th>Project</th><th>Compliance</th><th>Bar</th><th>Avg CC</th><th>Mutation</th></tr></thead>
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
      <div class="grid">
        <article class="subpanel">
          <h3>Common Violations</h3>
          ${rollup.common_violations.length > 0
            ? `<ul>${rollup.common_violations.slice(0, 8).map((item) => `<li>${escapeHtml(item.id)} <strong>${item.count}</strong></li>`).join("")}</ul>`
            : "<p>No violations recorded.</p>"}
        </article>
        <article class="subpanel">
          <h3>Invalidated Assumption Categories</h3>
          ${categories}
        </article>
      </div>
    </section>
  `;
}

function renderAssumptionsSection(metrics: AssumptionMetricsResult, dependencies: DependencySummary): string {
  const categories = metrics.top_invalidated_categories.length > 0
    ? metrics.top_invalidated_categories.map((item) => `
      <tr>
        <td>${escapeHtml(item.category)}</td>
        <td>${item.count}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="2">No invalidations yet.</td></tr>`;

  const missing = dependencies.missing.length > 0
    ? dependencies.missing.map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.requires_runtime)}</td>
        <td>${escapeHtml(item.missing_reason ?? "missing")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">All registered tools are available.</td></tr>`;

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Assumptions and Dependencies</h2>
        <span class="badge neutral">${metrics.totals.trend}</span>
      </div>
      <div class="cards">
        <article class="card">
          <h3>Assumptions Made</h3>
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
      <div class="grid">
        <article class="subpanel">
          <h3>Top Categories</h3>
          <table>
            <thead><tr><th>Category</th><th>Count</th></tr></thead>
            <tbody>${categories}</tbody>
          </table>
        </article>
        <article class="subpanel">
          <h3>Missing Dependencies</h3>
          <table>
            <thead><tr><th>Tool</th><th>Runtime</th><th>Reason</th></tr></thead>
            <tbody>${missing}</tbody>
          </table>
        </article>
      </div>
    </section>
  `;
}

function renderHtml(data: DashboardData): string {
  const title = `spec-check dashboard — ${trunc(data.projectPath, 72)}`;
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
      padding: 2rem 2rem 1rem;
      border-bottom: 1px solid var(--line);
      background: rgba(255,250,240,0.8);
      backdrop-filter: blur(10px);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    h1, h2, h3 { margin: 0; font-weight: 700; }
    h1 { font-size: 2rem; letter-spacing: -0.04em; }
    p { margin: 0.25rem 0 0; }
    main { padding: 1.5rem 2rem 3rem; display: grid; gap: 1.25rem; }
    form {
      margin-top: 1rem;
      display: grid;
      grid-template-columns: minmax(18rem, 1fr) minmax(12rem, 14rem) auto;
      gap: 0.75rem;
      align-items: end;
    }
    label { display: grid; gap: 0.35rem; font-size: 0.9rem; color: var(--muted); }
    input {
      width: 100%;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--line);
      background: white;
      color: var(--ink);
      font: inherit;
    }
    button {
      padding: 0.8rem 1rem;
      border: 0;
      background: var(--accent);
      color: white;
      font: inherit;
      cursor: pointer;
    }
    .meta { display: flex; gap: 1rem; flex-wrap: wrap; color: var(--muted); font-size: 0.95rem; margin-top: 0.5rem; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 1.1rem;
      box-shadow: 0 0.6rem 1.4rem rgba(28,27,25,0.06);
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .cards, .grid {
      display: grid;
      gap: 0.9rem;
      margin-top: 1rem;
    }
    .cards { grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
    .grid { grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); }
    .card, .subpanel {
      padding: 0.9rem;
      background: white;
      border: 1px solid var(--line);
    }
    .big { font-size: 1.75rem; margin-top: 0.3rem; color: var(--accent); }
    .badge {
      padding: 0.28rem 0.6rem;
      border-radius: 999px;
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #ece7db;
    }
    .pass { background: #dff5ea; color: var(--pass); }
    .warn { background: #fff0cc; color: var(--warn); }
    .fail { background: #ffe1dc; color: var(--fail); }
    .block { background: #f2d7d7; color: var(--block); }
    .neutral { background: #ece7db; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 0.94rem; }
    th, td { text-align: left; padding: 0.55rem 0.4rem; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .spark, .bar { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; white-space: pre; }
    .spark.large { font-size: 1.2rem; }
    ul { margin: 0.4rem 0 0; padding-left: 1.1rem; }
    .note { margin-top: 0.75rem; color: var(--muted); font-size: 0.9rem; }
    @media (max-width: 720px) {
      header, main { padding-left: 1rem; padding-right: 1rem; }
      form { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>spec-check dashboard</h1>
    <div class="meta">
      <span>Project: ${escapeHtml(data.projectPath)}</span>
      <span>Since: ${escapeHtml(data.since ?? "all-time")}</span>
      <span>Storage: ${escapeHtml(data.projectMetrics.path)}</span>
    </div>
    <form method="GET" action="/">
      <label>Project Path
        <input type="text" name="path" value="${escapeHtml(data.projectPath)}" />
      </label>
      <label>Since
        <input type="text" name="since" value="${escapeHtml(data.since ?? "")}" placeholder="2026-04-01" />
      </label>
      <button type="submit">Refresh</button>
    </form>
    <p class="note">JSON endpoints: <code>/api/project</code>, <code>/api/rollup</code>, <code>/api/assumptions</code>, <code>/api/dependencies</code></p>
  </header>
  <main>
    ${renderProjectSection(data.projectMetrics)}
    ${renderRollupSection(data.rollupMetrics)}
    ${renderAssumptionsSection(data.assumptionMetrics, data.dependencies)}
  </main>
</body>
</html>`;
}

async function loadDashboardData(targetPath: string, since?: string): Promise<DashboardData> {
  const absPath = resolve(targetPath);
  if (!existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }
  const { config } = loadConfig(absPath);
  const service = detectServices(absPath, config).services[0]!;
  const [projectMetrics, rollupMetrics] = await Promise.all([
    getProjectMetrics(absPath, service, config, since),
    getRollupMetrics(config, since),
  ]);
  const assumptionMetrics = getAssumptionMetrics(absPath, service, config, since);
  const dependencies = checkDependencies(absPath);
  return {
    projectPath: absPath,
    since: since ?? null,
    projectMetrics,
    rollupMetrics,
    assumptionMetrics,
    dependencies,
  };
}

function sendJson(res: import("http").ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

function sendHtml(res: import("http").ServerResponse, value: string, status = 200): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(value);
}

async function main() {
  const args = process.argv.slice(2);
  const defaultPath = args.find((arg) => !arg.startsWith("--")) ?? process.cwd();
  const port = Number(args.find((arg) => arg.startsWith("--port="))?.slice("--port=".length) ?? process.env.PORT ?? 4319);
  const host = process.env.HOST ?? "127.0.0.1";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
      const targetPath = url.searchParams.get("path") || defaultPath;
      const since = url.searchParams.get("since") || undefined;

      if (url.pathname === "/health") {
        return sendJson(res, { ok: true, path: resolve(targetPath), port, host });
      }

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
  });

  server.listen(port, host, () => {
    process.stdout.write(`spec-check dashboard listening on http://${host}:${port}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`[spec-check] dashboard startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
