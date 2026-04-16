// Story 017/018/019 — Metrics tests
// Covers: getProjectMetrics, getRollupMetrics, formatProjectMetrics
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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

  it("uses artifact-derived assumption totals for model assumption accuracy", async () => {
    const dir = makeTmp("spec-check-rollup-assumptions-");
    const dbPath = join(dir, "db");
    const projectPath = join(dir, "alpha");

    mkdirSync(join(projectPath, "stories"), { recursive: true });
    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    writeFileSync(join(projectPath, "intent.md"), "# Intent\n", "utf-8");
    writeFileSync(join(projectPath, "requirements.md"), "# Requirements\n", "utf-8");
    writeFileSync(join(projectPath, "design.md"), "# Design\n", "utf-8");
    writeFileSync(join(projectPath, "tasks.md"), "# Tasks\n", "utf-8");
    writeFileSync(
      join(projectPath, "stories", "001-auth.md"),
      [
        "# Story 001: Auth",
        "",
        "**Author:** claude-sonnet-4-5",
        "",
        "## Assumptions",
        "",
        "| ID | Assumption | Basis | Status |",
        "|----|------------|-------|--------|",
        "| A-001 | Auth uses bearer tokens | inferred | assumed |",
        "| A-002 | Session refresh is automatic | inferred | invalidated |",
        "| A-003 | Login retries are queued | inferred | assumed |",
        "| A-004 | MFA is optional | inferred | invalidated |",
        "| A-005 | Tokens expire in 1 hour | inferred | assumed |",
        "",
      ].join("\n"),
      "utf-8"
    );

    persistRecord(projectPath, dbPath, "gate-G1", "2025-11-03T10:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: projectPath,
      timestamp: "2025-11-03T10:00:00.000Z",
      gate: "G1",
      status: "PASS",
      gate_status: "PASS",
      org: "alpha",
      repo: "alpha",
      service: "root",
      criteria: [],
      results: [],
      llm_model: "claude-sonnet-4-5",
      llm_id: "claude-sonnet-4-5",
    });

    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);
    const model = result.model_assumption_accuracy.find((item) => item.model === "claude-sonnet-4-5");

    expect(model).toBeDefined();
    expect(model?.assumptions).toBe(5);
    expect(model?.invalidated).toBe(2);
    expect(model?.accuracy).toBeCloseTo(60);
  });

  it("reports supersession as a project rate rather than a raw count", async () => {
    const dir = makeTmp("spec-check-rollup-supersession-");
    const dbPath = join(dir, "db");
    const projectPath = join(dir, "proj");

    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    writeFileSync(join(projectPath, "intent.md"), "# Intent\n", "utf-8");
    writeFileSync(join(projectPath, "requirements.md"), "# Requirements\n", "utf-8");
    writeFileSync(join(projectPath, "design.md"), "# Design\n", "utf-8");
    writeFileSync(join(projectPath, "tasks.md"), "# Tasks\n", "utf-8");

    persistRecord(projectPath, dbPath, "gate-G1", "2025-11-04T10:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: projectPath,
      timestamp: "2025-11-04T10:00:00.000Z",
      gate: "G1",
      status: "PASS",
      gate_status: "PASS",
      org: "acme",
      repo: "proj",
      service: "root",
      criteria: [],
      results: [],
      llm_model: "claude-sonnet-4-5",
      llm_id: "claude-sonnet-4-5",
    });
    persistRecord(projectPath, dbPath, "supersession", "2025-11-04T10:05:00.000Z", {
      schema_version: 1,
      check_type: "supersession",
      project_path: projectPath,
      timestamp: "2025-11-04T10:05:00.000Z",
      org: "acme",
      repo: "proj",
      service: "root",
      archive_artifact: join(projectPath, "design.md"),
      original_artifact: join(projectPath, "design.md"),
      replacement_artifact: join(projectPath, "stories", "001-update.md"),
      assumption_text: "Design assumption changed",
      reason: "Updated design",
      llm_model: "claude-sonnet-4-5",
      llm_id: "claude-sonnet-4-5",
    });

    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.projects[0]?.supersession_rate).toBeCloseTo(25);
    expect(result.highest_supersession_projects[0]?.supersession_rate).toBeCloseTo(25);
  });

  it("reports unresolved RCA counts from the project rca directory", async () => {
    const dir = makeTmp("spec-check-rollup-rca-");
    const dbPath = join(dir, "db");
    const projectPath = join(dir, "proj");

    mkdirSync(join(projectPath, "rca"), { recursive: true });
    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    writeFileSync(join(projectPath, "intent.md"), "# Intent\n", "utf-8");
    writeFileSync(
      join(projectPath, "rca", "001-open.md"),
      "# RCA-001\n\n## Spec Update Required\nYes\n\n## ADR Required\nNo\n",
      "utf-8"
    );
    writeFileSync(
      join(projectPath, "rca", "002-closed.md"),
      "# RCA-002\n\n## Spec Update Required\nNo\n\n## ADR Required\nNo\n",
      "utf-8"
    );

    persistRecord(projectPath, dbPath, "gate-G1", "2025-11-05T10:00:00.000Z", {
      schema_version: 2,
      check_type: "gate",
      project_path: projectPath,
      timestamp: "2025-11-05T10:00:00.000Z",
      gate: "G1",
      status: "PASS",
      gate_status: "PASS",
      org: "acme",
      repo: "proj",
      service: "root",
      criteria: [],
      results: [],
      llm_model: "claude-sonnet-4-5",
      llm_id: "claude-sonnet-4-5",
    });

    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.projects[0]?.unresolved_rca_count).toBe(1);
    expect(result.unresolved_rcas[0]).toEqual({
      project: result.projects[0]?.project,
      unresolved: 1,
    });
  });

  it("computes adoption trend from historical compliance movement over time", async () => {
    const dir = makeTmp("spec-check-rollup-adoption-");
    const dbPath = join(dir, "db");
    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");

    const projectA = join(dir, "proj-a");
    const projectB = join(dir, "proj-b");

    for (const [projectPath, repo] of [[projectA, "proj-a"], [projectB, "proj-b"]] as const) {
      mkdirSync(projectPath, { recursive: true });
      writeFileSync(join(projectPath, "intent.md"), "# Intent\n", "utf-8");
      persistRecord(projectPath, dbPath, "gate-G1", "2025-11-01T10:00:00.000Z", {
        schema_version: 2,
        check_type: "gate",
        project_path: projectPath,
        timestamp: "2025-11-01T10:00:00.000Z",
        gate: "G1",
        status: "FAILING",
        gate_status: "FAILING",
        org: "acme",
        repo,
        service: "root",
        criteria: [],
        results: [],
        llm_model: "claude-sonnet-4-5",
        llm_id: "claude-sonnet-4-5",
      });
      persistRecord(projectPath, dbPath, "gate-G1", "2025-11-02T10:00:00.000Z", {
        schema_version: 2,
        check_type: "gate",
        project_path: projectPath,
        timestamp: "2025-11-02T10:00:00.000Z",
        gate: "G1",
        status: "PASS",
        gate_status: "PASS",
        org: "acme",
        repo,
        service: "root",
        criteria: [],
        results: [],
        llm_model: "claude-sonnet-4-5",
        llm_id: "claude-sonnet-4-5",
      });
    }

    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.adoption_trend).toBe("improving");
  });
});

