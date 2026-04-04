// Story 017/018/019 — Metrics tests
// Covers: getProjectMetrics, getRollupMetrics, formatProjectMetrics
// Approach: write fixture JSONL files into a temp storage dir so metrics
//           can be read back without requiring a real git commit or DuckDB.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getProjectMetrics, getRollupMetrics, formatProjectMetrics } from "../src/metrics.js";
import { loadConfig } from "../src/config.js";
import type { ServiceInfo } from "../src/types.js";

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

// Helpers to write fixture JSONL records into the expected storage path
// Storage layout: {db_path}/{org}/{repo}/{service}/{YYYY}/{MM}/{DD}/
function writeFixture(
  dbPath: string,
  org: string,
  repo: string,
  service: string,
  date: string,
  filename: string,
  record: Record<string, unknown>
): void {
  const [yyyy, mm, dd] = date.split("-") as [string, string, string];
  const dir = join(dbPath, org, repo, service, yyyy, mm, dd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(record) + "\n", "utf-8");
}

function makeService(rootPath: string, name = "root"): ServiceInfo {
  return { name, rootPath, specPath: rootPath };
}

// ── getProjectMetrics — no data ───────────────────────────────────────────────

describe("getProjectMetrics — no data", () => {
  it("R-17 returns NO_DATA note when storage path does not exist", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "nonexistent-db");
    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const service = makeService(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.notes.some((n) => n.code === "NO_DATA")).toBe(true);
    expect(result.status).toBe("PASS");
    expect(result.compliance_score).toBeNull();
    expect(result.gate_pass_rates.G1.value).toBeNull();
  });
});

// ── getProjectMetrics — gate pass rates ──────────────────────────────────────

describe("getProjectMetrics — gate pass rates", () => {
  it("R-17 computes 100% pass rate when all gate records are PASS", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    // We must discover org/repo by mocking the storage root.
    // The simplest way: write files at the path getProjectMetrics will search.
    // buildStoragePaths calls git to get org/repo; in a tmp dir with no git
    // it will fall back to "local" / dirname.  We'll replicate that path here
    // by running the actual buildStoragePaths first.
    const { buildStoragePaths } = await import("../src/storage.js");
    const service = makeService(dir);
    const paths = buildStoragePaths(dir, service, dbPath);
    const storageDir = join(paths.storageRoot, paths.org, paths.repo, paths.service, "2025", "06", "15");
    mkdirSync(storageDir, { recursive: true });

    const gates = ["G1", "G2", "G3", "G4", "G5"] as const;
    for (const gate of gates) {
      writeFileSync(
        join(storageDir, `abc12345_main_claude-sonnet-4-5_gate-${gate}_083045000.jsonl`),
        JSON.stringify({
          schema_version: 1,
          timestamp: "2025-06-15T08:30:45.000Z",
          gate,
          gate_status: "PASS",
          results: "[]",
          org: paths.org,
          repo: paths.repo,
          service: paths.service,
          llm_model: "claude-sonnet-4-5",
          llm_id: "claude-sonnet-4-5",
        }) + "\n",
        "utf-8"
      );
    }

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    for (const gate of gates) {
      expect(result.gate_pass_rates[gate].value).toBe(100);
    }
  });

  it("R-17 computes 0% pass rate when all gate records are FAILING", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    const { buildStoragePaths } = await import("../src/storage.js");
    const service = makeService(dir);
    const paths = buildStoragePaths(dir, service, dbPath);
    const storageDir = join(paths.storageRoot, paths.org, paths.repo, paths.service, "2025", "06", "16");
    mkdirSync(storageDir, { recursive: true });

    writeFileSync(
      join(storageDir, `abc12345_main_claude-sonnet-4-5_gate-G1_083045000.jsonl`),
      JSON.stringify({
        schema_version: 1,
        timestamp: "2025-06-16T08:30:45.000Z",
        gate: "G1",
        gate_status: "FAILING",
        results: JSON.stringify([{ id: "I-1", status: "VIOLATION" }]),
        org: paths.org,
        repo: paths.repo,
        service: paths.service,
        llm_model: "claude-sonnet-4-5",
        llm_id: "claude-sonnet-4-5",
      }) + "\n",
      "utf-8"
    );

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.gate_pass_rates.G1.value).toBe(0);
    // I-1 violation should appear in top_violations
    expect(result.top_violations.some((v) => v.id === "I-1")).toBe(true);
  });
});

