// spec-check — Story 023: scaffold_spec
// Generates spec file templates for a project, optionally populated from an
// existing PRD or README. Files are never overwritten; write:true only creates
// files that do not yet exist.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";

export interface ScaffoldedFile {
  filename: string;
  path: string;
  exists: boolean;
  written: boolean;
  content: string;
  guidance: string[];
  common_violations: string[];
}

export interface ScaffoldResult {
  project_path: string;
  source_used: string | null;
  source_title: string | null;
  files: ScaffoldedFile[];
  skipped_existing: string[];
  suggested_workflow: string[];
  notes: string[];
}

// ─── Source document detection ────────────────────────────────────────────────

const SOURCE_CANDIDATES = [
  "PRD.md", "prd.md",
  "README.md", "Readme.md", "readme.md",
  "docs/prd/*.md",
  "docs/PRD.md", "docs/prd.md",
  "SPEC.md", "spec.md",
];

function detectSource(projectRoot: string, hint?: string): string | null {
  if (hint) {
    const abs = resolve(hint);
    return existsSync(abs) ? abs : null;
  }
  for (const candidate of SOURCE_CANDIDATES) {
    if (candidate.includes("*")) {
      // Glob pattern — scan directory
      const dir = join(projectRoot, dirname(candidate));
      if (existsSync(dir)) {
        try {
          const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
          if (files.length > 0) return join(dir, files[0]!);
        } catch { /* skip */ }
      }
    } else {
      const abs = join(projectRoot, candidate);
      if (existsSync(abs)) return abs;
    }
  }
  return null;
}

function extractSourceTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1]!.trim() : null;
}

function extractSourceSummary(content: string): string {
  // Try to get the first non-heading, non-empty paragraph
  const lines = content.split("\n");
  const paragraphLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.trim() === "") {
      if (paragraphLines.length > 0) break;
      continue;
    }
    paragraphLines.push(line.trim());
  }
  return paragraphLines.join(" ").slice(0, 300) || "a project";
}

// ─── Template builders ────────────────────────────────────────────────────────

function buildIntentTemplate(projectTitle: string, sourceSummary: string): string {
  return `# Intent

## Problem

The problem is that [PLACEHOLDER: describe the core user pain point in 1-2 specific sentences.
What breaks, fails, or is missing? Who is harmed and how? Be concrete.].

[PLACEHOLDER: 1-2 sentences explaining why existing approaches are inadequate or make things worse.
What specifically fails about the status quo?].

## Why this must be solved [PLACEHOLDER: replace with the specific constraint, e.g. "locally", "in the browser", "without a server"]

Because [PLACEHOLDER: the causal reason the solution must take this particular form — what property
of the problem forces the design choice]. Therefore, [PLACEHOLDER: the logical conclusion that
rules out alternatives and leads to the intended approach].

## Intent

Build [PLACEHOLDER: describe what you are building at the level of purpose, not technology].
The [PLACEHOLDER: tool/service/application] must [PLACEHOLDER: describe the primary capability].
It should also [PLACEHOLDER: describe a secondary, verifiable guarantee — something users can
confirm themselves].

## What this is not

This is not [PLACEHOLDER: the most obvious wrong interpretation — a cloud service, a desktop app, a CLI, etc.].
This is not [PLACEHOLDER: an adjacent feature that is explicitly out of scope for v1].
This is not [PLACEHOLDER: a third boundary — e.g. not an editor, not a format converter].

## Constraints

- [PLACEHOLDER: the most important non-negotiable property — often a security or privacy bound]
- [PLACEHOLDER: a second hard constraint — often a performance or deployment requirement]
- [PLACEHOLDER: a third constraint — often an offline or compatibility requirement]
- Output must be verifiable: [PLACEHOLDER: describe how a user can independently confirm it works]

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | [PLACEHOLDER: state as uncertain — use "assumed", "inferred", "not yet confirmed"] | [PLACEHOLDER: why you believe this is currently true] | [PLACEHOLDER: what breaks and what the fallback would be] |
| A2 | [PLACEHOLDER: a second assumption] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact] |
| A3 | [PLACEHOLDER: a third assumption] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact] |
`;
}

