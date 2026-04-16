// Output formatter — converts GateResult / RunResult to text, JSON, or mermaid
import type { GateResult, RunResult, CriterionResult, Format } from "./types.js";
import type { ArtifactValidationSummary } from "./artifacts.js";
import type { InstallFailure } from "./types.js";
import type { ComplexityReport } from "./complexity.js";
import type { MutationReport, MutationNote, MutationFunctionResult } from "./mutation.js";
import type { DiffReport } from "./diff.js";
import type {
  AssumptionMetricsResult,
  AssumptionValidationResult,
  ListedAssumptionsResult,
  SupersessionHistoryResult,
} from "./assumptions.js";

const ICON: Record<string, string> = {
  PASS: "✅",
  PASSING_WITH_WARNINGS: "⚠️",
  FAILING: "❌",
  BLOCKED: "🚫",
  BLOCK: "🚫",
  VIOLATION: "❌",
  WARNING: "⚠️",
};

const MAX_WIDTH = 120;

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

function trendArrow(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "→0";
  if (delta > 0) return `↑${Number(delta.toFixed(2))}`;
  if (delta < 0) return `↓${Number(Math.abs(delta).toFixed(2))}`;
  return "→0";
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

function numericSparkline(values: number[], width = 10): string {
  const glyphs = "▁▂▃▄▅▆▇█";
  const slice = values.slice(-width);
  if (slice.length === 0) return "·".repeat(width);
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  if (min === max) return "▅".repeat(slice.length);
  return slice.map((value) => {
    const idx = Math.max(0, Math.min(glyphs.length - 1, Math.round(((value - min) / (max - min)) * (glyphs.length - 1))));
    return glyphs[idx]!;
  }).join("");
}

function horizontalBar(count: number, maxCount: number, width = 16): string {
  const filled = maxCount <= 0 ? 0 : Math.max(1, Math.round((count / maxCount) * width));
  return `${"█".repeat(Math.min(width, filled))}${"░".repeat(Math.max(0, width - filled))}`;
}

function criterionLine(c: CriterionResult): string {
  const icon = ICON[c.status] ?? "•";
  const conf = c.confidence !== undefined ? ` (confidence: ${(c.confidence * 100).toFixed(0)}%)` : "";
  let line = `  ${icon} [${c.id}] ${c.status}${conf}: ${c.detail}`;
  if (c.evidence && c.evidence.length > 0) {
    line += `\n     Evidence: ${c.evidence.slice(0, 3).join("; ")}`;
  }
  if (c.fix) {
    line += `\n     Fix: ${c.fix}`;
  }
  return line;
}

function gateBlock(g: GateResult): string {
  const icon = ICON[g.status] ?? "•";
  const lines = [
    `${icon} Gate ${g.gate} — ${g.name}: ${g.status} (${g.durationMs}ms)`,
    ...g.criteria.map(criterionLine),
  ];
  return lines.join("\n");
}

// ── Gate result formatters ─────────────────────────────────────────────────────

export function formatGateResult(result: GateResult, format: Format = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  if (format === "mermaid") {
    const nodeId = result.gate.replace("-", "_");
    const lines = [
      "```mermaid",
      "flowchart TD",
      `  ${nodeId}["${result.gate}: ${result.name}<br/>${result.status}"]`,
    ];
    result.criteria.forEach((c) => {
      const cid = c.id.replace("-", "_");
      const shape = c.status === "PASS" ? `(${c.id})` : `[${c.id}: ${c.status}]`;
      lines.push(`  ${nodeId} --> ${cid}${shape}`);
    });
    lines.push("```");
    return lines.join("\n");
  }

  return [
    `═══ Gate ${result.gate}: ${result.name} ═══`,
    `Status: ${ICON[result.status]} ${result.status}  |  Duration: ${result.durationMs}ms`,
    "",
    ...result.criteria.map(criterionLine),
  ].join("\n");
}

// ── Run result formatters ──────────────────────────────────────────────────────

export function formatRunResult(result: RunResult, format: Format = "text"): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  if (format === "mermaid") {
    const lines = ["```mermaid", "flowchart LR"];
    const gateNames = result.gates.map((g) => g.gate);
    for (let i = 0; i < gateNames.length; i++) {
      const g = result.gates[i]!;
      const icon = ICON[g.status] ?? "";
      const label = `${g.gate}: ${g.status}`;
      if (i === 0) {
        lines.push(`  START([Start]) --> ${g.gate}["${label}"]`);
      } else {
        lines.push(`  ${gateNames[i - 1]} --> ${g.gate}["${label}"]`);
      }
    }
    lines.push("```");
    return lines.join("\n");
  }

  const separator = "─".repeat(60);
  const sections: string[] = [
    `spec-check Run — ${result.timestamp}`,
    `Path: ${result.path}`,
    `LLM: ${result.llm.model} (${result.llm.provider})  |  Overall: ${ICON[result.status]} ${result.status}  |  ${result.durationMs}ms`,
    separator,
    ...result.gates.map(gateBlock),
    separator,
    "Next Steps:",
    ...result.nextSteps.map((s) => `  → ${s}`),
  ];

  return sections.join("\n");
}

