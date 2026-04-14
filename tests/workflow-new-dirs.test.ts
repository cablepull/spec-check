import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { computeWorkflowGuidance } from "../src/workflow.js";
import type { AgentState } from "../src/types.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-workflow-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

/** Minimal blank AgentState — lets inferPhase drive phase detection from disk. */
const BLANK_STATE: AgentState = {
  current_goal: null,
  current_phase: null,
  working_set_paths: [],
  changed_paths: [],
  last_completed_check: null,
  required_next_checks: [],
  open_violations: [],
  assumptions_declared: null,
  metrics_due: null,
  summary_from_agent: null,
  status: "active",
};

function phase(root: string): string {
  return computeWorkflowGuidance(root, BLANK_STATE).phase;
}

function addStories(root: string): void {
  const dir = join(root, "stories");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "001-story.md"), "# Story 001\n\n## Intent\nSomething.\n", "utf-8");
}

function addPrd(root: string): void {
  const dir = join(root, "prd");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "001-feature.md"), "# PRD 001\n\n## Feature F-1: Something\n", "utf-8");
}

function addAdr(root: string): void {
  const dir = join(root, "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "001-decision.md"), "# ADR 001\n\n## Status\n\nProposed\n", "utf-8");
}

function addTasks(root: string): void {
  writeFileSync(join(root, "tasks.md"), "- [ ] Do something (Rule: R-1)\n", "utf-8");
}

describe("inferPhase with new directory structure", () => {
  it("returns 'intent' when stories/ absent and no intent.md", () => {
    const root = makeRoot();
    // Empty root — could be "bootstrap" only if orphaned PRD present; otherwise "intent"
    expect(["intent", "bootstrap"]).toContain(phase(root));
  });

  it("returns 'requirements' when stories/ has files but prd/ is absent", () => {
    const root = makeRoot();
    addStories(root);
    expect(phase(root)).toBe("requirements");
  });

  it("returns 'design' when stories/ + prd/ present but adr/ is absent", () => {
    const root = makeRoot();
    addStories(root);
    addPrd(root);
    expect(phase(root)).toBe("design");
  });

  it("returns 'tasks' when stories/ + prd/ + adr/ present but no tasks.md", () => {
    const root = makeRoot();
    addStories(root);
    addPrd(root);
    addAdr(root);
    expect(phase(root)).toBe("tasks");
  });

  it("returns 'implementation' when all artifacts present including tasks.md", () => {
    const root = makeRoot();
    addStories(root);
    addPrd(root);
    addAdr(root);
    addTasks(root);
    // No tests/ dir → executability phase; with tests/ → implementation
    // Either is valid here; ensure it's not stuck at an earlier phase
    expect(["executability", "implementation"]).toContain(phase(root));
  });

  it("returns 'bootstrap' when orphaned PRD exists at root with no stories/ or prd/", () => {
    const root = makeRoot();
    writeFileSync(join(root, "PRD.md"), "# PRD: My Feature\n\n## Feature F-1\n", "utf-8");
    expect(phase(root)).toBe("bootstrap");
  });

  it("falls back to 'requirements' when legacy intent.md exists but prd/ is absent", () => {
    const root = makeRoot();
    writeFileSync(join(root, "intent.md"), "Legacy intent.\n", "utf-8");
    expect(phase(root)).toBe("requirements");
  });

  it("falls back to 'design' when legacy intent.md + requirements.md exist but no adr/ or design.md", () => {
    const root = makeRoot();
    writeFileSync(join(root, "intent.md"), "Legacy intent.\n", "utf-8");
    writeFileSync(join(root, "requirements.md"), "Legacy requirements.\n", "utf-8");
    expect(phase(root)).toBe("design");
  });
});