// ── getProjectMetrics — run_batch_id gate scoring ────────────────────────────

describe("getProjectMetrics — run_batch_id gate scoring", () => {
  it("gate value and trend use only run_all records when any exist", async () => {
    const dir = makeTmp("spec-check-batch-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    // Two run_all records: one PASS, one FAIL → 50% from sweeps
    persistRecord(dir, dbPath, "gate-G1", "2025-10-01T10:00:00.000Z", {
      schema_version: 2, check_type: "gate", project_path: dir,
      timestamp: "2025-10-01T10:00:00.000Z",
      gate: "G1", status: "PASS", gate_status: "PASS",
      criteria: [], results: [], run_batch_id: "batch001",
    });
    persistRecord(dir, dbPath, "gate-G1", "2025-10-01T11:00:00.000Z", {
      schema_version: 2, check_type: "gate", project_path: dir,
      timestamp: "2025-10-01T11:00:00.000Z",
      gate: "G1", status: "FAILING", gate_status: "FAILING",
      criteria: [], results: [], run_batch_id: "batch002",
    });
    // Three gate_check records (all PASS) — must NOT inflate the pass rate
    for (const ts of ["2025-10-01T11:05:00.000Z", "2025-10-01T11:10:00.000Z", "2025-10-01T11:15:00.000Z"]) {
      persistRecord(dir, dbPath, "gate-G1", ts, {
        schema_version: 2, check_type: "gate", project_path: dir,
        timestamp: ts, gate: "G1", status: "PASS", gate_status: "PASS",
        criteria: [], results: [],
      });
    }

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    // 1 of 2 sweep records pass → 50%, not 4 of 5 → 80%
    expect(result.gate_pass_rates.G1.value).toBeCloseTo(50);
    // history still contains all 5 records for heatmap/sparkline
    expect(result.gate_pass_rates.G1.history).toHaveLength(5);
  });

  it("gate value uses all records when no run_batch_id records exist", async () => {
    const dir = makeTmp("spec-check-nobatch-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    // Two legacy records (no run_batch_id) — one PASS, one FAIL
    for (const [ts, status] of [
      ["2025-10-02T08:00:00.000Z", "PASS"],
      ["2025-10-02T09:00:00.000Z", "FAILING"],
    ] as const) {
      persistRecord(dir, dbPath, "gate-G2", ts, {
        schema_version: 2, check_type: "gate", project_path: dir,
        timestamp: ts, gate: "G2", status, gate_status: status,
        criteria: [], results: [],
      });
    }

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.gate_pass_rates.G2.value).toBeCloseTo(50);
  });

  it("run_batch_id is carried through to history entries", async () => {
    const dir = makeTmp("spec-check-batchhist-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    persistRecord(dir, dbPath, "gate-G3", "2025-10-03T09:00:00.000Z", {
      schema_version: 2, check_type: "gate", project_path: dir,
      timestamp: "2025-10-03T09:00:00.000Z",
      gate: "G3", status: "PASS", gate_status: "PASS",
      criteria: [], results: [], run_batch_id: "batchXYZ",
    });
    persistRecord(dir, dbPath, "gate-G3", "2025-10-03T10:00:00.000Z", {
      schema_version: 2, check_type: "gate", project_path: dir,
      timestamp: "2025-10-03T10:00:00.000Z",
      gate: "G3", status: "PASS", gate_status: "PASS",
      criteria: [], results: [],
    });

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    const history = result.gate_pass_rates.G3.history;
    expect(history).toHaveLength(2);
    const batchEntry = history.find((h) => h.run_batch_id === "batchXYZ");
    const checkEntry = history.find((h) => h.run_batch_id === null);
    expect(batchEntry).toBeDefined();
    expect(checkEntry).toBeDefined();
  });
});

