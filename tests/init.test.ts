import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  ADAPTER_REGISTRY,
  runInit,
  type InitOptions,
  type InitResult,
} from "../src/init.js";

const roots: string[] = [];

function makeTmp(prefix = "spec-check-init-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

// ── R-69: named tool writes its files ────────────────────────────────────────

describe("R-69 claude adapter", () => {
  it("writes CLAUDE.md to project root", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "claude", path: project, write: true });
    const claudeMd = join(project, "CLAUDE.md");
    expect(result.written.some((f) => f.endsWith("CLAUDE.md"))).toBe(true);
    expect(existsSync(claudeMd)).toBe(true);
    expect(readFileSync(claudeMd, "utf8")).toContain("spec-check");
  });

  it("includes MCP server entry in result metadata", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "claude", path: project, write: true });
    expect(result.mcp_entries.length).toBeGreaterThan(0);
    expect(result.mcp_entries[0]).toHaveProperty("name", "spec-check");
  });

  it("lists each file written with its absolute path", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "claude", path: project, write: true });
    expect(result.written.every((p) => p.startsWith("/"))).toBe(true);
  });
});

describe("R-69 unknown tool is rejected", () => {
  it("returns a structured error and writes nothing", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "nonexistent_llm", path: project, write: true });
    expect(result.error).toMatch(/unknown tool/i);
    expect(result.written).toHaveLength(0);
  });
});

// ── R-70: each adapter operates in isolation ─────────────────────────────────

describe("R-70 cursor adapter", () => {
  it("writes .cursor/rules/spec-check.mdc", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "cursor", path: project, write: true });
    const mdcPath = join(project, ".cursor", "rules", "spec-check.mdc");
    expect(existsSync(mdcPath)).toBe(true);
    expect(result.written.some((f) => f.includes(".cursor"))).toBe(true);
  });

  it("does not write claude or gemini files", async () => {
    const project = makeTmp();
    await runInit({ tool: "cursor", path: project, write: true });
    expect(existsSync(join(project, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(project, ".gemini"))).toBe(false);
  });
});

describe("R-70 gemini adapter", () => {
  it("writes .gemini/GEMINI.md", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "gemini", path: project, write: true });
    const geminiPath = join(project, ".gemini", "GEMINI.md");
    expect(existsSync(geminiPath)).toBe(true);
    expect(result.written.some((f) => f.includes(".gemini"))).toBe(true);
  });
});

describe("R-70 codex adapter", () => {
  it("writes codex.md to project root", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "codex", path: project, write: true });
    expect(existsSync(join(project, "codex.md"))).toBe(true);
    expect(result.written.some((f) => f.endsWith("codex.md"))).toBe(true);
  });
});

describe("R-70 ollama adapter", () => {
  it("writes .ollama/spec-check.md", async () => {
    const project = makeTmp();
    const result = await runInit({ tool: "ollama", path: project, write: true });
    const ollamaPath = join(project, ".ollama", "spec-check.md");
    expect(existsSync(ollamaPath)).toBe(true);
    expect(result.written.some((f) => f.includes(".ollama"))).toBe(true);
  });
});

describe("R-70 skip-on-exists without --force", () => {
  it("does not overwrite an existing file", async () => {
    const project = makeTmp();
    const mdcPath = join(project, ".cursor", "rules", "spec-check.mdc");
    // pre-create the file
    const { mkdirSync } = await import("fs");
    mkdirSync(join(project, ".cursor", "rules"), { recursive: true });
    writeFileSync(mdcPath, "existing content", "utf8");

    const result = await runInit({ tool: "cursor", path: project, write: true });
    expect(readFileSync(mdcPath, "utf8")).toBe("existing content");
    expect(result.skipped.some((f) => f.includes(".cursor"))).toBe(true);
  });

  it("overwrites when --force is set", async () => {
    const project = makeTmp();
    const { mkdirSync } = await import("fs");
    const mdcPath = join(project, ".cursor", "rules", "spec-check.mdc");
    mkdirSync(join(project, ".cursor", "rules"), { recursive: true });
    writeFileSync(mdcPath, "old content", "utf8");

    await runInit({ tool: "cursor", path: project, write: true, force: true });
    expect(readFileSync(mdcPath, "utf8")).not.toBe("old content");
  });
});

