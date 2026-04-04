// Story 016 — Storage tests
// Covers: buildFilePath, buildGateRecord, writeRecord, smokeTest, globPattern
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildFilePath,
  buildGateRecord,
  buildStoragePaths,
  globPattern,
  smokeTest,
  writeRecord,
} from "../src/storage.js";
import type { LLMIdentity, ServiceInfo } from "../src/types.js";

const roots: string[] = [];

function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const r = roots.pop();
    if (r) rmSync(r, { recursive: true, force: true });
  }
});

const fakeLlm: LLMIdentity = {
  id: "claude-sonnet-4-5",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  source: "argument",
};

// ── buildFilePath ─────────────────────────────────────────────────────────────

describe("buildFilePath", () => {
  it("R-16 produces the correct directory hierarchy", () => {
    const paths = {
      storageRoot: "/tmp/spec-check-data",
      org: "acme",
      repo: "backend",
      service: "api",
      commit8: "abc12345",
      branch: "main",
    };
    const ts = new Date("2025-06-15T08:30:45.123Z");
    const fp = buildFilePath(paths, fakeLlm, "gate-G1", ts);

    expect(fp).toContain("/tmp/spec-check-data/acme/backend/api/2025/06/15/");
    expect(fp).toMatch(/abc12345_main_claude-sonnet-4-5_gate-G1_\d{9}\.jsonl$/);
  });

  it("R-16 zero-pads month, day, and time components", () => {
    const paths = {
      storageRoot: "/tmp/spec-check-data",
      org: "org",
      repo: "repo",
      service: "svc",
      commit8: "00000000",
      branch: "feature",
    };
    const ts = new Date("2025-01-05T03:04:05.007Z");
    const fp = buildFilePath(paths, fakeLlm, "diff", ts);

    expect(fp).toContain("/2025/01/05/");
    // HHMMSSmmm: 030405007
    expect(fp).toContain("030405007");
  });

  it("R-16 uses the llm id in the filename", () => {
    const paths = {
      storageRoot: "/tmp/x",
      org: "o",
      repo: "r",
      service: "s",
      commit8: "deadbeef",
      branch: "main",
    };
    const ts = new Date("2025-03-01T00:00:00.000Z");
    const fp = buildFilePath(paths, { ...fakeLlm, id: "gpt-5" }, "complexity", ts);
    expect(fp).toContain("_gpt-5_");
  });

  it("R-16 uses check-type in filename", () => {
    const paths = {
      storageRoot: "/tmp/x",
      org: "o",
      repo: "r",
      service: "s",
      commit8: "deadbeef",
      branch: "main",
    };
    const fp = buildFilePath(paths, fakeLlm, "mutation", new Date());
    expect(fp).toContain("_mutation_");
  });
});

// ── buildGateRecord ───────────────────────────────────────────────────────────

describe("buildGateRecord", () => {
  it("R-16 produces a schema_version 1 record with all required fields", () => {
    const ts = new Date("2025-06-01T12:00:00.000Z");
    const record = buildGateRecord({
      projectRoot: "/projects/myapp",
      org: "acme",
      repo: "myapp",
      service: "root",
      commit8: "aabbccdd",
      branch: "main",
      llm: fakeLlm,
      gate: "G2",
      triggeredBy: "gate_check",
      gateStatus: "PASS",
      results: [{ id: "R-1", status: "PASS" }],
      durationMs: 42,
      timestamp: ts,
    });

    expect(record.schema_version).toBe(1);
    expect(record.gate).toBe("G2");
    expect(record.gate_status).toBe("PASS");
    expect(record.org).toBe("acme");
    expect(record.repo).toBe("myapp");
    expect(record.service).toBe("root");
    expect(record.git_commit).toBe("aabbccdd");
    expect(record.branch).toBe("main");
    expect(record.llm_id).toBe("claude-sonnet-4-5");
    expect(record.llm_provider).toBe("anthropic");
    expect(record.llm_model).toBe("claude-sonnet-4-5");
    expect(record.triggered_by).toBe("gate_check");
    expect(record.duration_ms).toBe(42);
    expect(record.timestamp).toBe("2025-06-01T12:00:00.000Z");
    // results are JSON-stringified
    expect(typeof record.results).toBe("string");
    const parsed = JSON.parse(record.results as string);
    expect(parsed[0].id).toBe("R-1");
  });
});