function buildRequirementsTemplate(projectTitle: string): string {
  return `# Requirements

## Feature F-1: [PLACEHOLDER: first major capability area, e.g. "File Input"]

### Rule R-1: Validate [PLACEHOLDER: the condition that must be true, e.g. "accepted file types are limited to supported formats"]
Example: [PLACEHOLDER: name the happy-path scenario]
  Given [PLACEHOLDER: describe the pre-existing state — NOT an action. "a file with extension .jpg in the input" not "the user drops a file"]
  When [PLACEHOLDER: the single action that triggers this behaviour]
  Then [PLACEHOLDER: the observable result — what a user or test can see/verify]

Example: [PLACEHOLDER: name the rejection or error scenario — every Rule needs one]
  Given [PLACEHOLDER: describe the state that should trigger rejection]
  When [PLACEHOLDER: the triggering action]
  Then [PLACEHOLDER: the rejection is visible — error message, absent element, blocked action]
  And [PLACEHOLDER: any additional observable consequence]

### Rule R-2: Validate [PLACEHOLDER: a second condition for this Feature]
Example: [PLACEHOLDER: positive case]
  Given [PLACEHOLDER: state description]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: observable outcome]

Example: [PLACEHOLDER: negative case — rejection, error, or edge case failure]
  Given [PLACEHOLDER: state that triggers the failure path]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: the visible rejection or error]

---

## Feature F-2: [PLACEHOLDER: second capability area]

### Rule R-3: Validate [PLACEHOLDER: condition]
Example: [PLACEHOLDER: positive case]
  Given [PLACEHOLDER: state]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: observable result]

Example: [PLACEHOLDER: negative case]
  Given [PLACEHOLDER: state]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: observable rejection]

---

## Feature F-3: [PLACEHOLDER: third capability area — add more Feature sections as needed]

### Rule R-4: Validate [PLACEHOLDER: condition]
Example: [PLACEHOLDER: positive case]
  Given [PLACEHOLDER: state]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: result]

Example: [PLACEHOLDER: negative case]
  Given [PLACEHOLDER: state]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: rejection]

---

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | [PLACEHOLDER: uncertainty about a user behaviour or platform capability] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact and fallback] |
| A2 | [PLACEHOLDER: uncertainty about a third-party API or format] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact] |
`;
}

function buildDesignTemplate(projectTitle: string, featureIds: string[]): string {
  const refs = featureIds.length > 0
    ? featureIds.map((f, i) => `Feature ${f} ([PLACEHOLDER: feature name])`).join(", ")
    : "Feature F-1 ([PLACEHOLDER: name]), Feature F-2 ([PLACEHOLDER: name]), Feature F-3 ([PLACEHOLDER: name])";

  const traceRows = featureIds.length > 0
    ? featureIds.map((_, i) => {
        const ruleN = `R-${i + 1}`;
        return `| ${ruleN}  | [PLACEHOLDER: criterion description] | [PLACEHOLDER: component name — ComponentName → method()] |`;
      }).join("\n")
    : [
        "| R-1  | [PLACEHOLDER: criterion] | [PLACEHOLDER: ComponentName → implementation detail] |",
        "| R-2  | [PLACEHOLDER: criterion] | [PLACEHOLDER: ComponentName → implementation detail] |",
        "| R-3  | [PLACEHOLDER: criterion] | [PLACEHOLDER: ComponentName → implementation detail] |",
      ].join("\n");

  return `# Design

References: ${refs}

## Requirement Traceability

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
${traceRows}

## Components

\`\`\`
[PLACEHOLDER: ASCII diagram of main components and their relationships]

┌────────────────────────────────────────────────────┐
│              [PLACEHOLDER: top-level context]       │
│                                                    │
│  ┌──────────────────┐   ┌────────────────────────┐  │
│  │ [Component Name] │ → │  [Component Name]      │  │
│  │                  │   │                        │  │
│  └──────────────────┘   └────────────────────────┘  │
└────────────────────────────────────────────────────┘
\`\`\`

## [PLACEHOLDER: Component 1 Name]

[PLACEHOLDER: 2-3 sentences describing what this component does, what inputs it receives,
what outputs it produces, and which requirements it satisfies. Use vocabulary like
"module", "component", "API", "layer", "interface", "handler".]

**Key design decisions:**
- [PLACEHOLDER: why this approach was chosen over alternatives]
- [PLACEHOLDER: a constraint or limitation the design accepts]

## [PLACEHOLDER: Component 2 Name]

[PLACEHOLDER: description of this component's responsibility, interface, and design decisions.]

## [PLACEHOLDER: Component 3 Name — add more sections as needed]

[PLACEHOLDER: description.]

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | [PLACEHOLDER: a technical assumption about platform, dependency, or performance] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact and fallback] |
| A2 | [PLACEHOLDER: a second technical assumption] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact] |
`;
}

