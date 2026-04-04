import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG } from "../src/types.js";
import { runGate1 } from "../src/gates/gate1.js";
import { runGate2 } from "../src/gates/gate2.js";
import { runGate3 } from "../src/gates/gate3.js";
import { runGate4 } from "../src/gates/gate4.js";

const roots: string[] = [];
const config = { value: structuredClone(DEFAULT_CONFIG), sources: {} };

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-gates-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("gates 1 through 4", () => {
  it("R-4 blocks Gate 1 when no intent document exists", async () => {
    const root = makeRoot();
    const result = await runGate1(root, config);
    expect(result.status).toBe("BLOCKED");
    expect(result.criteria.find((item) => item.id === "I-1")?.status).toBe("BLOCK");
  });

  it("R-5 and R-6 enforce causal language and reject implementation details in intent", async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, "intent.md"),
      [
        "We will implement this in React and PostgreSQL.",
        "Users need consistency because the workflow currently drifts.",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate1(root, config);
    expect(result.criteria.find((item) => item.id === "I-2")?.status).toBe("PASS");
    expect(result.criteria.find((item) => item.id === "I-5")?.status).toMatch(/WARNING|VIOLATION/);
  });

  it("R-7 and R-8 fail Gate 2 when requirements lack rule coverage and negative examples", async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, "requirements.md"),
      [
        "## Feature F-1: Accounts",
        "",
        "Example: happy path only",
        "Given the account exists",
        "When the account is loaded",
        "Then the user sees the account",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate2(root, config);
    expect(result.criteria.find((item) => item.id === "R-2")?.status).toBe("VIOLATION");
    expect(result.criteria.find((item) => item.id === "R-5")?.status).toBe("VIOLATION");
  });

  it("R-10 and R-12 detect invalid Given and Then structure in Gate 2", async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, "requirements.md"),
      [
        "## Feature F-1: Accounts",
        "",
        "### Rule R-1: Validate The user can log in",
        "",
        "Example: invalid structure",
        "Given the user clicks the login button",
        "When Jane submits the form and the system sends an email",
        "Then the database contains a new user record",
        "",
        "Negative Example: rejection",
        "Given the account is locked",
        "When Jane submits the form",
        "Then the user sees an error message",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate2(root, config);
    expect(result.criteria.find((item) => item.id === "R-7")?.status).toBe("VIOLATION");
    expect(result.criteria.find((item) => item.id === "R-9")?.status).toBe("VIOLATION");
  });

  it("R-13, R-14, and R-15 enforce design existence and requirement traceability", async () => {
    const root = makeRoot();
    writeFileSync(join(root, "requirements.md"), "## Feature F-1: Accounts\n\n### Rule R-1: Validate Accounts must be durable\n", "utf-8");
    writeFileSync(join(root, "design.md"), "The module should not be durable.\n## Assumptions\nNone.\n", "utf-8");
    const result = await runGate3(root, config);
    expect(result.criteria.find((item) => item.id === "D-2")?.status).toBe("VIOLATION");
    expect(result.criteria.find((item) => item.id === "D-4")?.status).toBe("WARNING");
  });

  it("R-16 and R-17 fail Gate 4 on compound and untraceable tasks", async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, "tasks.md"),
      [
        "- [ ] Implement parsing and add persistence",
        "- [ ] Fix stuff",
        "",
        "## Assumptions",
        "None.",
      ].join("\n"),
      "utf-8"
    );
    const result = await runGate4(root, config);
    expect(result.criteria.find((item) => item.id === "T-2")?.status).toBe("VIOLATION");
    expect(result.criteria.find((item) => item.id === "T-3")?.status).toBe("VIOLATION");
  });
});