// ── getProjectMetrics — compliance score ─────────────────────────────────────

describe("getProjectMetrics — compliance score", () => {
  it("R-18 compliance score is null when no gate data exists", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const { config } = loadConfig(dir);
    const service = makeService(dir);
    const result = await getProjectMetrics(dir, service, config);
    expect(result.compliance_score).toBeNull();
  });

  it("R-18 compliance score is 100 when all gates pass 100%", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    const { buildStoragePaths } = await import("../src/storage.js");
    const service = makeService(dir);
    const paths = buildStoragePaths(dir, service, dbPath);
    const storageDir = join(paths.storageRoot, paths.org, paths.repo, paths.service, "2025", "07", "01");
    mkdirSync(storageDir, { recursive: true });

    for (const gate of ["G1", "G2", "G3", "G4", "G5"]) {
      writeFileSync(
        join(storageDir, `abc12345_main_claude-sonnet-4-5_gate-${gate}_120000000.jsonl`),
        JSON.stringify({
          schema_version: 1,
          timestamp: "2025-07-01T12:00:00.000Z",
          gate,
          gate_status: "PASS",
          results: "[]",
          org: paths.org,
          repo: paths.repo,
          service: paths.service,
          llm_model: "claude-sonnet-4-5",
          llm_id: "claude-sonnet-4-5",
        }) + "\n",
        "utf-8"
      );
    }

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    // All gates at 100%, so weighted sum = 100 * (0.15+0.30+0.20+0.15+0.20) = 100
    expect(result.compliance_score).toBeCloseTo(100, 0);
  });
});

// ── getProjectMetrics — since filter ─────────────────────────────────────────

describe("getProjectMetrics — since filter", () => {
  it("R-17 excludes records before the since date", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    const { buildStoragePaths } = await import("../src/storage.js");
    const service = makeService(dir);
    const paths = buildStoragePaths(dir, service, dbPath);
    const storageDir = join(paths.storageRoot, paths.org, paths.repo, paths.service, "2025", "01", "01");
    mkdirSync(storageDir, { recursive: true });

    // Old record: FAILING
    writeFileSync(
      join(storageDir, `abc12345_main_claude-sonnet-4-5_gate-G2_010000000.jsonl`),
      JSON.stringify({
        schema_version: 1,
        timestamp: "2025-01-01T01:00:00.000Z",
        gate: "G2",
        gate_status: "FAILING",
        results: "[]",
        org: paths.org,
        repo: paths.repo,
        service: paths.service,
        llm_model: "claude-sonnet-4-5",
        llm_id: "claude-sonnet-4-5",
      }) + "\n",
      "utf-8"
    );

    // New record (same day, later time): PASS
    writeFileSync(
      join(storageDir, `abc12345_main_claude-sonnet-4-5_gate-G2_020000000.jsonl`),
      JSON.stringify({
        schema_version: 1,
        timestamp: "2025-01-01T02:00:00.000Z",
        gate: "G2",
        gate_status: "PASS",
        results: "[]",
        org: paths.org,
        repo: paths.repo,
        service: paths.service,
        llm_model: "claude-sonnet-4-5",
        llm_id: "claude-sonnet-4-5",
      }) + "\n",
      "utf-8"
    );

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);

    // Filter from 01:30 — should only see the PASS record
    const result = await getProjectMetrics(dir, service, config, "2025-01-01T01:30:00.000Z");
    expect(result.gate_pass_rates.G2.value).toBe(100);
  });
});

// ── getProjectMetrics — mutation trend ───────────────────────────────────────