function buildTasksTemplate(projectTitle: string): string {
  return `# Tasks

## [PLACEHOLDER: Milestone or story name, e.g. "Milestone M1 — Core Implementation"]

- [ ] [PLACEHOLDER: specific atomic task — one deliverable only, no "and"] (Rule: [PLACEHOLDER: rule name or ID this task satisfies])
- [ ] [PLACEHOLDER: another atomic task — describes a single concrete deliverable] (Rule: [PLACEHOLDER: rule name])
- [ ] [PLACEHOLDER: another atomic task] (Rule: [PLACEHOLDER: rule name])

## [PLACEHOLDER: Milestone M2 — second phase]

- [ ] [PLACEHOLDER: atomic task] (Rule: [PLACEHOLDER: rule name])
- [ ] [PLACEHOLDER: atomic task] (Rule: [PLACEHOLDER: rule name])

## [PLACEHOLDER: Milestone M3 — third phase, add as many as needed]

- [ ] [PLACEHOLDER: atomic task] (Rule: [PLACEHOLDER: rule name])
- [ ] [PLACEHOLDER: atomic task] (Rule: [PLACEHOLDER: rule name])

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | [PLACEHOLDER: milestones can be completed in order without interdependency blockers] | [PLACEHOLDER: basis — e.g. each milestone is a self-contained increment] | [PLACEHOLDER: if wrong, reorder or parallelize tasks] |
| A2 | [PLACEHOLDER: development environment and toolchain availability] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact] |
`;
}

// ─── File guidance and violation data ────────────────────────────────────────