export function formatArtifactValidationResult(
  result: ArtifactValidationSummary,
  format: Extract<Format, "text" | "json"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const lines = [
    `Artifact Validation — ${result.status}`,
    `Target: ${result.target}`,
    `Kind: ${result.kind}`,
    `Files: ${result.results.length}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
  ];

  for (const item of result.results) {
    lines.push(`${ICON[item.status] ?? "•"} ${item.file}`);
    lines.push(`  ${item.artifactKind.toUpperCase()} / ${item.gate} / ${item.status}`);
    for (const criterion of item.criteria) {
      lines.push(criterionLine(criterion));
    }
    lines.push("─".repeat(60));
  }

  return lines.join("\n");
}

export function formatDependencyCheckResult(result: {
  available_package_managers: Record<string, boolean>;
  available_runtimes: Record<string, boolean>;
  installed: Array<{ name: string; version: string | null; covers: string[]; languages: string[] }>;
  missing: Array<{
    name: string;
    covers: string[];
    languages: string[];
    install_commands: Record<string, string>;
    missing_reason?: string;
    requires_runtime: string;
    runtime_available: boolean;
  }>;
  unavailable_metrics: Array<{ metric: string; languages: string[]; dependencies: string[] }>;
  durationMs: number;
}): string {
  const lines = [
    `Dependency Check (${result.durationMs}ms)`,
    `Package managers: ${Object.entries(result.available_package_managers).filter(([, ok]) => ok).map(([name]) => name).join(", ") || "none"}`,
    `Runtimes: ${Object.entries(result.available_runtimes).filter(([, ok]) => ok).map(([name]) => name).join(", ") || "none"}`,
    "─".repeat(60),
    "Installed:",
  ];

  if (result.installed.length === 0) lines.push("  none");
  for (const dep of result.installed) {
    lines.push(`  ✅ ${dep.name}${dep.version ? ` (${dep.version})` : ""}`);
    lines.push(`     covers: ${dep.covers.join(", ")}`);
    lines.push(`     languages: ${dep.languages.join(", ")}`);
  }

  lines.push("─".repeat(60));
  lines.push("Missing:");
  if (result.missing.length === 0) lines.push("  none");
  for (const dep of result.missing) {
    lines.push(`  ❌ ${dep.name}`);
    lines.push(`     runtime: ${dep.requires_runtime} (${dep.runtime_available ? "available" : "missing"})`);
    if (dep.missing_reason) lines.push(`     reason: ${dep.missing_reason}`);
    lines.push(`     covers: ${dep.covers.join(", ")}`);
    lines.push(`     languages: ${dep.languages.join(", ")}`);
    const installEntries = Object.entries(dep.install_commands);
    if (installEntries.length > 0) {
      lines.push(`     install: ${installEntries.map(([mgr, cmd]) => `${mgr}: ${cmd}`).join(" | ")}`);
    }
  }

  lines.push("─".repeat(60));
  lines.push("Unavailable metrics:");
  if (result.unavailable_metrics.length === 0) lines.push("  none");
  for (const item of result.unavailable_metrics) {
    lines.push(`  • ${item.metric}: ${item.languages.join(", ")} via ${item.dependencies.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatInstallDependencyResult(
  result:
    | { ok: true; dependency: string; manager: string; version: string | null; stdout: string; stderr: string }
    | { ok: false; manager?: string; failure: InstallFailure }
): string {
  if (result.ok) {
    return [
      `Install Dependency — SUCCESS`,
      `Dependency: ${result.dependency}`,
      `Manager: ${result.manager}`,
      `Version: ${result.version ?? "unknown"}`,
      result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
      result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `Install Dependency — FAILURE`,
    `Dependency: ${result.failure.dependency}`,
    `Manager: ${result.manager ?? "none"}`,
    `Reason: ${result.failure.reason}`,
    `Explanation: ${result.failure.human_explanation}`,
    `Suggestion: ${result.failure.suggestion}`,
    `Affects metrics: ${result.failure.affects_metrics.join(", ") || "none"}`,
    `Affects languages: ${result.failure.affects_languages.join(", ") || "none"}`,
    `Raw output: ${result.failure.raw_output || "(empty)"}`,
  ].join("\n");
}

export function formatComplexityReport(
  result: ComplexityReport,
  format: Extract<Format, "text" | "json" | "mermaid"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "mermaid") {
    const top = result.files
      .flatMap((file) => file.functions.map((fn) => ({ label: trunc(`${file.file}:${fn.name}`, 24), cc: fn.cc, cognitive: fn.cognitive ?? 0 })))
      .sort((a, b) => b.cc - a.cc)
      .slice(0, 10);
    return [
      "```mermaid",
      "%% Mermaid 10.x",
      "xychart-beta",
      '  title "Complexity Trend"',
      `  x-axis [${top.map((_, idx) => idx + 1).join(", ")}]`,
      `  bar [${top.map((item) => item.cc).join(", ")}]`,
      `  line [${top.map((item) => item.cognitive).join(", ")}]`,
      "```",
    ].join("\n");
  }

  const lines = [
    `Complexity Report — ${result.status}`,
    `Path: ${result.path}`,
    `Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    "Criteria:",
    ...result.criteria.map((criterion) => criterionLine(criterion)),
    "─".repeat(60),
  ];

  if (result.notes.length > 0) {
    lines.push("Notes:");
    for (const note of result.notes) {
      lines.push(`  • [${note.code}] ${note.file ? `${note.file}: ` : ""}${note.detail}`);
    }
    lines.push("─".repeat(60));
  }

  lines.push("Complexity Heatmap:");
  lines.push(trunc("File | Function | CC | Cognitive | Length | Nesting | Δ", MAX_WIDTH));
  lines.push("─".repeat(60));
  const topFns = result.files
    .flatMap((file) => file.functions.map((fn) => ({ file: file.file, fn })))
    .sort((a, b) => b.fn.cc - a.fn.cc)
    .slice(0, 20);
  for (const item of topFns) {
    const row = [
      trunc(item.file, 28),
      trunc(item.fn.name, 24),
      String(item.fn.cc).padStart(2, " "),
      String(item.fn.cognitive ?? "n/a").padStart(3, " "),
      String(item.fn.length).padStart(3, " "),
      String(item.fn.nesting ?? "n/a").padStart(3, " "),
      trendArrow(item.fn.cc_delta),
    ].join(" | ");
    lines.push(trunc(row, MAX_WIDTH));
  }

  return lines.join("\n");
}

function formatMutationNotes(notes: MutationNote[]): string[] {
  if (notes.length === 0) return [];
  const result = ["Notes:"];
  for (const note of notes) {
    result.push(`  • [${note.code}] ${note.file ? `${note.file}: ` : ""}${note.detail}`);
  }
  result.push("─".repeat(60));
  return result;
}

function formatMutationFunctions(functions: MutationFunctionResult[]): string[] {
  if (functions.length === 0) return [];
  const result = ["Functions:"];
  for (const fn of functions) {
    const score = fn.score === null ? "n/a" : `${fn.score.toFixed(1)}%`;
    const critical = fn.critical ? fn.critical_match ?? "yes" : "no";
    result.push(`  • ${fn.file}:${fn.name} score=${score} critical=${critical} cc=${fn.cc ?? "n/a"} survivors=${fn.surviving_mutants.length}`);
  }
  return result;
}

export function formatMutationReport(
  result: MutationReport,
  format: Extract<Format, "text" | "json" | "mermaid"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "mermaid") {
    const historyScore = result.score === null ? 0 : Number(result.score.toFixed(2));
    return ["```mermaid", "%% Mermaid 10.x", "xychart-beta", '  title "Mutation Score Trend"', "  x-axis [1]", `  line [${historyScore}]`, "```"].join("\n");
  }

  const scoreStr = result.score === null ? "n/a" : `${result.score.toFixed(1)}%`;
  const lines = [
    `Mutation Report — ${result.status}`,
    `Path: ${result.path}`,
    `Language: ${result.language}  |  Tool: ${result.tool ?? "none"}  |  Trigger: ${result.trigger}`,
    `Score: ${scoreStr}  |  Mutants: ${result.total_mutants} total / ${result.killed} killed / ${result.survived} survived / ${result.timeout} timeout`,
    `Trend: ${numericSparkline(result.score === null ? [] : [result.score])}`,
    `Incremental: ${result.incremental ? "yes" : "no"}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    "Criteria:",
    ...result.criteria.map((criterion) => criterionLine(criterion)),
    "─".repeat(60),
    ...formatMutationNotes(result.notes),
    ...formatMutationFunctions(result.functions),
  ];

  return lines.join("\n");
}

export function formatAssumptionValidationResult(
  result: AssumptionValidationResult,
  format: Extract<Format, "text" | "json"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  return [
    `Assumption Check — ${result.status}`,
    `Path: ${result.path}`,
    `Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    ...result.criteria.map((criterion) => criterionLine(criterion)),
  ].join("\n");
}

export function formatListedAssumptionsResult(
  result: ListedAssumptionsResult,
  format: Extract<Format, "text" | "json"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines = [
    `Assumptions — ${result.path}`,
    `Artifacts: ${result.items.length}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
  ];
  for (const item of result.items) {
    lines.push(`${item.artifact_path} (${item.artifact_type})`);
    if (item.assumptions.length === 0) {
      lines.push("  • none declared");
      continue;
    }
    for (const row of item.assumptions) {
      lines.push(`  • ${row.id} [${row.status}] ${row.assumption}`);
      lines.push(`    basis: ${row.basis}`);
    }
    lines.push("─".repeat(60));
  }
  return lines.join("\n");
}

export function formatSupersessionHistoryResult(
  result: SupersessionHistoryResult,
  format: Extract<Format, "text" | "json"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines = [
    `Supersession History — ${result.path}`,
    `Events: ${result.events.length}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    trunc("Artifact | Model | Assumption | Type | Days", MAX_WIDTH),
    "─".repeat(60),
  ];
  for (const event of result.events) {
    lines.push(trunc([
      trunc(event.original_artifact.split("/").slice(-2).join("/"), 24),
      trunc(event.original_model, 12),
      trunc(event.assumption_text, 60),
      trunc(event.artifact_type ?? "n/a", 8),
      String(event.days_to_invalidation ?? "n/a"),
    ].join(" | "), MAX_WIDTH));
  }
  return lines.join("\n");
}

export function formatAssumptionMetricsResult(
  result: AssumptionMetricsResult,
  format: Extract<Format, "text" | "json" | "mermaid"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "mermaid") {
    return [
      "```mermaid",
      "pie title Invalidated Assumption Categories",
      ...result.top_invalidated_categories.map((item) => `  "${item.category}" : ${item.count}`),
      "```",
      "",
      "```mermaid",
      "xychart-beta",
      '  title "Assumption Invalidation Rate"',
      `  x-axis [${result.history.map((_, idx) => idx + 1).join(", ")}]`,
      `  line [${result.history.map((item) => Number(item.invalidation_rate.toFixed(2))).join(", ")}]`,
      "```",
    ].join("\n");
  }
  const lines = [
    `Assumption Metrics — ${result.path}`,
    `Since: ${result.since ?? "all-time"}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    `Total assumptions: ${result.totals.assumptions_made}`,
    `Invalidated: ${result.totals.assumptions_invalidated}`,
    `Invalidation rate: ${result.totals.invalidation_rate === null ? "n/a" : `${result.totals.invalidation_rate.toFixed(1)}%`}`,
    `Average days to invalidation: ${result.totals.average_days_to_invalidation === null ? "n/a" : result.totals.average_days_to_invalidation.toFixed(1)}`,
    `Trend: ${result.totals.trend}  ${numericSparkline(result.history.map((item) => item.invalidation_rate))}`,
    "─".repeat(60),
    "By Artifact Type:",
    ...result.by_artifact_type.map((item) => `  • ${item.artifact_type}: made=${item.made} invalidated=${item.invalidated} rate=${item.invalidation_rate === null ? "n/a" : `${item.invalidation_rate.toFixed(1)}%`}`),
    "─".repeat(60),
    "Top Invalidated Categories:",
    ...(result.top_invalidated_categories.length > 0 ? result.top_invalidated_categories.map((item) => `  • ${item.category}: ${item.count}`) : ["  none"]),
    "─".repeat(60),
    "By Model:",
    ...result.by_model.map((item) => `  • ${item.model}: made=${item.assumptions_made} invalidated=${item.assumptions_invalidated} rate=${item.invalidation_rate === null ? "n/a" : `${item.invalidation_rate.toFixed(1)}%`}`),
  ];
  return lines.join("\n");
}

export function formatDiffReport(
  result: DiffReport,
  format: Extract<Format, "text" | "json"> = "text"
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines = [
    `Diff Report — ${result.status}`,
    `Path: ${result.path}`,
    `Base: ${result.base ?? "HEAD"}`,
    `Files: ${result.files.length}  |  Duration: ${result.durationMs}ms`,
    "─".repeat(60),
    "Criteria:",
    ...result.criteria.map((criterion) => criterionLine(criterion)),
    "─".repeat(60),
    "Categories:",
  ];
  for (const [category, files] of Object.entries(result.categories)) {
    if (files.length === 0) continue;
    lines.push(`  ${category}: ${files.join(", ")}`);
  }
  if (result.notes.length > 0) {
    lines.push("─".repeat(60));
    lines.push("Notes:");
    for (const note of result.notes) {
      lines.push(`  • [${note.code}] ${note.detail}`);
    }
  }
  return lines.join("\n");
}

// ── Generic serialiser (for MCP text/content responses) ───────────────────────
export function toMcpText(data: unknown, format: Format = "json"): string {
  if (format === "json" || typeof data === "object") {
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}
