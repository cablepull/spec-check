import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runGate5 } from "../src/gates/gate5.js";
import { DEFAULT_CONFIG } from "../src/types.js";

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-g5-"));
  roots.push(root);
  writeFileSync(
    join(root, "requirements.md"),
    [
      "## Feature F-1: Membership",
      "",
      "### Rule R-1: Valid sign-ups create a new membership",
      "### Rule R-2: Invalid sign-ups are rejected",
      "",
    ].join("\n"),
    "utf-8"
  );
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("gate5", () => {
  it("R-18 blocks when no test files exist", async () => {
    const root = makeProject();
    const result = await runGate5(root, root, { value: structuredClone(DEFAULT_CONFIG), sources: {} });
    expect(result.status).toBe("BLOCKED");
    expect(result.criteria.find((item) => item.id === "E-1")?.status).toBe("BLOCK");
  });

  it("R-19 fails when a rule has no corresponding test", async () => {
    const root = makeProject();
    mkdirSync(join(root, "tests"));
    writeFileSync(
      join(root, "tests", "membership.test.ts"),
      "describe('R-1 valid sign-ups create a new membership', () => { it('Given valid sign-up When submitted Then membership is created', () => {}); });\n",
      "utf-8"
    );
    const result = await runGate5(root, root, { value: structuredClone(DEFAULT_CONFIG), sources: {} });
    expect(result.status).toBe("FAILING");
    expect(result.criteria.find((item) => item.id === "E-2")?.status).toBe("VIOLATION");
  });

  it("R-18 and R-19 pass when all rules have corresponding spec-style tests", async () => {
    const root = makeProject();
    mkdirSync(join(root, "tests"));
    writeFileSync(
      join(root, "tests", "membership.test.ts"),
      [
        "describe('R-1 valid sign-ups create a new membership', () => {",
        "  it('Given valid sign-up When submitted Then membership is created', () => {});",
        "});",
        "describe('R-2 invalid sign-ups are rejected', () => {",
        "  it('Scenario: invalid sign-up is rejected', () => {});",
        "});",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate5(root, root, { value: structuredClone(DEFAULT_CONFIG), sources: {} });
    expect(result.status).toBe("PASS");
    expect(result.criteria.find((item) => item.id === "E-1")?.status).toBe("PASS");
    expect(result.criteria.find((item) => item.id === "E-2")?.status).toBe("PASS");
    expect(result.criteria.find((item) => item.id === "E-3")?.status).toBe("PASS");
  });
});
