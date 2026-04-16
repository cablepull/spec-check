#!/usr/bin/env node
import { startMcpServer } from "./index.js";
import { startDashboardServer } from "./dashboard.js";

export function resolveCliCommand(argv: string[]): { mode: "mcp" | "server" | "help" | "unknown"; rest: string[] } {
  const [subcommand, ...rest] = argv;
  if (!subcommand) return { mode: "mcp", rest: [] };
  if (subcommand === "server" || subcommand === "dashboard") return { mode: "server", rest };
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") return { mode: "help", rest: [] };
  return { mode: "unknown", rest };
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

  if (mode === "help") {
    process.stdout.write(
      [
        "spec-check",
        "",
        "Usage:",
        "  spec-check                 Start MCP server over stdio",
        "  spec-check server [path]   Start local dashboard + HTTP API daemon",
        "  spec-check dashboard [path]",
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
