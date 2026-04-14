import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileRequirements } from "../src/compile_requirements.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-compile-"));
  roots.push(root);
  return root;
}

function makePrd(root: string, filename: string, content: string): void {
  const prdDir = join(root, "prd");
  mkdirSync(prdDir, { recursive: true });
  writeFileSync(join(prdDir, filename), content, "utf-8");
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

const PRD_001 = [
  "# PRD 001: Accounts",
  "",
  "## Feature F-1: Account management",
  "",
  "### Rule R-1: Validate accounts must persist",
  "",
  "Example: happy path",
  "Given an account exists",
  "When the service restarts",
  "Then the account is still accessible",
  "",
  "Example: rejection",
  "Given no account exists",
  "When a request is made",
  "Then a not-found error is returned",
  "",
  "## Assumptions",
  "",
  "| # | Assumption | Basis | Impact |",
  "|---|-----------|-------|--------|",
  "| A1 | DB available | infra | data loss |",
].join("\n");

const PRD_002 = [
  "# PRD 002: Notifications",
  "",
  "## Feature F-2: Email delivery",
  "",
  "### Rule R-2: Validate emails are sent on account creation",
  "",
  "Example: happy path",
  "Given a new account is created",
  "When creation completes",
  "Then an email is sent to the account address",
  "",
  "Example: rejection",
  "Given an invalid email address",
  "When creation is attempted",
  "Then a validation error is returned",
].join("\n");

describe("compile_requirements", () => {
  it("returns skipped when prd/ directory does not exist", () => {
    const root = makeRoot();
    const result = compileRequirements(root, false);
    expect(result.written).toBe(false);
    expect(result.skippedReason).toBeTruthy();
    expect(result.compiledText).toBe("");
  });

  it("compiles single PRD without writing when write=false", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    const result = compileRequirements(root, false);
    expect(result.written).toBe(false);
    expect(result.prdFiles).toHaveLength(1);
    expect(result.compiledText).toContain("Feature F-1");
    expect(result.compiledText).toContain("Rule R-1");
    expect(existsSync(join(root, "requirements.md"))).toBe(false);
  });

  it("writes requirements.md when write=true", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    const result = compileRequirements(root, true);
    expect(result.written).toBe(true);
    expect(existsSync(join(root, "requirements.md"))).toBe(true);
    const written = readFileSync(join(root, "requirements.md"), "utf-8");
    expect(written).toContain("Feature F-1");
    expect(written).toContain("Rule R-1");
  });

  it("compiled output contains preamble comment", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    const result = compileRequirements(root, false);
    expect(result.compiledText).toMatch(/AUTO-GENERATED|compile_requirements/i);
  });

  it("strips the PRD title heading from compiled output", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    const result = compileRequirements(root, false);
    // The "# PRD 001: Accounts" title should not appear in compiled output
    expect(result.compiledText).not.toContain("# PRD 001");
  });

  it("compiles multiple PRDs in filename order", () => {
    const root = makeRoot();
    makePrd(root, "002-notifications.md", PRD_002);
    makePrd(root, "001-accounts.md", PRD_001);
    const result = compileRequirements(root, false);
    expect(result.prdFiles).toHaveLength(2);
    // 001 must appear before 002
    const idx1 = result.compiledText.indexOf("Feature F-1");
    const idx2 = result.compiledText.indexOf("Feature F-2");
    expect(idx1).toBeLessThan(idx2);
  });

  it("feature and rule IDs are preserved without renumbering", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    makePrd(root, "002-notifications.md", PRD_002);
    const result = compileRequirements(root, false);
    expect(result.compiledText).toContain("F-1");
    expect(result.compiledText).toContain("F-2");
    expect(result.compiledText).toContain("R-1");
    expect(result.compiledText).toContain("R-2");
  });

  it("is idempotent — running twice produces identical output", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    const first = compileRequirements(root, true);
    const second = compileRequirements(root, true);
    expect(first.compiledText).toBe(second.compiledText);
  });

  it("reports featuresCompiled and rulesCompiled counts", () => {
    const root = makeRoot();
    makePrd(root, "001-accounts.md", PRD_001);
    makePrd(root, "002-notifications.md", PRD_002);
    const result = compileRequirements(root, false);
    expect(result.featuresCompiled).toBe(2);
    expect(result.rulesCompiled).toBe(2);
  });
});