const FILE_META: Record<string, { guidance: string[]; violations: string[] }> = {
  "intent.md": {
    guidance: [
      "I-1: File must be named intent.md (also accepted: INTENT.md, proposal.md, WHY.md)",
      "I-2: Must contain causal language — the checker looks for: 'because', 'in order to', 'so that', 'the problem is', 'forces', 'enables', 'requires', 'therefore'",
      "I-3: Must contain constraint language — 'must', 'only', 'required', 'no', 'never', 'prohibited'",
      "I-4: Open the Problem section with 'The problem is that...' — problem language must precede solution language",
      "I-5: No PascalCase API names (IndexedDB, localStorage), no framework names, no snake_case_3_segment identifiers in Problem or Intent sections",
      "I-6: ## Assumptions section must contain a table with columns: # | Assumption | Basis | Impact if wrong",
    ],
    violations: [
      "Opening with the solution instead of the problem ('Build an app that...' vs 'The problem is that...')",
      "Using technology names like 'IndexedDB', 'localStorage', 'React', 'Express' in the Problem or Intent section",
      "Assumptions written as prose instead of the four-column table",
      "Missing causal connectors — the checker looks for specific signal words, not just general problem language",
    ],
  },
  "requirements.md": {
    guidance: [
      "R-2: Structure must be: ## Feature F-N → ### Rule R-N: Validate ... → Example: ... Given/When/Then",
      "R-3: Every Rule heading must start with an imperative verb: 'Validate', 'Ensure', 'Reject', 'Require', 'Confirm'",
      "R-5/R-6: Every Feature must have at least one Example with rejection/error/failure language",
      "R-7: GIVEN steps must describe state, not actions — avoid: 'drops', 'clicks', 'selects', 'submits', 'types'; avoid the word 'type' (can be detected as action verb)",
      "R-9: THEN steps must describe externally observable output — not 'the database contains', 'the flag is set', 'the variable is updated'",
      "R-10: No PascalCase identifiers or specific API names in requirement text",
      "End: ## Assumptions table with four columns",
    ],
    violations: [
      "R-6: No negative examples for one or more Features — every Feature needs at least one rejection/error Example",
      "R-7: Action verbs in GIVEN ('the user drops a file', 'the user selects files') — describe the state instead",
      "R-7: The word 'type' in GIVEN (as in 'MIME type') can be flagged — use 'format' or 'content format' instead",
      "R-9: THEN describes internal state rather than observable output",
      "R-10: Mentioning API names like 'DateTimeOriginal', 'localStorage' directly in requirement text",
    ],
  },
  "design.md": {
    guidance: [
      "D-1: File must be named design.md (also accepted: architecture.md, or an adr/ directory)",
      "D-2: CRITICAL — First line after title must be: 'References: Feature F-1 (name), Feature F-2 (name), ...' listing ALL features",
      "D-2: Must contain a '## Requirement Traceability' table with columns: Rule | Criterion | Satisfied By",
      "D-3: Use component vocabulary — 'component', 'module', 'service', 'API', 'layer', 'interface', 'gateway', 'handler'",
      "D-5: ## Assumptions table with four columns",
    ],
    violations: [
      "D-2: Missing the 'References: Feature F-N...' line — this is the most common first-run failure for design.md",
      "D-2: Requirement Traceability table missing or not using Rule IDs from requirements.md",
      "D-3: No component vocabulary in the design description",
    ],
  },
  "tasks.md": {
    guidance: [
      "T-1: File must contain at least one markdown checkbox: - [ ] task description",
      "T-2: Every task must be ATOMIC — 'and' joining two verb phrases fails (e.g. 'Create X and configure Y')",
      "T-3: Every task must trace to a Rule — include '(Rule: rule-name)' at the end of each task",
      "T-4: Tasks must be specific — more than a few words; 'Set up project' is too vague",
      "T-5: ## Assumptions section (can be a short table — 2-3 rows is fine)",
    ],
    violations: [
      "T-2: Tasks like 'Add X and implement Y' — split into two separate tasks",
      "T-5: Missing ## Assumptions section — the most frequent G4 failure after T-2",
      "T-3: Tasks that describe what to build but don't reference a Rule or Feature",
    ],
  },
};

// ─── Main export ──────────────────────────────────────────────────────────────

const SPEC_FILES = ["intent.md", "requirements.md", "design.md", "tasks.md"] as const;

