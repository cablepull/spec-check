// spec-check — Story 035: Init Script and Onboarding
// Modular adapter-based initialization for LLM-driven tools.
// Each tool adapter implements ToolAdapter; the registry drives all orchestration.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdapterFile {
  /** Absolute path where the file should be written */
  path: string;
  /** Content to write */
  content: string;
}

export interface McpEntry {
  name: string;
  command: string;
  args?: string[];
}

export interface ToolAdapter {
  id: string;
  name: string;
  /** Returns true if the tool binary is detectable on this system */
  detect(): boolean;
  /** Returns the list of files this adapter owns for the given project path */
  files(projectPath: string): AdapterFile[];
  /** Returns the MCP server entry for this adapter, if applicable */
  mcpEntry?(): McpEntry;
  /** Returns shell commands to install missing dependencies, keyed by dep name */
  install(): Record<string, string>;
}

export interface InitOptions {
  tool?: string;
  all?: boolean;
  install?: boolean;
  force?: boolean;
  write?: boolean;
  path?: string;
}

export interface InitResult {
  written: string[];
  skipped: string[];
  adapters_run: string[];
  mcp_entries: McpEntry[];
  install_results: Record<string, "ok" | "failed" | "skipped">;
  error?: string;
  notes: string[];
}

// ── Shared content builders ───────────────────────────────────────────────────

const SPEC_CHECK_VERSION = "0.1.0";

function specCheckWorkflowInstructions(tool: string): string {
  return `# spec-check Integration (${tool})

spec-check enforces a spec-driven development workflow through five sequential gates.

## Quick Start

\`\`\`
spec-check init --tool ${tool} --path .
spec-check gate_check G1 --path .
spec-check run_all --path .
\`\`\`

## Gate Sequence

| Gate | Check | Blocks on |
|------|-------|-----------|
| G1 | Stories valid | Missing intent, causal language, constraints |
| G2 | PRD valid | Feature/Rule/Example structure, negative examples |
| G3 | ADR valid | Missing sections, stale traceability |
| G4 | Tasks valid | Compound tasks, missing rule references |
| G5 | Executability | No test files, failing tests |

## MCP Tools Available

- \`run_all\` — run all gates and get next steps
- \`gate_check\` — check a single gate
- \`validate_artifact\` — validate a story, ADR, or RCA file
- \`diff_check\` — check if code changes trace to a story
- \`complexity\` — cyclomatic complexity analysis
- \`metrics\` — project compliance score over time

## Rules

- Always start with a story in \`stories/\` before writing code
- Every spec file must pass its gate before proceeding to the next
- Run \`run_all\` after every substantive change

spec-check v${SPEC_CHECK_VERSION}
`;
}

// ── Adapters ──────────────────────────────────────────────────────────────────

function probeBinary(name: string): boolean {
  const result = spawnSync(name, ["--version"], { encoding: "utf-8", timeout: 2000 });
  return result.status === 0;
}

const claudeAdapter: ToolAdapter = {
  id: "claude",
  name: "Claude (Anthropic)",

  detect(): boolean {
    return probeBinary("claude");
  },

  files(projectPath: string): AdapterFile[] {
    return [
      {
        path: join(projectPath, "CLAUDE.md"),
        content: specCheckWorkflowInstructions("claude"),
      },
    ];
  },

  mcpEntry(): McpEntry {
    return {
      name: "spec-check",
      command: "spec-check",
      args: [],
    };
  },

  install(): Record<string, string> {
    return {
      "spec-check": "npm install -g spec-check",
    };
  },
};

const cursorAdapter: ToolAdapter = {
  id: "cursor",
  name: "Cursor",

  detect(): boolean {
    return probeBinary("cursor");
  },

  files(projectPath: string): AdapterFile[] {
    const content = `---
description: spec-check workflow enforcement for Cursor
globs: ["**/*.md", "stories/**", "prd/**", "adr/**", "tasks.md"]
alwaysApply: true
---

${specCheckWorkflowInstructions("cursor")}

## Cursor-Specific Rules

- Before writing any code, verify a story exists in \`stories/\` for the feature
- After every file change, call \`run_all\` via the spec-check MCP tool
- Use \`validate_artifact\` to check story and ADR quality before proceeding
- Use \`diff_check\` to confirm your code changes trace to a story or RCA
`;
    return [
      {
        path: join(projectPath, ".cursor", "rules", "spec-check.mdc"),
        content,
      },
    ];
  },

  install(): Record<string, string> {
    return {};
  },
};

const geminiAdapter: ToolAdapter = {
  id: "gemini",
  name: "Gemini CLI",

  detect(): boolean {
    return probeBinary("gemini");
  },

  files(projectPath: string): AdapterFile[] {
    return [
      {
        path: join(projectPath, ".gemini", "GEMINI.md"),
        content: specCheckWorkflowInstructions("gemini"),
      },
    ];
  },

  install(): Record<string, string> {
    return {
      "spec-check": "npm install -g spec-check",
    };
  },
};

