// Story 017/018/019 — Metrics tests
// Covers: getProjectMetrics, getRollupMetrics, formatProjectMetrics
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getProjectMetrics, getRollupMetrics, formatProjectMetrics } from "../src/metrics.js";
import { loadConfig } from "../src/config.js";
import { buildFilePath, buildStoragePaths, writeRecord } from "../src/storage.js";
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

function makeService(rootPath: string, name = "root"): ServiceInfo {
  return { name, rootPath, servicePath: rootPath, specPath: rootPath };
}

const fakeLlm: LLMIdentity = {
  id: "claude-sonnet-4-5",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  source: "argument",
};

const fakeActor = {
  agent_id: "agent-primary",
  agent_kind: "primary",
  parent_agent_id: null,
  session_id: "session-1",
  run_id: "run-1",
};

function persistRecord(rootPath: string, dbPath: string, checkType: string, timestamp: string, record: Record<string, unknown>): void {
  const service = makeService(rootPath);
  const paths = buildStoragePaths(rootPath, service, dbPath);
  const filePath = buildFilePath(paths, fakeLlm, checkType, new Date(timestamp));
  writeRecord(filePath, record);
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

    const service = makeService(dir);

    const gates = ["G1", "G2", "G3", "G4", "G5"] as const;
    for (const gate of gates) {
      persistRecord(dir, dbPath, `gate-${gate}`, "2025-06-15T08:30:45.000Z", {
        schema_version: 2,
        check_type: "gate",
        project_path: dir,
        timestamp: "2025-06-15T08:30:45.000Z",
        gate,
        status: "PASS",
        gate_status: "PASS",
        criteria: [],
        results: [],
      });
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

    const service = makeService(dir);
    persistRecord(dir, dbPath, "gate-G1", "2025-06-16T08:30:45.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: dir,
      timestamp: "2025-06-16T08:30:45.000Z",
      gate: "G1",
      status: "FAILING",
      gate_status: "FAILING",
      criteria: [{ id: "I-1", status: "VIOLATION" }],
      results: [{ id: "I-1", status: "VIOLATION" }],
    });

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

    const service = makeService(dir);

    for (const gate of ["G1", "G2", "G3", "G4", "G5"]) {
      persistRecord(dir, dbPath, `gate-${gate}`, "2025-07-01T12:00:00.000Z", {
        schema_version: 2,
        check_type: "gate",
        project_path: dir,
        timestamp: "2025-07-01T12:00:00.000Z",
        gate,
        status: "PASS",
        gate_status: "PASS",
        criteria: [],
        results: [],
      });
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

describe("agent-aware metrics", () => {
  it("includes project agent activity from gate and agent-state records", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    persistRecord(dir, dbPath, "gate-G1", "2025-07-02T12:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: dir,
      timestamp: "2025-07-02T12:00:00.000Z",
      gate: "G1",
      status: "PASS",
      gate_status: "PASS",
      criteria: [],
      results: [],
      ...fakeActor,
    });
    persistRecord(dir, dbPath, "agent-state", "2025-07-02T12:05:00.000Z", {
      schema_version: 1,
      check_type: "agent-state",
      project_path: dir,
      timestamp: "2025-07-02T12:05:00.000Z",
      current_phase: "review",
      open_violations: ["R-12"],
      metrics_due: true,
      status: "active",
      ...fakeActor,
    });

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.agent_activity).toHaveLength(1);
    expect(result.agent_activity[0]?.agent_id).toBe("agent-primary");
    expect(result.agent_activity[0]?.agent_kind).toBe("primary");
    expect(result.agent_activity[0]?.gate_pass_rate).toBe(100);
    expect(result.agent_activity[0]?.metrics_due).toBe(true);
    expect(result.agent_activity[0]?.open_violations).toBe(1);
  });

  it("includes rollup agent rankings and kind rankings", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    persistRecord(dir, dbPath, "gate-G1", "2025-07-03T12:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: dir,
      timestamp: "2025-07-03T12:00:00.000Z",
      gate: "G1",
      status: "PASS",
      gate_status: "PASS",
      criteria: [],
      results: [],
      ...fakeActor,
    });
    persistRecord(dir, dbPath, "gate-G2", "2025-07-03T12:01:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: dir,
      timestamp: "2025-07-03T12:01:00.000Z",
      gate: "G2",
      status: "FAILING",
      gate_status: "FAILING",
      criteria: [{ id: "R-1", status: "VIOLATION" }],
      results: [{ id: "R-1", status: "VIOLATION" }],
      agent_id: "agent-reviewer",
      agent_kind: "reviewer",
      parent_agent_id: null,
      session_id: "session-1",
      run_id: "run-2",
    });
    persistRecord(dir, dbPath, "agent-state", "2025-07-03T12:02:00.000Z", {
      schema_version: 1,
      check_type: "agent-state",
      project_path: dir,
      timestamp: "2025-07-03T12:02:00.000Z",
      current_phase: "review",
      metrics_due: false,
      open_violations: [],
      status: "completed",
      ...fakeActor,
    });

    writeFileSync(
      join(dir, "spec-check.config.json"),
      JSON.stringify({ metrics: { db_path: dbPath } }),
      "utf-8"
    );
    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.agent_gate_rankings.some((item) => item.agent_id === "agent-primary")).toBe(true);
    expect(result.agent_gate_rankings.some((item) => item.agent_id === "agent-reviewer")).toBe(true);
    expect(result.agent_kind_rankings.some((item) => item.agent_kind === "primary")).toBe(true);
    expect(result.agent_kind_rankings.some((item) => item.agent_kind === "reviewer")).toBe(true);
  });
});

// ── getProjectMetrics — since filter ─────────────────────────────────────────

describe("getProjectMetrics — since filter", () => {
  it("R-17 excludes records before the since date", async () => {
    const dir = makeTmp("spec-check-metrics-");
    const dbPath = join(dir, "db");

    const service = makeService(dir);
    persistRecord(dir, dbPath, "gate-G2", "2025-01-01T01:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: dir,
      timestamp: "2025-01-01T01:00:00.000Z",
      gate: "G2",
      status: "FAILING",
      gate_status: "FAILING",
      criteria: [],
      results: [],
    });

    persistRecord(dir, dbPath, "gate-G2", "2025-01-01T02:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: dir,
      timestamp: "2025-01-01T02:00:00.000Z",
      gate: "G2",
      status: "PASS",
      gate_status: "PASS",
      criteria: [],
      results: [],
    });

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

    const service = makeService(dir);
    persistRecord(dir, dbPath, "mutation", "2025-08-01T12:00:00.000Z", {
      schema_version: 2,
      check_type: "mutation",
      project_path: dir,
      timestamp: "2025-08-01T12:00:00.000Z",
      score: 78.5,
      status: "PASS",
    });

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
      const filePath = join(
        dbPath,
        p.org,
        p.repo,
        p.service,
        "2025",
        "09",
        "01",
        "abc12345_main_claude-sonnet-4-5_gate-G1_090000000.parquet"
      );
      writeRecord(filePath, {
        schema_version: 2,
        check_type: "gate",
        project_path: join(dir, p.repo),
        timestamp: "2025-09-01T09:00:00.000Z",
        org: p.org,
        repo: p.repo,
        service: p.service,
        gate: "G1",
        status: "PASS",
        gate_status: "PASS",
        criteria: [],
        results: [],
        llm_model: "claude-sonnet-4-5",
        llm_id: "claude-sonnet-4-5",
      });
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
