#!/usr/bin/env node
/**
 * spec-check CLI
 *
 * Every subcommand that maps to an MCP tool routes through executeToolRequest,
 * keeping all business logic in one place and ensuring CLI and MCP stay in sync.
 *
 * CLI-only capabilities (no MCP equivalent):
 *   watch  — filesystem watcher that auto-runs gates on spec file changes
 *   report — generates a combined text/JSON summary written to a file
 */
import { resolve, join } from "path";
import { existsSync, writeFileSync, watch as fsWatch } from "fs";
import { executeToolRequest, TOOL_DEFINITIONS, startMcpServer, SERVER_VERSION } from "./index.js";
import { startDashboardServer } from "./dashboard.js";
import { runInit, initResultToText } from "./init.js";

// ── Arg parsing helpers ────────────────────────────────────────────────────────

function flag(args: string[], ...names: string[]): boolean {
  return names.some((n) => args.includes(n));
}

function option(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  }
  return undefined;
}

function positional(args: string[]): string[] {
  return args.filter((a, i) => {
    if (a.startsWith("-")) return false;
    const prev = args[i - 1];
    if (prev && prev.startsWith("-") && !prev.startsWith("--no-")) return false;
    return true;
  });
}

// ── Response output ────────────────────────────────────────────────────────────

// MCP responses wrap content in an envelope: { data, meta, workflow }.
// The CLI extracts the "data" field for human-readable output.
// If format=json is requested, the full envelope is printed as-is.
function printResponse(resp: Awaited<ReturnType<typeof executeToolRequest>>, format?: string): void {
  const raw = resp.content.map((c) => c.text).join("\n");
  if (format === "json") {
    process.stdout.write(raw + "\n");
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Envelope format: { data: string | object, meta?, workflow? }
    if ("data" in parsed) {
      const data = parsed.data;
      const out = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      process.stdout.write(out + "\n");
      return;
    }
  } catch {
    // Not JSON — print raw
  }
  process.stdout.write(raw + "\n");
}

// ── Subcommand implementations ─────────────────────────────────────────────────

async function cmdGate(args: string[]): Promise<void> {
  const pos = positional(args);
  const gateArg = pos.find((p) => /^G[1-5]$|^G-RCA$/i.test(p))?.toUpperCase();
  const pathArg = pos.find((p) => p !== gateArg) ?? ".";
  if (!gateArg) {
    process.stderr.write("Usage: spec-check gate <G1|G2|G3|G4|G5|G-RCA> [path]\n");
    process.exit(1);
  }
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("gate_check", { path: resolve(pathArg), gate: gateArg, llm: option(args, "--llm"), format: fmt }), fmt);
}

async function cmdRunAll(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("run_all", { path: resolve(pos[0] ?? "."), llm: option(args, "--llm"), format: fmt }), fmt);
}

async function cmdGuide(args: string[]): Promise<void> {
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("get_spec_guide", { format: fmt }), fmt);
}

async function cmdScaffold(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("scaffold_spec", { path: resolve(pos[0] ?? "."), source: option(args, "--source"), write: flag(args, "--write"), format: fmt }), fmt);
}

async function cmdMetrics(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("metrics", { path: resolve(pos[0] ?? "."), since: option(args, "--since"), format: fmt, llm: option(args, "--llm") }), fmt);
}

async function cmdRollup(args: string[]): Promise<void> {
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("get_rollup", { since: option(args, "--since"), format: fmt }), fmt);
}

async function cmdDiff(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("diff_check", { path: resolve(pos[0] ?? "."), base: option(args, "--base"), llm: option(args, "--llm"), format: fmt }), fmt);
}

async function cmdComplexity(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("complexity", { path: resolve(pos[0] ?? "."), llm: option(args, "--llm"), format: fmt }), fmt);
}