describe("getProjectMetrics — mutation", () => {
  it("R-19 captures latest mutation score from storage", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    const { buildStoragePaths } = await import("../src/storage.js");
    const service = makeService(dir);
    const paths = buildStoragePaths(dir, service, dbPath);
    const storageDir = join(paths.storageRoot, paths.org, paths.repo, paths.service, "2025", "08", "01");
    mkdirSync(storageDir, { recursive: true });

    writeFileSync(
      join(storageDir, `abc12345_main_claude-sonnet-4-5_mutation_120000000.jsonl`),
      JSON.stringify({
        schema_version: 1,
        timestamp: "2025-08-01T12:00:00.000Z",
        score: 78.5,
        status: "PASS",
        org: paths.org,
        repo: paths.repo,
        service: paths.service,
      }) + "\n",
      "utf-8"
    );

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.mutation.latest_score).toBeCloseTo(78.5);
  });
});

// ── getRollupMetrics — no data ────────────────────────────────────────────────

describe("getRollupMetrics — no data", () => {
  it("R-18 returns NO_DATA note when storage is empty", async () => {
    const dir = makeTmp("spec-check-rollup-");
    const dbPath = join(dir, "empty-db");
    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);
    expect(result.notes.some((n) => n.code === "NO_DATA")).toBe(true);
    expect(result.projects).toHaveLength(0);
    expect(result.model_gate_rankings).toHaveLength(0);
  });
});

// ── getRollupMetrics — cross-project aggregation ──────────────────────────────

describe("getRollupMetrics — cross-project", () => {
  it("R-18 aggregates gate pass rate across multiple projects", async () => {
    const dir = makeTmp("spec-check-rollup-");
    const dbPath = join(dir, "db");

    // Write records for two fake projects
    const projects = [
      { org: "alpha", repo: "backend", service: "api" },
      { org: "beta", repo: "frontend", service: "web" },
    ];

    for (const p of projects) {
      const storageDir = join(dbPath, p.org, p.repo, p.service, "2025", "09", "01");
      mkdirSync(storageDir, { recursive: true });
      writeFileSync(
        join(storageDir, `abc12345_main_claude-sonnet-4-5_gate-G1_090000000.jsonl`),
        JSON.stringify({
          schema_version: 1,
          timestamp: "2025-09-01T09:00:00.000Z",
          gate: "G1",
          gate_status: "PASS",
          results: "[]",
          org: p.org,
          repo: p.repo,
          service: p.service,
          llm_model: "claude-sonnet-4-5",
          llm_id: "claude-sonnet-4-5",
        }) + "\n",
        "utf-8"
      );
    }

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.projects.length).toBeGreaterThanOrEqual(2);
    for (const p of result.projects) {
      // G1 pass rate should be 100% for both projects
      expect(p.gate_breakdown.G1).toBeCloseTo(100);
    }
  });
});

// ── formatProjectMetrics ──────────────────────────────────────────────────────

describe("formatProjectMetrics", () => {
  it("R-17 text format includes gate labels and status", async () => {
    const dir = makeTmp("spec-check-format-");
    const { config } = loadConfig(dir);
    const service = makeService(dir);
    const result = await getProjectMetrics(dir, service, config);
    const text = formatProjectMetrics(result, "text");

    expect(text).toContain("Gate Pass Rates");
    expect(text).toContain("G1");
    expect(text).toContain("G2");
    expect(text).toContain("Compliance Score");
  });

  it("R-17 json format is valid JSON with a path field", async () => {
    const dir = makeTmp("spec-check-format-");
    const { config } = loadConfig(dir);
    const service = makeService(dir);
    const result = await getProjectMetrics(dir, service, config);
    const json = formatProjectMetrics(result, "json");
    const parsed = JSON.parse(json);

    expect(typeof parsed.path).toBe("string");
    expect(parsed.gate_pass_rates).toBeDefined();
    expect(parsed.compliance_score).toBeDefined();
  });

  it("R-17 mermaid format contains xychart-beta blocks", async () => {
    const dir = makeTmp("spec-check-format-");
    const { config } = loadConfig(dir);
    const service = makeService(dir);
    const result = await getProjectMetrics(dir, service, config);
    const mermaid = formatProjectMetrics(result, "mermaid");

    expect(mermaid).toContain("xychart-beta");
    expect(mermaid).toContain("Gate Pass Rates");
  });
});