const codexAdapter: ToolAdapter = {
  id: "codex",
  name: "OpenAI Codex CLI",

  detect(): boolean {
    return probeBinary("codex");
  },

  files(projectPath: string): AdapterFile[] {
    return [
      {
        path: join(projectPath, "codex.md"),
        content: specCheckWorkflowInstructions("codex"),
      },
    ];
  },

  install(): Record<string, string> {
    return {
      "spec-check": "npm install -g spec-check",
    };
  },
};

const ollamaAdapter: ToolAdapter = {
  id: "ollama",
  name: "Ollama",

  detect(): boolean {
    return probeBinary("ollama");
  },

  files(projectPath: string): AdapterFile[] {
    return [
      {
        path: join(projectPath, ".ollama", "spec-check.md"),
        content: specCheckWorkflowInstructions("ollama"),
      },
    ];
  },

  install(): Record<string, string> {
    return {};
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const ADAPTER_REGISTRY: Record<string, ToolAdapter> = {
  claude: claudeAdapter,
  cursor: cursorAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  ollama: ollamaAdapter,
};

// ── Orchestration ─────────────────────────────────────────────────────────────

function writeAdapterFiles(
  adapter: ToolAdapter,
  projectPath: string,
  force: boolean,
  result: InitResult,
  dryRun: boolean
): void {
  for (const file of adapter.files(projectPath)) {
    if (!force && existsSync(file.path)) {
      result.skipped.push(file.path);
      result.notes.push(`Skipped ${file.path} (already exists — use --force to overwrite)`);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content, "utf8");
    }
    result.written.push(file.path);
  }
}

function runAdapterInstall(
  adapter: ToolAdapter,
  result: InitResult
): void {
  const deps = adapter.install();
  for (const [dep, cmd] of Object.entries(deps)) {
    const probe = spawnSync(dep, ["--version"], { encoding: "utf-8", timeout: 2000 });
    if (probe.status === 0) {
      result.install_results[dep] = "skipped";
      continue;
    }
    const parts = cmd.split(" ");
    const run = spawnSync(parts[0]!, parts.slice(1), { encoding: "utf-8", timeout: 120_000 });
    result.install_results[dep] = run.status === 0 ? "ok" : "failed";
    if (run.status !== 0) {
      result.notes.push(`Install failed for ${dep}: ${(run.stderr || run.stdout || "").trim()}`);
    }
  }
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const result: InitResult = {
    written: [],
    skipped: [],
    adapters_run: [],
    mcp_entries: [],
    install_results: {},
    notes: [],
  };

  const projectPath = resolve(options.path ?? ".");
  const force = options.force ?? false;
  const dryRun = !(options.write ?? true);

  // --install requires --tool or --all
  if (options.install && !options.tool && !options.all) {
    result.error = "A tool is required: use --tool <name> or --all with --install.";
    return result;
  }

  // Resolve which adapters to run
  let adapters: ToolAdapter[];

  if (options.all) {
    adapters = Object.values(ADAPTER_REGISTRY).filter((a) => {
      const detected = a.detect();
      if (!detected) result.notes.push(`Skipped ${a.name}: binary not detected on system path`);
      return detected;
    });
  } else if (options.tool) {
    const adapter = ADAPTER_REGISTRY[options.tool];
    if (!adapter) {
      result.error = `Unknown tool: "${options.tool}". Available: ${Object.keys(ADAPTER_REGISTRY).join(", ")}.`;
      return result;
    }
    adapters = [adapter];
  } else {
    result.error = "Specify --tool <name> or --all.";
    return result;
  }

  for (const adapter of adapters) {
    result.adapters_run.push(adapter.id);
    writeAdapterFiles(adapter, projectPath, force, result, dryRun);

    if (adapter.mcpEntry) {
      result.mcp_entries.push(adapter.mcpEntry());
    }

    if (options.install) {
      runAdapterInstall(adapter, result);
    }
  }

  if (result.written.length > 0) {
    result.notes.push(`\nRun: spec-check run_all --path ${projectPath}`);
  }

  return result;
}

// ── CLI text formatter ────────────────────────────────────────────────────────

export function initResultToText(result: InitResult): string {
  const lines: string[] = ["spec-check init", "═".repeat(60)];

  if (result.error) {
    lines.push(`\n❌ Error: ${result.error}`);
    return lines.join("\n");
  }

  if (result.written.length > 0) {
    lines.push("\n✅ Written:");
    for (const f of result.written) lines.push(`   ${f}`);
  }

  if (result.skipped.length > 0) {
    lines.push("\n⚠️  Skipped (already exist):");
    for (const f of result.skipped) lines.push(`   ${f}`);
  }

  if (Object.keys(result.install_results).length > 0) {
    lines.push("\n📦 Install results:");
    for (const [dep, status] of Object.entries(result.install_results)) {
      const icon = status === "ok" ? "✅" : status === "skipped" ? "·" : "❌";
      lines.push(`   ${icon} ${dep}: ${status}`);
    }
  }

  if (result.mcp_entries.length > 0) {
    lines.push("\n🔌 MCP server entries (add to your tool's MCP config):");
    for (const entry of result.mcp_entries) {
      lines.push(`   ${entry.name}: ${entry.command}${entry.args?.length ? " " + entry.args.join(" ") : ""}`);
    }
  }

  if (result.notes.length > 0) {
    lines.push("");
    for (const note of result.notes) lines.push(note);
  }

  return lines.join("\n");
}
