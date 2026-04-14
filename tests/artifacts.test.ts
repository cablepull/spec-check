import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateArtifacts } from "../src/artifacts.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-artifacts-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("artifact validation", () => {
  it("R-20 stories must have all required sections", () => {
    const root = makeRoot();
    mkdirSync(join(root, "stories"));
    writeFileSync(
      join(root, "stories", "001-sample-story.md"),
      [
        "# Story 001: Sample",
        "",
        "## Intent",
        "Currently the workflow drifts because there is no consistent enforcement.",
        "We need this in order to constrain drift and prevent rework.",
        "Only validated artifacts must proceed to implementation.",
        "",
        "## Acceptance Criteria",
        "- [ ] Item one",
        "",
        "## ADR Required",
        "No",
        "",
        "## Requirements",
        "References R-20.",
        "",
        "## Assumptions",
        "None.",
      ].join("\n"),
      "utf-8"
    );
    const result = validateArtifacts(join(root, "stories", "001-sample-story.md"));
    expect(result.status).toBe("PASS");
  });

  it("R-21 ADR status must be a valid value", () => {
    const root = makeRoot();
    mkdirSync(join(root, "adr"));
    writeFileSync(
      join(root, "adr", "001-sample-adr.md"),
      [
        "# ADR-001: Sample",
        "",
        "## Status",
        "Accepted",
        "",
        "## Context",
        "References story 001.",
        "",
        "## Decision",
        "Use the documented approach.",
        "",
        "## Consequences",
        "There are tradeoffs.",
        "",
        "## Alternatives Considered",
        "Do nothing.",
      ].join("\n"),
      "utf-8"
    );
    const result = validateArtifacts(join(root, "adr", "001-sample-adr.md"));
    expect(result.status).toBe("PASS");
    expect(result.results[0]?.artifactKind).toBe("adr");
  });

  it("R-22 RCAs must link to a violated requirement", () => {
    const root = makeRoot();
    mkdirSync(join(root, "rca"));
    writeFileSync(
      join(root, "rca", "001-sample-rca.md"),
      [
        "# RCA-001: Sample",
        "",
        "## Summary",
        "Mismatch discovered.",
        "",
        "## Root Cause",
        "The implementation drifted.",
        "",
        "## Violated Requirement",
        "R-22",
        "",
        "## Resolution",
        "Align the implementation and spec.",
        "",
        "## Spec Update Required",
        "Yes",
        "",
        "## ADR Required",
        "No",
        "",
        "## Assumptions",
        "None.",
      ].join("\n"),
      "utf-8"
    );
    const result = validateArtifacts(join(root, "rca", "001-sample-rca.md"));
    expect(result.status).toBe("PASS");
    expect(result.results[0]?.artifactKind).toBe("rca");
  });
});
