import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildSpecGuide, specGuideToText } from "../src/guide.js";
import { scaffoldSpec, scaffoldToText } from "../src/scaffold.js";

const roots: string[] = [];

function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("specGuideToText", () => {
  it("renders workflow, section examples, and glossary text", () => {
    const guide = buildSpecGuide();
    const text = specGuideToText(guide);

    expect(text).toContain("spec-check Spec Writing Guide");
    expect(text).toContain("WORKFLOW");
    expect(text).toContain("intent.md  (G1");
    expect(text).toContain("✅ CORRECT:");
    expect(text).toContain("❌ INCORRECT:");
    expect(text).toContain("CROSS-CUTTING RULES");
    expect(text).toContain("GATE STATUS GLOSSARY");
  });
});

describe("scaffoldSpec", () => {
  it("writes missing spec templates and skips existing files", () => {
    const root = makeTmp("spec-check-scaffold-");
    mkdirSync(join(root, "stories"), { recursive: true });
    writeFileSync(join(root, "stories", "010-existing.md"), "# Story 010\n", "utf-8");
    writeFileSync(join(root, "README.md"), "# Demo Project\n\nA short summary paragraph.\n", "utf-8");

    const result = scaffoldSpec(root, undefined, true);

    expect(result.source_title).toBe("Demo Project");
    expect(result.skipped_existing).toContain("stories/001-initial-story.md");
    expect(existsSync(join(root, "prd", "001-initial-feature.md"))).toBe(true);
    expect(existsSync(join(root, "adr", "001-initial-decision.md"))).toBe(true);
    expect(existsSync(join(root, "tasks.md"))).toBe(true);
  });
});

describe("scaffoldToText", () => {
  it("renders status, guidance, workflow, and notes blocks", () => {
    const text = scaffoldToText({
      project_path: "/tmp/demo",
      source_used: "/tmp/demo/README.md",
      source_title: "Demo",
      files: [
        {
          filename: "stories/001-initial-story.md",
          path: "/tmp/demo/stories/001-initial-story.md",
          exists: false,
          written: true,
          content: "# Story",
          guidance: ["S-1 guidance"],
          common_violations: ["S-6 violation"],
        },
      ],
      skipped_existing: ["tasks.md"],
      suggested_workflow: ["1. Do the thing"],
      notes: ["A note"],
    });

    expect(text).toContain("scaffold_spec result");
    expect(text).toContain("stories/001-initial-story.md  [✅ written]");
    expect(text).toContain("Guidance:");
    expect(text).toContain("Common violations to avoid:");
    expect(text).toContain("Suggested workflow:");
    expect(text).toContain("Skipped (already exist): tasks.md");
    expect(text).toContain("Notes:");
  });
});
