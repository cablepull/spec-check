import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG } from "../src/types.js";
import { runGate1 } from "../src/gates/gate1.js";
import { runGate2 } from "../src/gates/gate2.js";
import { runGate3 } from "../src/gates/gate3.js";

const roots: string[] = [];
const config = { value: structuredClone(DEFAULT_CONFIG), sources: {} };

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-new-struct-"));
  roots.push(root);
  return root;
}

function makeStoriesDir(root: string): string {
  const dir = join(root, "stories");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makePrdDir(root: string): string {
  const dir = join(root, "prd");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAdrDir(root: string): string {
  const dir = join(root, "adr");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const VALID_STORY = [
  "# Story 001: Account durability",
  "",
  "## Intent",
  "",
  "The problem is that account data is lost during restarts because there is no persistence layer.",
  "Because users currently cannot recover their sessions, we need this in order to retain state.",
  "Only account data must be persisted; caches are excluded.",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] Account data survives a service restart",
  "- [ ] An account that never existed returns a 404",
  "",
  "## ADR Required",
  "",
  "No",
  "",
  "## Requirements",
  "",
  "References F-1 in prd/001-accounts.md",
  "",
  "## Assumptions",
  "",
  "| ID | Assumption | Basis | Status |",
  "|----|-----------|-------|--------|",
  "| A-001 | Postgres is available | infra provisioned | assumed |",
].join("\n");

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

// ── Gate 1 — stories/ directory ────────────────────────────────────────────────

describe("Gate 1 — stories/ directory structure", () => {
  it("S-1 BLOCK when stories/ is absent and no intent.md", async () => {
    const root = makeRoot();
    const result = await runGate1(root, config);
    expect(result.status).toBe("BLOCKED");
    expect(result.criteria.find((c) => c.id === "S-1")?.status).toBe("BLOCK");
  });

  it("PASS when valid story with causal language is present", async () => {
    const root = makeRoot();
    const dir = makeStoriesDir(root);
    writeFileSync(join(dir, "001-accounts.md"), VALID_STORY, "utf-8");
    const result = await runGate1(root, config);
    expect(result.status).toBe("PASS");
  });

  it("S-6 VIOLATION when Intent section lacks causal language", async () => {
    const root = makeRoot();
    const dir = makeStoriesDir(root);
    writeFileSync(
      join(dir, "001-missing-causal.md"),
      [
        "# Story 001: Accounts",
        "",
        "## Intent",
        "",
        "Build an account system with a login form and a dashboard view.",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] Users can log in",
        "",
        "## ADR Required",
        "",
        "No",
        "",
        "## Requirements",
        "",
        "References F-1",
        "",
        "## Assumptions",
        "",
        "None.",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate1(root, config);
    expect(result.criteria.find((c) => c.id === "S-6")?.status).toMatch(/VIOLATION|WARNING/);
  });

  it("S-8 VIOLATION when Intent contains implementation details", async () => {
    const root = makeRoot();
    const dir = makeStoriesDir(root);
    writeFileSync(
      join(dir, "001-impl-leak.md"),
      [
        "# Story 001: Accounts",
        "",
        "## Intent",
        "",
        "The problem is that we are using React and PostgreSQL without a consistent schema.",
        "Because we need this UserController to work, only the database layer must be updated.",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] Schema is consistent",
        "",
        "## ADR Required",
        "",
        "No",
        "",
        "## Requirements",
        "",
        "References F-1",
        "",
        "## Assumptions",
        "",
        "None.",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate1(root, config);
    expect(result.criteria.find((c) => c.id === "S-8")?.status).toMatch(/VIOLATION|WARNING/);
  });

  it("legacy intent.md emits deprecation WARNING instead of BLOCK", async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, "intent.md"),
      "Users need consistency because the workflow drifts.\n",
      "utf-8"
    );
    const result = await runGate1(root, config);
    // Should not be BLOCKED — legacy path still works
    expect(result.status).not.toBe("BLOCKED");
    // Should emit a deprecation warning
    const deprecation = result.criteria.find(
      (c) => c.status === "WARNING" && (c.detail.toLowerCase().includes("stories") || c.detail.toLowerCase().includes("deprecat") || c.detail.toLowerCase().includes("migrate"))
    );
    expect(deprecation).toBeDefined();
  });
});

// ── Gate 2 — prd/ directory ────────────────────────────────────────────────────

const VALID_PRD = [
  "# PRD 001: Accounts",
  "",
  "## Feature F-1: Account management",
  "",
  "### Rule R-1: Validate accounts must persist across restarts",
  "",
  "Example: happy path",
  "Given an account exists in the database",
  "When the service restarts",
  "Then the account is still accessible",
  "",
  "Example: rejection",
  "Given no account exists",
  "When a request is made for that account",
  "Then the user sees a not-found error",
  "",
  "## Assumptions",
  "",
  "| # | Assumption | Basis | Impact if wrong |",
  "|---|-----------|-------|-----------------|",
  "| A1 | DB available | infra | data loss |",
].join("\n");

describe("Gate 2 — prd/ directory structure", () => {
  it("P-1 BLOCK when prd/ is absent and no requirements.md", async () => {
    const root = makeRoot();
    const result = await runGate2(root, config);
    expect(result.status).toBe("BLOCKED");
  });

  it("PASS when valid PRD exists and requirements.md is compiled", async () => {
    const root = makeRoot();
    const prdDir = makePrdDir(root);
    writeFileSync(join(prdDir, "001-accounts.md"), VALID_PRD, "utf-8");
    writeFileSync(join(root, "requirements.md"), VALID_PRD, "utf-8");
    const result = await runGate2(root, config);
    expect(result.status).not.toBe("BLOCKED");
    expect(result.criteria.find((c) => c.id === "P-11")?.status).not.toBe("VIOLATION");
  });

  it("P-11 VIOLATION when prd/ exists but requirements.md not compiled", async () => {
    const root = makeRoot();
    const prdDir = makePrdDir(root);
    writeFileSync(join(prdDir, "001-accounts.md"), VALID_PRD, "utf-8");
    // No requirements.md
    const result = await runGate2(root, config);
    expect(result.criteria.find((c) => c.id === "P-11")?.status).toBe("VIOLATION");
  });

  it("legacy requirements.md emits deprecation WARNING", async () => {
    const root = makeRoot();
    writeFileSync(join(root, "requirements.md"), VALID_PRD, "utf-8");
    const result = await runGate2(root, config);
    expect(result.status).not.toBe("BLOCKED");
    const deprecation = result.criteria.find(
      (c) => c.status === "WARNING" && (c.detail.toLowerCase().includes("prd") || c.detail.toLowerCase().includes("deprecat") || c.detail.toLowerCase().includes("migrate"))
    );
    expect(deprecation).toBeDefined();
  });
});

// ── Gate 3 — adr/ directory ────────────────────────────────────────────────────

const VALID_ADR = [
  "# ADR 001: Persistence strategy",
  "",
  "## Status",
  "",
  "Proposed",
  "",
  "## Context",
  "",
  "Feature F-1 requires persistent account storage. The service module currently uses in-memory state.",
  "Rule R-1 specifies that accounts must survive restarts.",
  "",
  "## Decision",
  "",
  "We will use a database layer backed by a persistence module to satisfy R-1.",
  "This satisfies the durability constraint from requirements.md.",
  "",
  "## Consequences",
  "",
  "Adds a service dependency. Improves durability. Requires migration tooling.",
  "",
  "## Alternatives Considered",
  "",
  "File-based storage was rejected due to concurrency constraints.",
  "",
  "## Assumptions",
  "",
  "| ID | Assumption | Basis | Status |",
  "|----|-----------|-------|--------|",
  "| A-001 | DB available in production | infra team confirmed | assumed |",
].join("\n");

describe("Gate 3 — adr/ directory structure", () => {
  it("BLOCK when adr/ is absent and no design.md", async () => {
    const root = makeRoot();
    const result = await runGate3(root, config);
    expect(result.status).toBe("BLOCKED");
  });

  it("PASS when valid ADR exists with requirement traceability", async () => {
    const root = makeRoot();
    const adrDir = makeAdrDir(root);
    writeFileSync(join(adrDir, "001-persistence.md"), VALID_ADR, "utf-8");
    writeFileSync(
      join(root, "requirements.md"),
      "## Feature F-1: Accounts\n\n### Rule R-1: Validate accounts must persist\n",
      "utf-8"
    );
    const result = await runGate3(root, config);
    expect(result.status).not.toBe("BLOCKED");
  });

  it("A-4 VIOLATION when no ADR references any requirement ID from requirements.md", async () => {
    const root = makeRoot();
    const adrDir = makeAdrDir(root);
    writeFileSync(
      join(adrDir, "001-no-trace.md"),
      [
        "# ADR 001: Persistence strategy",
        "",
        "## Status",
        "",
        "Proposed",
        "",
        "## Context",
        "",
        "We need to store data somewhere in some layer.",
        "",
        "## Decision",
        "",
        "Use a database module for the storage layer.",
        "",
        "## Consequences",
        "",
        "Adds a dependency.",
        "",
        "## Alternatives Considered",
        "",
        "File storage was rejected.",
        "",
        "## Assumptions",
        "",
        "None.",
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(root, "requirements.md"),
      "## Feature F-1: Accounts\n\n### Rule R-1: Validate accounts must persist\n",
      "utf-8"
    );
    const result = await runGate3(root, config);
    const traceability = result.criteria.find((c) => c.id === "A-4");
    expect(traceability?.status).toMatch(/VIOLATION|WARNING/);
  });

  it("legacy design.md emits deprecation WARNING", async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, "design.md"),
      "## Assumptions\nNone.\n",
      "utf-8"
    );
    const result = await runGate3(root, config);
    expect(result.status).not.toBe("BLOCKED");
    const deprecation = result.criteria.find(
      (c) => c.status === "WARNING" && (c.detail.toLowerCase().includes("adr") || c.detail.toLowerCase().includes("deprecat") || c.detail.toLowerCase().includes("migrate"))
    );
    expect(deprecation).toBeDefined();
  });
});
