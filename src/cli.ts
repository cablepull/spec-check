#!/usr/bin/env node
import { startMcpServer } from "./index.js";
import { startDashboardServer } from "./dashboard.js";
import { runInit, initResultToText } from "./init.js";

export function resolveCliCommand(argv: string[]): { mode: "mcp" | "server" | "init" | "help" | "version" | "unknown"; rest: string[] } {
  const [subcommand, ...rest] = argv;
  if (!subcommand) return { mode: "mcp", rest: [] };
  if (subcommand === "server" || subcommand === "dashboard") return { mode: "server", rest };
  if (subcommand === "init") return { mode: "init", rest };
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") return { mode: "help", rest: [] };
  if (subcommand === "--version" || subcommand === "-V" || subcommand === "version") return { mode: "version", rest: [] };
  return { mode: "unknown", rest };
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

async function main() {
  const { mode, rest } = resolveCliCommand(process.argv.slice(2));

  if (mode === "mcp") {
    await startMcpServer();
    return;
  }

  if (mode === "server") {
    await startDashboardServer(rest);
    return;
  }

  if (mode === "init") {
    const opts = parseInitArgs(rest);
    const result = await runInit({ ...opts, write: true } as Parameters<typeof runInit>[0]);
    process.stdout.write(initResultToText(result) + "\n");
    if (result.error) process.exit(1);
    return;
  }

  if (mode === "version") {
    process.stdout.write("0.1.0\n");
    return;
  }

  if (mode === "help") {
    process.stdout.write(
      [
        "spec-check",
        "",
        "Usage:",
        "  spec-check                            Start MCP server over stdio",
        "  spec-check server [path]              Start local dashboard + HTTP API daemon",
        "  spec-check dashboard [path]",
        "  spec-check init --tool <name>         Configure a named LLM tool",
        "  spec-check init --all                 Configure all detected LLM tools",
        "    --force                             Overwrite existing config files",
        "    --install                           Install missing dependencies",
        "    --path <dir>                        Project root (default: .)",
        "    Tools: claude, cursor, gemini, codex, ollama",
      ].join("\n") + "\n"
    );
    return;
  }

  const [subcommand] = process.argv.slice(2);
  process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`[spec-check] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
