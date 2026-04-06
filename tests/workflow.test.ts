import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig } from "../src/config.js";
import { beginSession, computeWorkflowGuidance, latestAgentState, listAgentState, persistAgentState } from "../src/workflow.js";
import type { ActorIdentity, ServiceInfo } from "../src/types.js";

const roots: string[] = [];

function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function makeService(rootPath: string, name = "root"): ServiceInfo {
  return { name, rootPath, servicePath: rootPath, specPath: rootPath };
}

function makeActor(overrides: Partial<ActorIdentity> = {}): ActorIdentity {
  return {
    id: "gpt-5",
    provider: "openai",
    model: "gpt-5",
    source: "argument",
    agent_id: "agent-primary",
    agent_kind: "primary",
    parent_agent_id: null,
    session_id: "session-1",
    run_id: "run-1",
    ...overrides,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("workflow guidance", () => {
  it("infers the next gate from missing spec files", () => {
    const dir = makeTmp("spec-check-workflow-");
    const guidance = computeWorkflowGuidance(dir, {
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
    });

    expect(guidance.phase).toBe("intent");
    expect(guidance.must_call_next).toEqual(["gate_check:G1"]);
    expect(guidance.should_call_metrics).toBe(false);
  });

  it("requests metrics after implementation files change", () => {
    const dir = makeTmp("spec-check-workflow-");
    writeFileSync(join(dir, "intent.md"), "# Intent\n", "utf-8");
    writeFileSync(join(dir, "requirements.md"), "# Requirements\n", "utf-8");
    writeFileSync(join(dir, "design.md"), "# Design\n", "utf-8");
    writeFileSync(join(dir, "tasks.md"), "# Tasks\n", "utf-8");
    mkdirSync(join(dir, "tests"));

    const guidance = computeWorkflowGuidance(dir, {
      current_goal: "implement feature",
      current_phase: null,
      working_set_paths: ["src/index.ts"],
      changed_paths: ["src/index.ts"],
      last_completed_check: "G5",
      required_next_checks: [],
      open_violations: [],
      assumptions_declared: true,
      metrics_due: null,
      summary_from_agent: null,
      status: "active",
    });

    expect(guidance.phase).toBe("implementation");
    expect(guidance.must_call_next).toEqual(["metrics"]);
    expect(guidance.should_call_metrics).toBe(true);
  });
});

describe("agent state persistence", () => {
  it("persists and reloads state per agent and session", () => {
    const dir = makeTmp("spec-check-agent-state-");
    const dbPath = join(dir, "db");
    writeFileSync(join(dir, "spec-check.config.json"), JSON.stringify({ metrics: { db_path: dbPath } }), "utf-8");
    const { config } = loadConfig(dir);
    const service = makeService(dir);
    const actor = makeActor();
    const sibling = makeActor({ agent_id: "agent-reviewer", agent_kind: "reviewer", run_id: "run-2" });

    const started = beginSession(dir, service, config, actor);
    expect(started.actor.agent_id).toBe("agent-primary");
    expect(started.workflow.must_call_next).toEqual(["gate_check:G1"]);

    persistAgentState(dir, service, config, actor, {
      current_goal: "finish gate 2",
      last_completed_check: "G1",
      changed_paths: ["requirements.md"],
      required_next_checks: ["gate_check:G2"],
      summary_from_agent: "requirements drafted",
    });
    persistAgentState(dir, service, config, sibling, {
      current_goal: "review implementation",
      current_phase: "review",
      open_violations: ["R-12"],
      status: "active",
    });

    const latest = latestAgentState(dir, service, config, actor);
    expect(latest?.actor.agent_id).toBe("agent-primary");
    expect(latest?.current_goal).toBe("finish gate 2");
    expect(latest?.required_next_checks).toEqual(["gate_check:G2"]);

    const listed = listAgentState(dir, service, config, "session-1");
    expect(listed.agents).toHaveLength(2);
    expect(listed.agents.map((item) => item.actor.agent_kind).sort()).toEqual(["primary", "reviewer"]);
  });
});