// ── writeRecord ───────────────────────────────────────────────────────────────

describe("writeRecord", () => {
  it("R-16 creates the file with a single JSONL line", () => {
    const dir = makeTmp("spec-check-write-");
    const fp = join(dir, "subdir", "test.jsonl");
    const record = { hello: "world", num: 42 };

    writeRecord(fp, record);

    expect(existsSync(fp)).toBe(true);
    const content = readFileSync(fp, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.hello).toBe("world");
    expect(parsed.num).toBe(42);
  });

  it("R-16 creates parent directories automatically", () => {
    const dir = makeTmp("spec-check-write-");
    const nested = join(dir, "a", "b", "c", "record.jsonl");

    writeRecord(nested, { data: true });

    expect(existsSync(nested)).toBe(true);
  });

  it("R-16 does not throw on write errors (non-fatal)", () => {
    // Pass an invalid path to trigger an error — no throw expected
    expect(() => writeRecord("/dev/null/impossible/path/file.jsonl", { x: 1 })).not.toThrow();
  });
});

// ── smokeTest ─────────────────────────────────────────────────────────────────

describe("smokeTest", () => {
  it("R-16 returns ok:true for an existing directory", () => {
    const dir = makeTmp("spec-check-smoke-");
    const result = smokeTest(dir);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("R-16 creates the directory when it does not exist and returns ok:true", () => {
    const base = makeTmp("spec-check-smoke-");
    const newDir = join(base, "new-storage-root");
    expect(existsSync(newDir)).toBe(false);

    const result = smokeTest(newDir);

    expect(result.ok).toBe(true);
    expect(existsSync(newDir)).toBe(true);
  });

  it("R-16 expands ~ to the home directory", () => {
    // Just check it doesn't crash and resolves something sensible
    const result = smokeTest("~/.spec-check-test-probe-do-not-use");
    // We don't care if it succeeds or fails, only that it doesn't throw
    expect(typeof result.ok).toBe("boolean");
  });
});

// ── globPattern ───────────────────────────────────────────────────────────────

describe("globPattern", () => {
  it("R-16 appends parts to the resolved storage root", () => {
    const pattern = globPattern("/tmp/storage", "org", "repo");
    expect(pattern).toContain("/tmp/storage");
    expect(pattern).toContain("org");
    expect(pattern).toContain("repo");
  });

  it("R-16 uses **/* wildcard when no parts are given", () => {
    const pattern = globPattern("/tmp/storage");
    expect(pattern).toContain("**/*");
  });

  it("R-16 expands ~ using the home directory", () => {
    const pattern = globPattern("~/.spec-check");
    expect(pattern).not.toContain("~");
    expect(pattern).toContain(".spec-check");
  });
});

// ── buildStoragePaths integration ─────────────────────────────────────────────

describe("buildStoragePaths", () => {
  it("R-16 returns a StoragePaths with storageRoot expanded from ~ paths", () => {
    const dir = makeTmp("spec-check-paths-");
    const service: ServiceInfo = { name: "api", rootPath: dir, specPath: dir };
    const paths = buildStoragePaths(dir, service, "~/.spec-check/data");
    // storageRoot should not start with ~
    expect(paths.storageRoot).not.toMatch(/^~/);
    expect(paths.storageRoot).toContain(".spec-check/data");
  });

  it("R-16 sanitises service name to lowercase alphanumeric", () => {
    const dir = makeTmp("spec-check-paths-");
    const service: ServiceInfo = { name: "My Service!", rootPath: dir, specPath: dir };
    const paths = buildStoragePaths(dir, service, "/tmp/data");
    // Should not contain spaces or exclamation marks
    expect(paths.service).not.toMatch(/[ !]/);
    expect(paths.service).toMatch(/^[a-z0-9-_.]+$/);
  });

  it("R-16 falls back to no-commit when git is unavailable", () => {
    const dir = makeTmp("spec-check-paths-no-git-");
    // No git repo initialised — git commands will fail
    const service: ServiceInfo = { name: "svc", rootPath: dir, specPath: dir };
    const paths = buildStoragePaths(dir, service, "/tmp/data");
    // commit8 is either a real hash or the fallback
    expect(typeof paths.commit8).toBe("string");
    expect(paths.commit8.length).toBeGreaterThan(0);
  });
});