export function scaffoldSpec(
  projectRoot: string,
  sourceHint?: string,
  write = false
): ScaffoldResult {
  const absRoot = resolve(projectRoot);
  const sourcePath = detectSource(absRoot, sourceHint);

  let sourceContent = "";
  let sourceTitle: string | null = null;

  if (sourcePath) {
    try {
      sourceContent = readFileSync(sourcePath, "utf8");
      sourceTitle = extractSourceTitle(sourceContent);
    } catch { /* ignore read errors */ }
  }

  const sourceSummary = sourceContent
    ? extractSourceSummary(sourceContent)
    : "your project";

  const projectTitle = sourceTitle ?? "Your Project";

  const skippedExisting: string[] = [];
  const files: ScaffoldedFile[] = [];
  const notes: string[] = [];

  for (const filename of SPEC_FILES) {
    const filePath = join(absRoot, filename);
    const exists = existsSync(filePath);

    let content = "";
    if (filename === "intent.md") {
      content = buildIntentTemplate(projectTitle, sourceSummary);
    } else if (filename === "requirements.md") {
      content = buildRequirementsTemplate(projectTitle);
    } else if (filename === "design.md") {
      // Extract feature IDs from requirements if it already exists
      const featureIds: string[] = [];
      const reqPath = join(absRoot, "requirements.md");
      if (existsSync(reqPath)) {
        const reqContent = readFileSync(reqPath, "utf8");
        const matches = reqContent.matchAll(/##\s+Feature\s+(F-\d+)/g);
        for (const m of matches) featureIds.push(m[1]!);
      }
      if (featureIds.length === 0) featureIds.push("F-1", "F-2", "F-3");
      content = buildDesignTemplate(projectTitle, featureIds);
    } else if (filename === "tasks.md") {
      content = buildTasksTemplate(projectTitle);
    }

    const meta = FILE_META[filename]!;

    let written = false;
    if (!exists) {
      if (write) {
        try {
          mkdirSync(absRoot, { recursive: true });
          writeFileSync(filePath, content, "utf8");
          written = true;
        } catch (err) {
          notes.push(`Could not write ${filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      skippedExisting.push(filename);
    }

    files.push({
      filename,
      path: filePath,
      exists,
      written,
      content: exists ? "" : content, // Don't return existing file content — the LLM should read it separately
      guidance: meta.guidance,
      common_violations: meta.violations,
    });
  }

  if (sourcePath) {
    notes.push(`Source document used for context: ${sourcePath}`);
  } else {
    notes.push("No PRD or README found — templates use generic placeholders. Provide a 'source' path for better context.");
  }

  if (skippedExisting.length > 0) {
    notes.push(`Existing files were not modified: ${skippedExisting.join(", ")}. Review them with gate_check to see what needs fixing.`);
  }

  const workflow = [
    "1. Review each template file and replace all [PLACEHOLDER: ...] markers with project-specific content",
    "2. For intent.md: open with 'The problem is that...' and ensure your problem precedes any solution language",
    "3. For requirements.md: add at least one negative (rejection/error) Example per Feature section",
    "4. For design.md: fill in all Feature IDs in the References line and complete the Requirement Traceability table",
    "5. For tasks.md: ensure each task has a '(Rule: ...)' reference and no task joins two work items with 'and'",
    "6. Call run_all(path) to validate all five gates",
    "7. Work through the 'next_steps' in the output — fix each violation then re-run",
    "8. Gate G5 will BLOCK until test files exist — this is expected for a pre-implementation project",
    "9. Add test files when you begin implementation, then run_all again to confirm G5 passes",
  ];

  return {
    project_path: absRoot,
    source_used: sourcePath,
    source_title: sourceTitle,
    files,
    skipped_existing: skippedExisting,
    suggested_workflow: workflow,
    notes,
  };
}

export function scaffoldToText(result: ScaffoldResult): string {
  const lines: string[] = [];

  lines.push("scaffold_spec result");
  lines.push("═".repeat(70));
  lines.push(`Project: ${result.project_path}`);
  if (result.source_used) lines.push(`Source:  ${result.source_used}${result.source_title ? ` (${result.source_title})` : ""}`);
  lines.push("");

  for (const file of result.files) {
    const status = file.exists
      ? "already exists — skipped"
      : file.written
      ? "✅ written"
      : "template ready (call with write:true to write to disk)";
    lines.push(`${file.filename}  [${status}]`);
    lines.push("  Guidance:");
    for (const g of file.guidance) lines.push(`    • ${g}`);
    lines.push("  Common violations to avoid:");
    for (const v of file.common_violations) lines.push(`    ⚠ ${v}`);
    lines.push("");
  }

  if (result.skipped_existing.length > 0) {
    lines.push(`Skipped (already exist): ${result.skipped_existing.join(", ")}`);
    lines.push("");
  }

  lines.push("Suggested workflow:");
  for (const step of result.suggested_workflow) lines.push(`  ${step}`);
  lines.push("");

  if (result.notes.length > 0) {
    lines.push("Notes:");
    for (const note of result.notes) lines.push(`  • ${note}`);
  }

  return lines.join("\n");
}