// ── getProjectMetrics — complexity history fields ─────────────────────────────

describe("getProjectMetrics — complexity history fields", () => {
  it("history entries carry max_cc and violations per run", async () => {
    const dir = makeTmp("spec-check-cchistory-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    // 4 functions: CCs of 4, 8, 12, 15 → max=15, violations(>10)=2
    persistRecord(dir, dbPath, "complexity", "2025-11-01T10:00:00.000Z", {
      schema_version: 2, check_type: "complexity", project_path: dir,
      timestamp: "2025-11-01T10:00:00.000Z", status: "FAILING",
      results: [
        { cc: 4,  cognitive: null, length: 10, nesting: 1 },
        { cc: 8,  cognitive: null, length: 20, nesting: 2 },
        { cc: 12, cognitive: null, length: 30, nesting: 3 },
        { cc: 15, cognitive: null, length: 40, nesting: 3 },
      ],
    });

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.complexity.history).toHaveLength(1);
    expect(result.complexity.history[0]?.max_cc).toBe(15);
    expect(result.complexity.history[0]?.violations).toBe(2);
  });

  it("violation_count reflects the latest run", async () => {
    const dir = makeTmp("spec-check-vccount-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    // Older run: 3 violations
    persistRecord(dir, dbPath, "complexity", "2025-11-01T09:00:00.000Z", {
      schema_version: 2, check_type: "complexity", project_path: dir,
      timestamp: "2025-11-01T09:00:00.000Z", status: "FAILING",
      results: [
        { cc: 11, cognitive: null, length: 10, nesting: 1 },
        { cc: 12, cognitive: null, length: 10, nesting: 1 },
        { cc: 13, cognitive: null, length: 10, nesting: 1 },
      ],
    });
    // Newer run: 1 violation (improvement)
    persistRecord(dir, dbPath, "complexity", "2025-11-01T10:00:00.000Z", {
      schema_version: 2, check_type: "complexity", project_path: dir,
      timestamp: "2025-11-01T10:00:00.000Z", status: "FAILING",
      results: [
        { cc: 11, cognitive: null, length: 10, nesting: 1 },
        { cc: 5,  cognitive: null, length: 10, nesting: 1 },
      ],
    });

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    // violation_count reflects the latest run (1 violation, not 3)
    expect(result.complexity.violation_count).toBe(1);
    expect(result.complexity.cc_max).toBe(11);
  });

  it("violation_count is 0 when all functions are within threshold", async () => {
    const dir = makeTmp("spec-check-noviol-");
    const dbPath = join(dir, "db");
    const service = makeService(dir);

    persistRecord(dir, dbPath, "complexity", "2025-11-02T10:00:00.000Z", {
      schema_version: 2, check_type: "complexity", project_path: dir,
      timestamp: "2025-11-02T10:00:00.000Z", status: "PASS",
      results: [
        { cc: 3, cognitive: null, length: 10, nesting: 1 },
        { cc: 7, cognitive: null, length: 20, nesting: 2 },
        { cc: 10, cognitive: null, length: 15, nesting: 1 },
      ],
    });

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getProjectMetrics(dir, service, config);

    expect(result.complexity.violation_count).toBe(0);
    expect(result.complexity.cc_max).toBe(10);
  });
});

// ── getRollupMetrics — max_cc ranking ────────────────────────────────────────

describe("getRollupMetrics — max_cc in projects and ranking", () => {
  it("project entry carries max_cc from complexity records", async () => {
    const dir = makeTmp("spec-check-rollup-cc-");
    const dbPath = join(dir, "db");

    // Complexity record for one project: CCs 3, 8, 14 → max=14, avg≈8.33
    const filePath = join(dbPath, "org", "repo", "svc", "2025", "11", "01",
      "abc12345_main_x_complexity_100000000.parquet");
    writeRecord(filePath, {
      schema_version: 2, check_type: "complexity",
      project_path: join(dir, "repo"),
      timestamp: "2025-11-01T10:00:00.000Z",
      org: "org", repo: "repo", service: "svc",
      llm_model: "claude-sonnet-4-5", llm_id: "x",
      status: "FAILING",
      results: [
        { cc: 3,  cognitive: null, length: 10, nesting: 1 },
        { cc: 8,  cognitive: null, length: 20, nesting: 2 },
        { cc: 14, cognitive: null, length: 30, nesting: 3 },
      ],
    });

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.max_cc).toBe(14);
    expect(result.projects[0]?.avg_cc).toBeCloseTo(8.33, 1);
  });

  it("top_projects_by_complexity sorts by max_cc not avg_cc", async () => {
    const dir = makeTmp("spec-check-rollup-ccrank-");
    const dbPath = join(dir, "db");

    // Project A: CCs 2, 3 → max=3, avg=2.5
    // Project B: CCs 1, 20 → max=20, avg=10.5
    // B should rank first (max_cc=20), even though avg is also higher
    for (const [proj, ccs] of [["projA", [2, 3]], ["projB", [1, 20]]] as const) {
      const fp = join(dbPath, "org", proj, "svc", "2025", "11", "01",
        `abc12345_main_x_complexity_100000000.parquet`);
      writeRecord(fp, {
        schema_version: 2, check_type: "complexity",
        project_path: join(dir, proj),
        timestamp: "2025-11-01T10:00:00.000Z",
        org: "org", repo: proj, service: "svc",
        llm_model: "model", llm_id: "x",
        status: "FAILING",
        results: ccs.map((cc) => ({ cc, cognitive: null, length: 10, nesting: 1 })),
      });
    }

    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const result = await getRollupMetrics(config);

    expect(result.top_projects_by_complexity[0]?.max_cc).toBe(20);
    expect(result.top_projects_by_complexity[0]?.project).toContain("projB");
    expect(result.top_projects_by_complexity[1]?.max_cc).toBe(3);
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
