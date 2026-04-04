import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveIdentity } from "../src/identity.js";
import { buildProtocol } from "../src/protocol.js";
import { loadConfig } from "../src/config.js";
import { detectServices } from "../src/monorepo.js";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalSpecCheckLlm = process.env.SPEC_CHECK_LLM;

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalSpecCheckLlm === undefined) delete process.env.SPEC_CHECK_LLM;
  else process.env.SPEC_CHECK_LLM = originalSpecCheckLlm;
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("foundation", () => {
  it("R-2 resolves identity from tool argument before env and config", () => {
    const root = makeRoot("spec-check-foundation-");
    writeFileSync(join(root, "spec-check.config.json"), JSON.stringify({ default_llm: "gemini-2.5-pro" }), "utf-8");
    process.env.SPEC_CHECK_LLM = "gpt-5";
    const { config } = loadConfig(root);
    const identity = resolveIdentity("claude-sonnet-4-5", config);
    expect(identity.source).toBe("argument");
    expect(identity.provider).toBe("anthropic");
    expect(identity.id).toBe("claude-sonnet-4-5");
  });

  it("R-3 get_protocol exposes Gate 5 as the test-backed E-1 through E-3 contract", () => {
    const protocol = buildProtocol();
    const gate5 = protocol.gates.find((gate) => gate.id === "G5");
    const workflow5 = protocol.workflow.find((step) => step.gate === "G5");
    expect(gate5?.criteriaIds).toEqual(["E-1", "E-2", "E-3"]);
    expect(workflow5?.summary).toContain("test files");
    expect(workflow5?.summary).toContain("corresponding test");
  });

  it("R-37 project config overrides global config without replacing it", () => {
    const home = makeRoot("spec-check-home-");
    const project = makeRoot("spec-check-project-");
    mkdirSync(join(home, ".spec-check"), { recursive: true });
    writeFileSync(
      join(home, ".spec-check", "config.json"),
      JSON.stringify({
        default_llm: "gpt-5",
        thresholds: { "R-3": 0.8, "D-3": 0.5 },
      }),
      "utf-8"
    );
    writeFileSync(
      join(project, "spec-check.config.json"),
      JSON.stringify({
        thresholds: { "R-3": 0.95 },
      }),
      "utf-8"
    );
    process.env.HOME = home;

    const { config, errors } = loadConfig(project);
    expect(errors).toEqual([]);
    expect(config.value.thresholds["R-3"]).toBe(0.95);
    expect(config.value.thresholds["D-3"]).toBe(0.5);
    expect(config.value.default_llm).toBe("gpt-5");
  });

  it("R-38 invalid config returns a structured error without crashing", () => {
    const project = makeRoot("spec-check-invalid-config-");
    writeFileSync(join(project, "spec-check.config.json"), "{ invalid json", "utf-8");
    const { config, errors } = loadConfig(project);
    expect(config.value.thresholds["R-3"]).toBeTypeOf("number");
    expect(errors[0]?.type).toBe("CONFIG_PARSE_ERROR");
  });

  it("R-39 and R-40 detect workspace services while keeping root-level checks at project root", () => {
    const root = makeRoot("spec-check-monorepo-");
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["apps/*"] }),
      "utf-8"
    );
    writeFileSync(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }), "utf-8");
    writeFileSync(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web" }), "utf-8");

    const { config } = loadConfig(root);
    const services = detectServices(root, config);
    expect(services.isMonorepo).toBe(true);
    expect(services.services.map((service) => service.name).sort()).toEqual(["api", "web"]);
    expect(services.services.every((service) => service.rootPath === root)).toBe(true);
    expect(services.rootChecks.length).toBeGreaterThan(0);
  });
});