async function cmdReconcile(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("check_reconciliation", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

async function cmdEvidence(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("check_evidence", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

async function cmdAssumptions(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("check_assumptions", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

async function cmdListAssumptions(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("list_assumptions", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

async function cmdValidate(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("validate_artifact", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

async function cmdDependencies(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("check_dependencies", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

async function cmdMutation(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("check_mutation_score", { path: resolve(pos[0] ?? "."), llm: option(args, "--llm"), format: fmt }), fmt);
}

async function cmdCompileReqs(args: string[]): Promise<void> {
  const pos = positional(args);
  const fmt = option(args, "--format") ?? "text";
  printResponse(await executeToolRequest("compile_requirements", { path: resolve(pos[0] ?? "."), format: fmt }), fmt);
}

// ── query ──────────────────────────────────────────────────────────────────────

const QUERY_SCHEMA_HELP = `
spec-check query — DuckDB SQL interface to the metrics Parquet store
─────────────────────────────────────────────────────────────────────
Virtual table:  spec_records
  Use "FROM spec_records" in any query — it resolves to all stored
  check records across every project, gate, and check type.

Available columns (union_by_name — older records may omit some):

  Column            Type     Description
  ─────────────────────────────────────────────────────────────────
  schema_version    INTEGER  Record format version (1 or 2)
  check_type        VARCHAR  Type: gate | diff | reconciliation | evidence
  project_path      VARCHAR  Absolute path to the project root
  org               VARCHAR  Git remote org name
  repo              VARCHAR  Git remote repo name
  service           VARCHAR  Service name
  timestamp         VARCHAR  ISO 8601 timestamp of the check
  git_commit        VARCHAR  Short commit hash (8 chars)
  branch            VARCHAR  Git branch name
  llm_provider      VARCHAR  LLM provider (e.g. anthropic, openai)
  llm_model         VARCHAR  LLM model identifier
  llm_id            VARCHAR  Composite LLM ID
  agent_id          VARCHAR  Agent instance identifier
  agent_kind        VARCHAR  Agent role (planner, implementer, etc.)
  session_id        VARCHAR  Shared session identifier
  run_id            VARCHAR  Task or attempt identifier
  gate              VARCHAR  Gate name (G1–G5) — gate records only
  status            VARCHAR  Status: PASS | BLOCK | VIOLATION | PASS_WITH_WARNINGS
  gate_status       VARCHAR  Alias for status (v1 schema records)
  criteria          VARCHAR  JSON array of criteria results
  duration_ms       INTEGER  Check duration in milliseconds
  run_batch_id      VARCHAR  Batch identifier for run_all

  Diff records also include:
  base              VARCHAR  Base branch/commit diffed against
  files             VARCHAR  JSON array of changed files
  categories        VARCHAR  JSON object of file categories
  notes             VARCHAR  Additional notes

Example queries:
  # Gate pass rates across all projects
  spec-check query "SELECT gate, COUNT(*) AS runs, ROUND(100.0 * SUM(CASE WHEN status='PASS' THEN 1 ELSE 0 END) / COUNT(*), 1) AS pass_pct FROM spec_records WHERE check_type='gate' GROUP BY gate ORDER BY gate"

  # Recent failures in this project
  spec-check query --path . "SELECT timestamp, gate, status FROM spec_records WHERE check_type='gate' AND status != 'PASS' ORDER BY timestamp DESC LIMIT 20"

  # Model comparison
  spec-check query "SELECT llm_model, COUNT(*) AS checks, ROUND(100.0 * SUM(CASE WHEN status='PASS' THEN 1 ELSE 0 END) / COUNT(*), 1) AS pass_pct FROM spec_records WHERE check_type='gate' GROUP BY llm_model ORDER BY pass_pct DESC"

  # Records per day (last 30 days)
  spec-check query "SELECT CAST(timestamp AS DATE) AS day, COUNT(*) AS records FROM spec_records WHERE timestamp >= CURRENT_DATE - INTERVAL 30 DAYS GROUP BY day ORDER BY day"

Output formats:
  --format json     JSON array of objects (default, suitable for jq)
  --format table    ASCII grid (human-readable)
  --format csv      RFC-4180 CSV (suitable for spreadsheets / awk)

Related:
  spec-check stats [path]   Pre-canned storage analytics (no SQL needed)
`.trim();

async function cmdQuery(args: string[]): Promise<void> {
  if (flag(args, "--schema", "--help-schema", "--help")) {
    process.stdout.write(QUERY_SCHEMA_HELP + "\n");
    return;
  }

  const pos = positional(args);
  const sql = pos[0];

  if (!sql) {
    process.stderr.write(
      [
        "Usage: spec-check query \"<SQL>\"",
        "       spec-check query --schema",
        "",
        "Options:",
        "  --path <dir>      Scope query to a project's storage path",
        "  --format json     Output as JSON array (default)",
        "  --format table    Output as ASCII table",
        "  --schema          Show available columns and example queries",
        "",
        'Example: spec-check query "SELECT gate, COUNT(*) FROM spec_records GROUP BY gate"',
      ].join("\n") + "\n"
    );
    process.exit(1);
  }

  const fmt = option(args, "--format") ?? "json";
  const pathArg = option(args, "--path");

  const resp = await executeToolRequest("query", {
    sql,
    ...(pathArg ? { path: resolve(pathArg) } : {}),
    format: fmt,
  });

  // For query: always print the raw data (not the envelope) regardless of format
  const raw = resp.content.map((c) => c.text).join("\n");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ("data" in parsed) {
      const data = parsed.data;
      if (fmt === "table" && typeof data === "string") {
        process.stdout.write(data + "\n");
      } else if (fmt === "csv" && typeof data === "string") {
        process.stdout.write(data + "\n");
      } else {
        process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      }
      return;
    }
    // Error response — print as-is
    process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
  } catch {
    process.stdout.write(raw + "\n");
  }
}

// ── CLI-only: stats ────────────────────────────────────────────────────────────

async function cmdStats(args: string[]): Promise<void> {
  const pos = positional(args);
  const pathArg = pos[0] ? resolve(pos[0]) : undefined;
  const fmt = option(args, "--format") ?? "text";

  // Helper: run a query and extract rows
  async function q(sql: string): Promise<unknown[]> {
    const resp = await executeToolRequest("query", {
      sql,
      ...(pathArg ? { path: pathArg } : {}),
      format: "json",
    });
    const raw = resp.content.map((c) => c.text).join("\n");
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ("data" in parsed && Array.isArray(parsed.data)) return parsed.data;
      if ("error" in parsed) return [];
    } catch { /* fall through */ }
    return [];
  }

  const [summary, byType, byProject, recent] = await Promise.all([
    q("SELECT COUNT(*) AS total_records, MIN(timestamp) AS earliest, MAX(timestamp) AS latest FROM spec_records"),
    q("SELECT COALESCE(check_type, '(v1-no-type)') AS check_type, COUNT(*) AS records FROM spec_records GROUP BY check_type ORDER BY records DESC"),
    q("SELECT COALESCE(project_path, path, '(unknown)') AS project, COUNT(*) AS records FROM spec_records GROUP BY project ORDER BY records DESC LIMIT 10"),
    q("SELECT check_type, gate, status, timestamp FROM spec_records ORDER BY timestamp DESC LIMIT 5"),
  ]);

  if (fmt === "json") {
    process.stdout.write(JSON.stringify({ summary, by_check_type: byType, top_projects: byProject, recent_records: recent }, null, 2) + "\n");
    return;
  }

  // Text output
  const s = (summary as Array<Record<string, unknown>>)[0] ?? {};
  const lines: string[] = [
    "── Parquet metrics store statistics ───────────────────────────────────────",
    `  Total records : ${s.total_records ?? "0"}`,
    `  Earliest      : ${s.earliest ?? "(none)"}`,
    `  Latest        : ${s.latest ?? "(none)"}`,
    "",
    "── Records by check type ──────────────────────────────────────────────────",
    ...(byType as Array<Record<string, unknown>>).map(
      (row) => `  ${String(row.check_type ?? "").padEnd(20)} ${row.records}`
    ),
    "",
    "── Top projects (by record count) ─────────────────────────────────────────",
    ...(byProject as Array<Record<string, unknown>>).map(
      (row) => `  ${String(row.records ?? "").padStart(5)}  ${row.project}`
    ),
    "",
    "── Most recent records ─────────────────────────────────────────────────────",
    ...(recent as Array<Record<string, unknown>>).map(
      (row) => `  ${String(row.timestamp ?? "").slice(0, 19)}  ${String(row.check_type ?? "").padEnd(14)}  ${String(row.gate ?? "").padEnd(4)}  ${row.status}`
    ),
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

// ── CLI-only: watch ────────────────────────────────────────────────────────────

const SPEC_FILES = ["intent.md", "requirements.md", "design.md", "tasks.md"];
const DEBOUNCE_MS = 600;

async function cmdWatch(args: string[]): Promise<void> {
  const pos = positional(args);
  const pathArg = resolve(pos[0] ?? ".");
  const fmt = option(args, "--format") ?? "text";
  const llm = option(args, "--llm");

  if (!existsSync(pathArg)) {
    process.stderr.write(`[watch] Path not found: ${pathArg}\n`);
    process.exit(1);
  }

  process.stdout.write(`[watch] Watching spec files in ${pathArg}\n`);
  process.stdout.write(`[watch] Press Ctrl+C to stop.\n\n`);

  // Run once immediately on start
  async function runGates() {
    process.stdout.write(`[watch] Running gates…\n`);
    const resp = await executeToolRequest("run_all", { path: pathArg, llm, format: fmt });
    printResponse(resp, fmt);
  }

  await runGates();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watchPaths = SPEC_FILES
    .map((f) => join(pathArg, f))
    .filter(existsSync);

  if (watchPaths.length === 0) {
    process.stderr.write(`[watch] No spec files found in ${pathArg} — waiting for them to be created.\n`);
  }

  // Watch the directory so we catch new files too
  fsWatch(pathArg, { persistent: true, recursive: false }, (_event, filename) => {
    if (!filename) return;
    const isSpec = SPEC_FILES.some((sf) => filename === sf) || filename.endsWith(".md");
    if (!isSpec) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      process.stdout.write(`\n[watch] Change detected (${filename}), re-running gates…\n`);
      await runGates();
    }, DEBOUNCE_MS);
  });

  // Keep process alive
  process.stdin.resume();
}

// ── CLI-only: report ───────────────────────────────────────────────────────────

async function cmdReport(args: string[]): Promise<void> {
  const pos = positional(args);
  const pathArg = resolve(pos[0] ?? ".");
  const output = option(args, "--output", "-o");
  const fmt = option(args, "--format") ?? "text";
  const since = option(args, "--since");
  const llm = option(args, "--llm");

  const sections = await Promise.all([
    executeToolRequest("run_all", { path: pathArg, llm, format: "text" }),
    executeToolRequest("metrics", { path: pathArg, since, format: "text" }),
    executeToolRequest("check_reconciliation", { path: pathArg, format: "text" }),
    executeToolRequest("check_evidence", { path: pathArg, format: "text" }),
  ]);

  // Unwrap envelopes for each section
  const sections_text = sections.map((s) => {
    const raw = s.content.map((c) => c.text).join("\n");
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ("data" in parsed && typeof parsed.data === "string") return parsed.data;
    } catch { /* raw text */ }
    return raw;
  });

  const report = sections_text.join("\n\n" + "═".repeat(60) + "\n\n");

  if (output) {
    writeFileSync(output, report, "utf-8");
    process.stdout.write(`Report written to ${output}\n`);
  } else {
    process.stdout.write(report + "\n");
  }
}

// ── Help ───────────────────────────────────────────────────────────────────────

function printHelp(): void {
  const toolCount = TOOL_DEFINITIONS.length;
  process.stdout.write(
    [
      `spec-check v${SERVER_VERSION}  (${toolCount} MCP tools)`,
      "",
      "Usage:",
      "  spec-check                            Start MCP server (stdio transport)",
      "  spec-check server [path]              Start local dashboard + HTTP API",
      "  spec-check <command> [path] [flags]   Run a check directly from the terminal",
      "",
      "Spec workflow commands:",
      "  guide                                 Show spec-writing rules & examples",
      "  scaffold [path] [--write]             Generate spec templates  [--source <doc>]",
      "  gate <G1|G2|G3|G4|G5> [path]         Run a single gate check",
      "  run-all [path]                        Run all gates in sequence (stops at first BLOCK)",
      "",
      "Quality checks:",
      "  diff [path] [--base <commit>]         Spec drift vs code",
      "  complexity [path]                     Code complexity (CC, cognitive, length)",
      "  mutation [path]                       Mutation testing score",
      "  reconcile [path]                      README / task claim reconciliation",
      "  evidence [path]                       Release & benchmark evidence check",
      "  dependencies [path]                   Dependency audit",
      "  validate [path]                       Artifact validation",
      "  compile [path]                        Compile requirements (Gherkin linting)",
      "",
      "Metrics:",
      "  metrics [path] [--since <date>]       Project quality metrics over time",
      "  rollup [--since <date>]               Cross-project rollup",
      "",
      "Assumptions:",
      "  assumptions [path]                    Check assumptions for drift",
      "  list-assumptions [path]               List all tracked assumptions",
      "",
      "CLI-only commands:",
      "  watch [path]                          Watch spec files, re-run gates on change",
      "  report [path] [--output <file>]       Full project report (gates + metrics + checks)",
      "  query \"<SQL>\" [--path <dir>]          Run DuckDB SQL against the Parquet metrics store",
      "  query --schema                        Show available columns and example queries",
      "  stats [path]                          Quick storage statistics (records, types, projects)",
      "",
      "Setup:",
      "  init --tool <name>                    Configure a named LLM tool",
      "  init --all                            Configure all detected LLM tools",
      "    --force                             Overwrite existing config files",
      "    --install                           Install missing dependencies",
      "    --path <dir>                        Project root (default: .)",
      "    Tools: claude, cursor, gemini, codex, ollama",
      "",
      "Global flags (most commands):",
      "  --format text|json|mermaid            Output format (default: text)",
      "  --format json|table|csv               Query output format (default: json)",
      "  --llm <model>                         LLM model identifier (e.g. claude-sonnet-4-5)",
      "  --since <ISO-date>                    Filter since date (metrics/rollup)",
      "",
    ].join("\n") + "\n"
  );
}

// ── Routing helpers (exported for tests) ──────────────────────────────────────

export type CliMode = "mcp" | "server" | "command";

export interface CliRoute {
  mode: "mcp" | "server";
  rest: string[];
}

/**
 * Determine whether argv routes to the MCP server (default), the dashboard/HTTP server,
 * or a direct CLI command.  Only "mcp" and "server" modes are returned; all other
 * subcommands stay within the "command" routing handled by `main()`.
 */
export function resolveCliCommand(argv: string[]): CliRoute {
  const sub = argv[0] ?? "";
  if (sub === "server" || sub === "dashboard") {
    return { mode: "server", rest: argv.slice(1) };
  }
  if (sub === "") {
    return { mode: "mcp", rest: [] };
  }
  // Any other subcommand: treated as "mcp" fallback for external callers that only
  // need to distinguish MCP vs server — the full router in main() handles the rest.
  return { mode: "mcp", rest: argv };
}

// ── Router ─────────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  "run-all": "run-all",
  "runall": "run-all",
  "g1": "gate-G1",
  "g2": "gate-G2",
  "g3": "gate-G3",
  "g4": "gate-G4",
  "g5": "gate-G5",
  "reconciliation": "reconcile",
  "recon": "reconcile",
  "ev": "evidence",
  "deps": "dependencies",
  "dep": "dependencies",
  "mut": "mutation",
  "compile-requirements": "compile",
  "compile_requirements": "compile",
  "list_assumptions": "list-assumptions",
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const rawSub = argv[0] ?? "";
  const args = argv.slice(1);
  const sub = ALIASES[rawSub.toLowerCase()] ?? rawSub;

  // Handle shorthand  gate-G1..gate-G5 from aliases
  if (/^gate-G[1-5]$/i.test(sub)) {
    const gate = sub.split("-")[1]!.toUpperCase();
    return cmdGate([gate, ...args]);
  }

  switch (sub) {
    case "":
      return startMcpServer();

    case "server":
    case "dashboard":
      return startDashboardServer(args);

    case "init":
      return (async () => {
        const opts = parseInitArgs(args);
        const result = await runInit({ ...opts, write: true } as Parameters<typeof runInit>[0]);
        process.stdout.write(initResultToText(result) + "\n");
        if (result.error) process.exit(1);
      })();

    case "gate":
      return cmdGate(args);

    case "run-all":
      return cmdRunAll(args);

    case "guide":
    case "get-guide":
    case "spec-guide":
      return cmdGuide(args);

    case "scaffold":
    case "scaffold-spec":
      return cmdScaffold(args);

    case "metrics":
      return cmdMetrics(args);

    case "rollup":
    case "get-rollup":
      return cmdRollup(args);

    case "diff":
    case "diff-check":
      return cmdDiff(args);

    case "complexity":
      return cmdComplexity(args);

    case "reconcile":
      return cmdReconcile(args);

    case "evidence":
      return cmdEvidence(args);

    case "assumptions":
    case "check-assumptions":
      return cmdAssumptions(args);

    case "list-assumptions":
      return cmdListAssumptions(args);

    case "validate":
    case "validate-artifact":
      return cmdValidate(args);

    case "dependencies":
    case "check-dependencies":
      return cmdDependencies(args);

    case "mutation":
    case "check-mutation":
      return cmdMutation(args);

    case "compile":
      return cmdCompileReqs(args);

    case "watch":
      return cmdWatch(args);

    case "report":
      return cmdReport(args);

    case "query":
    case "sql":
      return cmdQuery(args);

    case "stats":
    case "storage-stats":
      return cmdStats(args);

    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;

    case "version":
    case "--version":
    case "-V":
      process.stdout.write(`${SERVER_VERSION}\n`);
      return;

    default:
      process.stderr.write(`Unknown subcommand: "${sub}"\nRun "spec-check help" for usage.\n`);
      process.exit(1);
  }
}

function parseInitArgs(args: string[]): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--all") { opts["all"] = true; continue; }
    if (arg === "--install") { opts["install"] = true; continue; }
    if (arg === "--force") { opts["force"] = true; continue; }
    if (arg === "--tool" && args[i + 1]) { opts["tool"] = args[++i]; continue; }
    if (arg === "--path" && args[i + 1]) { opts["path"] = args[++i]; continue; }
  }
  return opts;
}

main().catch((error) => {
  process.stderr.write(`[spec-check] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
