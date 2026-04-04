import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG, type LLMIdentity, type ServiceInfo } from "../src/types.js";
import { trackAssumption, invalidateAssumption, checkAssumptions } from "../src/assumptions.js";
import { runDiffCheck } from "../src/diff.js";
import { runComplexity } from "../src/complexity.js";
import { runMutation } from "../src/mutation.js";
import { checkDependencies, installDependency } from "../src/dependencies.js";
import { buildFilePath, buildGateRecord, writeRecord } from "../src/storage.js";
import { getRollupMetrics } from "../src/metrics.js";

const roots: string[] = [];
const llm: LLMIdentity = { provider: "anthropic", model: "claude-sonnet-4-5", id: "claude-sonnet-4-5", source: "argument" };

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function makeService(root: string): ServiceInfo {
  return { name: "root", rootPath: root, servicePath: root, specPath: root };
}

function makeConfig(root: string) {
  const value = structuredClone(DEFAULT_CONFIG);
  value.storage_root = join(root, ".spec-check-data");
  value.metrics.db_path = value.storage_root;
  return { value, sources: {} as Record<string, "default" | "global" | "project"> };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("advanced domains", () => {
  it("R-23 and R-25 track assumptions and create superseding artifacts when invalidated", () => {
    const root = makeRoot("spec-check-assumptions-");
    const artifact = join(root, "design.md");
    const service = makeService(root);
    const config = makeConfig(root);
    writeFileSync(artifact, "# Design\n\n## Assumptions\n\nNone — all decisions explicitly specified by the user.\n", "utf-8");

    const tracked = trackAssumption(artifact, "Pagination defaults to cursor-based navigation", "Assumed because the user did not specify pagination style.");
    const validation = checkAssumptions(artifact);
    const invalidated = invalidateAssumption(artifact, tracked.assumption_id, "Offset pagination is required instead.", service, config, llm);

    expect(validation.criteria.find((item) => item.id === "AS-1")?.status).toBe("PASS");
    expect("status" in invalidated && invalidated.status).toBe("superseded");
    expect("archive_path" in invalidated && existsSync(invalidated.archive_path)).toBe(true);
    expect(readFileSync(artifact, "utf-8")).toContain("## Supersedes");
  });

  it("R-26 and R-27 diff_check flags untraceable code and dependency changes without supporting artifacts", async () => {
    const root = makeRoot("spec-check-diff-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "diff-test", version: "1.0.0", dependencies: {} }, null, 2), "utf-8");
    writeFileSync(join(root, "src", "index.ts"), "export function run() { return 1; }\n", "utf-8");
    execSync("git init", { cwd: root, stdio: "ignore" });
    execSync("git config user.email spec-check@example.com", { cwd: root, stdio: "ignore" });
    execSync("git config user.name spec-check", { cwd: root, stdio: "ignore" });
    execSync("git add .", { cwd: root, stdio: "ignore" });
    execSync("git commit -m initial", { cwd: root, stdio: "ignore" });

    writeFileSync(join(root, "src", "index.ts"), "export function run() { return 2; }\n", "utf-8");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "diff-test", version: "1.0.0", dependencies: { redis: "^1.0.0" } }, null, 2), "utf-8");

    const report = await runDiffCheck(root, makeService(root), makeConfig(root), llm);
    expect(report.criteria.find((item) => item.id === "R-26")?.status).toBe("VIOLATION");
    expect(report.criteria.find((item) => item.id === "R-27")?.status).toBe("VIOLATION");
  });

  it("R-28, R-29, and R-30 complexity analysis returns metrics and stable deltas for unchanged code", async () => {
    const root = makeRoot("spec-check-complexity-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "requirements.md"),
      [
        "## Feature F-1: Complexity",
        "",
        "### Rule R-28: Validate No function may exceed the cyclomatic complexity threshold",
        "### Rule R-29: Validate High-complexity functions must have sufficient spec scenario coverage",
        "### Rule R-30: Validate Increasing complexity trends must be surfaced",
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(root, "src", "sample.ts"),
      [
        "export function choose(value: number) {",
        "  if (value > 10) return 'high';",
        "  if (value > 5) return 'mid';",
        "  return 'low';",
        "}",
      ].join("\n"),
      "utf-8"
    );

    const config = makeConfig(root);
    const first = await runComplexity(makeService(root), config, llm);
    const second = await runComplexity(makeService(root), config, llm);
    const fn = second.files[0]?.functions[0];

    expect(first.files.length).toBeGreaterThan(0);
    expect(fn?.cc).toBeGreaterThan(0);
    expect(fn?.cc_delta).toBe(0);
  });

  it("R-31 and R-32 mutation testing reports blocked execution honestly when the test runner is not configured", async () => {
    const root = makeRoot("spec-check-mutation-");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "mutation-test", version: "1.0.0" }, null, 2), "utf-8");
    writeFileSync(join(root, "sample.ts"), "export function sum(a: number, b: number) { return a + b; }\n", "utf-8");

    const report = await runMutation(root, makeService(root), makeConfig(root), llm);
    expect(report.status).toMatch(/BLOCKED|FAILING/);
    expect(report.criteria.some((item) => item.id === "MT-D" || item.id === "MT-E")).toBe(true);
  });

  it("R-33 and R-34 persist gate records and allow rollup metrics to query them", async () => {
    const root = makeRoot("spec-check-storage-");
    const config = makeConfig(root);
    const file = buildFilePath(
      {
        storageRoot: config.value.storage_root,
        org: "local",
        repo: "storage-test",
        service: "root",
        commit8: "abcd1234",
        branch: "main",
      },
      llm,
      "gate-G1",
      new Date("2026-04-04T12:00:00.000Z")
    );
    writeRecord(file, buildGateRecord({
      projectRoot: root,
      org: "local",
      repo: "storage-test",
      service: "root",
      commit8: "abcd1234",
      branch: "main",
      llm,
      gate: "G1",
      triggeredBy: "test",
      gateStatus: "PASS",
      results: [{ id: "I-1", status: "PASS" }],
      durationMs: 1,
      timestamp: new Date("2026-04-04T12:00:00.000Z"),
    }));

    const rollup = await getRollupMetrics(config);
    expect(existsSync(file)).toBe(true);
    expect(rollup.projects.length).toBeGreaterThan(0);
  });

  it("R-35 and R-36 dependency checks report missing tools and structured install failures", () => {
    const report = checkDependencies(process.cwd());
    const failure = installDependency("not-a-real-dependency", process.cwd());

    expect(report.missing.length).toBeGreaterThan(0);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.failure.reason).toBe("PACKAGE_NOT_FOUND");
      expect(failure.failure.human_explanation.length).toBeGreaterThan(0);
    }
  });
});