describe("R-70 --all flag", () => {
  it("runs all adapters whose detect() returns true", async () => {
    const project = makeTmp();
    const result = await runInit({ all: true, path: project, write: true });
    // At least one adapter should always write (cursor detect is always true in test mode)
    expect(result.written.length + result.skipped.length).toBeGreaterThan(0);
    expect(result.adapters_run.length).toBeGreaterThan(0);
  });
});

// ── R-71: --install flag ──────────────────────────────────────────────────────

describe("R-71 --install without tool is rejected", () => {
  it("returns structured error when no tool specified", async () => {
    const project = makeTmp();
    const result = await runInit({ install: true, path: project, write: false });
    expect(result.error).toMatch(/tool.*required|required.*tool/i);
  });
});

// ── R-72: Homebrew formula structure ─────────────────────────────────────────

describe("R-72 homebrew formula", () => {
  const formulaPath = resolve(__dirname, "../Formula/spec-check.rb");

  it("formula file exists in Formula/spec-check.rb", () => {
    expect(existsSync(formulaPath)).toBe(true);
  });

  it("formula declares node as a dependency", () => {
    const content = readFileSync(formulaPath, "utf8");
    expect(content).toMatch(/depends_on\s+["']node["']/);
  });

  it("formula references the spec-check package by name", () => {
    const content = readFileSync(formulaPath, "utf8");
    expect(content).toContain("spec-check");
  });

  it("formula specifies a url and sha256 for the release archive", () => {
    const content = readFileSync(formulaPath, "utf8");
    expect(content).toMatch(/^\s*url\s+/m);
    expect(content).toMatch(/^\s*sha256\s+/m);
  });
});

// ── R-73: Formula CLI entrypoint and caveats ──────────────────────────────────

describe("R-73 formula CLI entrypoint", () => {
  const formulaPath = resolve(__dirname, "../Formula/spec-check.rb");

  it("formula writes a shell shim that puts spec-check on PATH", () => {
    const content = readFileSync(formulaPath, "utf8");
    // shim should reference the bin directory and invoke dist/cli.js
    expect(content).toMatch(/bin\//);
    expect(content).toMatch(/dist\/cli\.js/);
  });

  it("formula includes a caveats block referencing spec-check init", () => {
    const content = readFileSync(formulaPath, "utf8");
    expect(content).toMatch(/def caveats/);
    expect(content).toContain("spec-check init");
  });

  it("formula caveats mention MCP configuration", () => {
    const content = readFileSync(formulaPath, "utf8");
    expect(content.toLowerCase()).toMatch(/mcp/);
  });

  it("formula includes a test block that validates the binary", () => {
    const content = readFileSync(formulaPath, "utf8");
    expect(content).toMatch(/do\s+test\b|test\s+do/);
    expect(content).toMatch(/spec-check/);
  });
});

// ── Adapter registry is modular ───────────────────────────────────────────────

describe("adapter registry", () => {
  it("contains all five required adapters", () => {
    const ids = Object.keys(ADAPTER_REGISTRY);
    expect(ids).toContain("claude");
    expect(ids).toContain("cursor");
    expect(ids).toContain("gemini");
    expect(ids).toContain("codex");
    expect(ids).toContain("ollama");
  });

  it("each adapter exposes id, name, detect, files, install", () => {
    for (const adapter of Object.values(ADAPTER_REGISTRY)) {
      expect(typeof adapter.id).toBe("string");
      expect(typeof adapter.name).toBe("string");
      expect(typeof adapter.detect).toBe("function");
      expect(typeof adapter.files).toBe("function");
      expect(typeof adapter.install).toBe("function");
    }
  });
});
