import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveCliCommand } from "../src/cli.js";
import { resolveDashboardOptions } from "../src/dashboard.js";
import { executeToolRequest, TOOL_DEFINITIONS } from "../src/index.js";
import { canonicalProjectPath, getRegisteredProject, listRegisteredProjects, registerProject } from "../src/project_registry.js";

const roots: string[] = [];
const originalHome = process.env.HOME;

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function makeSpecProject(prefix: string): string {
  const root = makeRoot(prefix);
  writeFileSync(join(root, "intent.md"), "# Intent\n", "utf-8");
  writeFileSync(join(root, "requirements.md"), "# Requirements\n", "utf-8");
  writeFileSync(join(root, "design.md"), "# Design\n", "utf-8");
  writeFileSync(join(root, "tasks.md"), "# Tasks\n", "utf-8");
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests", "placeholder.test.ts"), "it('R-60 placeholder', () => {});\n", "utf-8");
  return root;
}

afterEach(() => {
  process.env.HOME = originalHome;
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime interoperability", () => {
  it("R-60 and R-62 route the default CLI command to MCP mode and the server subcommand to daemon mode", () => {
    expect(resolveCliCommand([])).toEqual({ mode: "mcp", rest: [] });
    expect(resolveCliCommand(["server", "--port=9999"])).toEqual({ mode: "server", rest: ["--port=9999"] });
  });

  it("R-61 resolves daemon host to loopback by default", () => {
    const options = resolveDashboardOptions([], {});
    expect(options.host).toBe("127.0.0.1");
    expect(options.port).toBe(4319);
  });

  it("R-63 exposes the HTTP tool catalog from the same MCP tool definitions", () => {
    const tool = TOOL_DEFINITIONS.find((entry) => entry.name === "run_all");
    expect(tool).toBeTruthy();
    expect(tool?.inputSchema.required).toContain("path");
  });

  it("R-64 and R-65 execute a tool through the shared runtime and preserve explicit actor identity", async () => {
    const response = await executeToolRequest("get_protocol", {
      format: "json",
      llm: "gpt-5",
      agent_id: "agent-http",
      session_id: "session-http",
    });
    const parsed = JSON.parse(response.content[0]!.text) as { meta: { llm_id: string; agent_id: string; session_id: string } };
    expect(parsed.meta.llm_id).toBe("gpt-5");
    expect(parsed.meta.agent_id).toBe("agent-http");
    expect(parsed.meta.session_id).toBe("session-http");
  });

  it("R-66 registers a project with a stable identifier and persists it locally", () => {
    const home = makeRoot("spec-check-home-");
    const project = makeSpecProject("spec-check-project-");
    process.env.HOME = home;

    const registered = registerProject(project, "Auth Service");
    const canonical = canonicalProjectPath(project);
    expect(registered.project_id).toBe("auth-service");
    expect(getRegisteredProject("auth-service")?.path).toBe(canonical);
    expect(listRegisteredProjects()).toHaveLength(1);

    const registryPath = join(home, ".spec-check", "projects.json");
    expect(JSON.parse(readFileSync(registryPath, "utf8")).projects[0].project_id).toBe("auth-service");
  });

  it("R-66 canonical path prevents duplicate registrations for equivalent paths", () => {
    const home = makeRoot("spec-check-home-");
    const project = makeSpecProject("spec-check-project-");
    process.env.HOME = home;

    const first = registerProject(project, "my-service");
    const second = registerProject(project, "my-service");
    expect(first.project_id).toBe(second.project_id);
    expect(listRegisteredProjects()).toHaveLength(1);
  });

  it("R-66 rejects registration of a nonexistent path", () => {
    const home = makeRoot("spec-check-home-");
    process.env.HOME = home;
    expect(() => registerProject("/nonexistent/path/that/does/not/exist", "ghost")).toThrow();
  });

  it("R-61 daemon does not bind to 0.0.0.0 by default", () => {
    const options = resolveDashboardOptions([], {});
    expect(options.host).not.toBe("0.0.0.0");
  });

  it("R-64 returns structured error for unknown tool name", async () => {
    const response = await executeToolRequest("no_such_tool", {});
    const parsed = JSON.parse(response.content[0]!.text) as { data: { code: string } };
    expect(parsed.data.code).toBe("UNKNOWN_TOOL");
  });

  it("R-67 resolves project_id to its canonical path", () => {
    const home = makeRoot("spec-check-home-");
    const project = makeSpecProject("spec-check-project-");
    process.env.HOME = home;

    registerProject(project, "spec-check-test");
    const canonical = canonicalProjectPath(project);
    const found = getRegisteredProject("spec-check-test");
    expect(found).not.toBeNull();
    expect(found?.path).toBe(canonical);
  });

  it("R-67 rejects unknown registered projects and R-68 keeps distinct registrations isolated", () => {
    const home = makeRoot("spec-check-home-");
    const projectA = makeSpecProject("spec-check-project-a-");
    const projectB = makeSpecProject("spec-check-project-b-");
    process.env.HOME = home;

    registerProject(projectA, "alpha");
    registerProject(projectB, "beta");

    expect(getRegisteredProject("missing")).toBeNull();
    expect(listRegisteredProjects().map((project) => project.project_id).sort()).toEqual(["alpha", "beta"]);
    expect(listRegisteredProjects().map((project) => project.path).sort()).toEqual([
      canonicalProjectPath(projectA),
      canonicalProjectPath(projectB),
    ].sort());
  });

  it("query tool is registered and accessible via executeToolRequest", async () => {
    // Verify tool definition is present
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "query");
    expect(tool).toBeTruthy();
    expect((tool?.inputSchema as { required: string[] }).required).toContain("sql");

    // Simple SELECT without spec_records (no Parquet files needed)
    const response = await executeToolRequest("query", { sql: "SELECT 42 AS answer" });
    const parsed = JSON.parse(response.content[0]!.text) as { data: Array<{ answer: number }> };
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(Number(parsed.data[0]?.answer)).toBe(42);
  });

  it("query tool rejects non-SELECT statements", async () => {
    const response = await executeToolRequest("query", { sql: "DROP TABLE foo" });
    const parsed = JSON.parse(response.content[0]!.text) as { data: { code: string } };
    expect(parsed.data.code).toBe("QUERY_ERROR");
  });

  it("query tool supports table format output", async () => {
    const response = await executeToolRequest("query", { sql: "SELECT 1 AS n", format: "table" });
    const parsed = JSON.parse(response.content[0]!.text) as { data: string };
    expect(typeof parsed.data).toBe("string");
    expect(parsed.data).toContain("n");
    expect(parsed.data).toContain("1");
  });

  it("query tool supports csv format output", async () => {
    const response = await executeToolRequest("query", { sql: "SELECT 'hello' AS word, 42 AS num", format: "csv" });
    const parsed = JSON.parse(response.content[0]!.text) as { data: string };
    expect(typeof parsed.data).toBe("string");
    expect(parsed.data).toContain("word,num");
    expect(parsed.data).toContain("hello,42");
  });

  it("resolveCliCommand returns mcp mode for all non-server subcommands", () => {
    expect(resolveCliCommand([])).toEqual({ mode: "mcp", rest: [] });
    expect(resolveCliCommand(["gate", "G1", "--path", "."])).toEqual({ mode: "mcp", rest: ["gate", "G1", "--path", "."] });
  });
});
