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

function buildStoryTemplate(projectTitle: string, sourceSummary: string): string {
  return `# Story 001: [PLACEHOLDER: story title — the user need this addresses]

## Intent

The problem is that [PLACEHOLDER: describe the core user pain point. What breaks, fails, or is
missing? Who is affected and how? Be concrete].

Because [PLACEHOLDER: the causal reason this matters], users currently cannot
[PLACEHOLDER: the blocked capability or outcome].

We need this in order to [PLACEHOLDER: the value delivered when this story is done].
Only [PLACEHOLDER: the constrained scope — what is in and out] must be addressed.

## Acceptance Criteria

- [ ] [PLACEHOLDER: observable outcome a user or test can verify]
- [ ] [PLACEHOLDER: second verifiable criterion]
- [ ] [PLACEHOLDER: rejection/error case — what should NOT happen]

## ADR Required

No

## Requirements

[PLACEHOLDER: reference to PRD section, Feature ID, or Rule ID — e.g. "F-1 in prd/001-feature.md"]

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | [PLACEHOLDER: an uncertain belief about user behaviour or constraints] | [PLACEHOLDER: why you believe this] | assumed |
| A-002 | [PLACEHOLDER: a second assumption] | [PLACEHOLDER: basis] | assumed |
`;
}

function buildPrdTemplate(projectTitle: string): string {
  return `# PRD 001: [PLACEHOLDER: feature name]

## Feature F-1: [PLACEHOLDER: first major capability area, e.g. "File Input"]

### Rule R-1: Validate [PLACEHOLDER: condition that must be true]
Example: [PLACEHOLDER: happy-path scenario name]
  Given [PLACEHOLDER: pre-existing state — NOT an action]
  When [PLACEHOLDER: single triggering action]
  Then [PLACEHOLDER: observable result a user or test can verify]

Example: [PLACEHOLDER: rejection or error scenario — every Rule needs one]
  Given [PLACEHOLDER: state that triggers rejection]
  When [PLACEHOLDER: triggering action]
  Then [PLACEHOLDER: visible rejection — error message, blocked action]

### Rule R-2: Validate [PLACEHOLDER: second condition for this Feature]
Example: [PLACEHOLDER: positive case]
  Given [PLACEHOLDER: state]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: observable outcome]

Example: [PLACEHOLDER: negative case]
  Given [PLACEHOLDER: state that triggers failure]
  When [PLACEHOLDER: action]
  Then [PLACEHOLDER: visible rejection or error]

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

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | [PLACEHOLDER: uncertainty about user behaviour or platform] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact and fallback] |
| A2 | [PLACEHOLDER: uncertainty about a third-party dependency] | [PLACEHOLDER: basis] | [PLACEHOLDER: impact] |
`;
}

function buildAdrTemplate(projectTitle: string, featureIds: string[]): string {
  const traceRows = featureIds.length > 0
    ? featureIds.map((f, i) => `| R-${i + 1} | [PLACEHOLDER: criterion] | [PLACEHOLDER: component] |`).join("\n")
    : [
        "| R-1 | [PLACEHOLDER: criterion] | [PLACEHOLDER: component/module name] |",
        "| R-2 | [PLACEHOLDER: criterion] | [PLACEHOLDER: component/module name] |",
      ].join("\n");

  return `# ADR 001: [PLACEHOLDER: decision title — what was decided]

## Status

Proposed

## Context

[PLACEHOLDER: the problem or constraint that forced a decision. Reference the triggering story
or PRD feature. Use component/architectural vocabulary: service, module, API, layer, gateway.]

References: ${featureIds.length > 0 ? featureIds.map((f) => `Feature ${f}`).join(", ") : "Feature F-1, Feature F-2"}

## Decision

[PLACEHOLDER: what was decided and why. Be explicit: "We will use X because Y. This satisfies
constraint Z from requirements.md."]

## Requirement Traceability

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
${traceRows}

## Consequences

[PLACEHOLDER: what becomes easier, what becomes harder, what is accepted as a trade-off.
This section must acknowledge both positive and negative consequences.]

## Alternatives Considered

[PLACEHOLDER: what was NOT chosen and why. List at least one rejected alternative with a reason.]

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | [PLACEHOLDER: technical assumption about platform or dependency] | [PLACEHOLDER: basis] | assumed |
| A-002 | [PLACEHOLDER: a second assumption] | [PLACEHOLDER: basis] | assumed |
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
  "stories/": {
    guidance: [
      "S-1: ## Intent section must be non-empty and describe WHY the story exists",
      "S-2: ## Acceptance Criteria must contain markdown checklist items (- [ ] ...)",
      "S-3: ## Requirements must reference at least one R-N, F-N, P-N, or PRD section",
      "S-4: ## ADR Required must be 'Yes' or 'No'",
      "S-5: ## Assumptions section must be present",
      "S-6: Intent section must contain causal language: 'because', 'in order to', 'so that', 'the problem is', 'we need', 'this enables'",
      "S-7: Problem language must precede solution language in Intent",
      "S-8: No framework names, PascalCase identifiers, or SQL in Intent section",
      "S-9: Constraint language required: 'must', 'only', 'required', 'limit', 'constrain'",
    ],
    violations: [
      "S-6: Opening Intent with solution language instead of problem ('Build a...' before 'The problem is...')",
      "S-8: Naming specific frameworks (React, PostgreSQL) in the Intent section",
      "S-1: Empty or missing ## Intent section",
      "S-3: Requirements section has no traceable ID or link",
    ],
  },
  "prd/": {
    guidance: [
      "P-2: Structure must be: ## Feature F-N → ### Rule R-N: Validate ... → Example: ... Given/When/Then",
      "P-3: Every Rule heading must start with an imperative verb: 'Validate', 'Ensure', 'Reject', 'Require'",
      "P-5/P-6: Every Feature must have at least one negative/rejection Example",
      "P-7: GIVEN steps describe state, not actions — 'a user with role X' not 'the user clicks'",
      "P-9: THEN steps describe externally observable output — not internal state or database contents",
      "P-10: No PascalCase identifiers or framework names in PRD text",
      "P-11: Run compile_requirements write:true after editing prd/ files to regenerate requirements.md",
    ],
    violations: [
      "P-6: No negative examples for one or more Features",
      "P-7: Action verbs in GIVEN steps",
      "P-9: THEN describes internal state rather than observable output",
      "P-11: Forgetting to run compile_requirements after adding/editing PRD files",
    ],
  },
  "adr/": {
    guidance: [
      "A-1: Required sections: Status, Context, Decision, Consequences, Alternatives Considered, Assumptions",
      "A-2: Status must be one of: Proposed, Accepted, Superseded, Deprecated",
      "A-3: Reference the triggering story file or intent source",
      "A-4: Must reference F-N and R-N IDs from requirements.md for traceability",
      "A-5: Use component/architectural vocabulary: service, module, API, layer, gateway, pipeline",
    ],
    violations: [
      "A-1: Missing required sections (Alternatives Considered is most commonly omitted)",
      "A-4: ADR doesn't reference any F-N or R-N from requirements",
      "A-5: No architectural vocabulary in the decision text",
    ],
  },
  "tasks.md": {
    guidance: [
      "T-1: File must contain at least one markdown checkbox: - [ ] task description",
      "T-2: Every task must be ATOMIC — 'and' joining two verb phrases fails",
      "T-3: Every task must trace to a Rule or story — include '(Rule: R-N)' or '(Story: NNN)'",
      "T-4: Tasks must be specific — more than a few words; 'Set up project' is too vague",
      "T-5: ## Assumptions section (can be a short table — 2-3 rows is fine)",
    ],
    violations: [
      "T-2: Tasks like 'Add X and implement Y' — split into two separate tasks",
      "T-5: Missing ## Assumptions section — the most frequent G4 failure after T-2",
      "T-3: Tasks that describe what to build but don't reference a Rule, Feature, or Story",
    ],
  },
};

// ─── Main export ──────────────────────────────────────────────────────────────

const SPEC_FILES = ["stories", "prd", "adr", "tasks.md"] as const;

interface EntryContent {
  starterFilename: string;
  content: string;
}

function buildAdrFeatureIds(absRoot: string): string[] {
  const reqPath = join(absRoot, "requirements.md");
  if (!existsSync(reqPath)) return ["F-1", "F-2", "F-3"];
  const reqContent = readFileSync(reqPath, "utf8");
  const featureIds: string[] = [];
  for (const m of reqContent.matchAll(/##\s+Feature\s+(F-\d+)/g)) featureIds.push(m[1]!);
  return featureIds.length > 0 ? featureIds : ["F-1", "F-2", "F-3"];
}

function buildEntryContent(entry: string, absRoot: string, projectTitle: string, sourceSummary: string): EntryContent {
  if (entry === "stories") return { starterFilename: "001-initial-story.md", content: buildStoryTemplate(projectTitle, sourceSummary) };
  if (entry === "prd") return { starterFilename: "001-initial-feature.md", content: buildPrdTemplate(projectTitle) };
  if (entry === "adr") return { starterFilename: "001-initial-decision.md", content: buildAdrTemplate(projectTitle, buildAdrFeatureIds(absRoot)) };
  return { starterFilename: entry, content: buildTasksTemplate(projectTitle) };
}

interface EntryPaths {
  filePath: string;
  displayFilename: string;
  exists: boolean;
}

function resolveEntryPaths(entry: string, absRoot: string, starterFilename: string): EntryPaths {
  if (entry.includes(".")) {
    const filePath = join(absRoot, entry);
    return { filePath, displayFilename: entry, exists: existsSync(filePath) };
  }
  const dirPath = join(absRoot, entry);
  const filePath = join(dirPath, starterFilename);
  const displayFilename = `${entry}/${starterFilename}`;
  let exists = false;
  try { exists = existsSync(dirPath) && readdirSync(dirPath).some((f) => f.endsWith(".md")); } catch { /* ignore */ }
  return { filePath, displayFilename, exists };
}

function writeEntryFile(filePath: string, content: string, displayFilename: string, notes: string[]): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
    return true;
  } catch (err) {
    notes.push(`Could not write ${displayFilename}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

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

  const sourceSummary = sourceContent ? extractSourceSummary(sourceContent) : "your project";
  const projectTitle = sourceTitle ?? "Your Project";

  const skippedExisting: string[] = [];
  const files: ScaffoldedFile[] = [];
  const notes: string[] = [];

  for (const entry of SPEC_FILES) {
    const metaKey = entry.includes(".") ? entry : `${entry}/`;
    const meta = FILE_META[metaKey] ?? { guidance: [], violations: [] };
    const { starterFilename, content } = buildEntryContent(entry, absRoot, projectTitle, sourceSummary);
    const { filePath, displayFilename, exists } = resolveEntryPaths(entry, absRoot, starterFilename);

    let written = false;
    if (exists) {
      skippedExisting.push(displayFilename);
    } else if (write) {
      written = writeEntryFile(filePath, content, displayFilename, notes);
    }

    files.push({
      filename: displayFilename,
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
    "1. Fill in stories/001-initial-story.md — open Intent with 'The problem is that...' (causal language required)",
    "2. Fill in prd/001-initial-feature.md — add at least one negative Example per Feature/Rule",
    "3. Run compile_requirements with write:true to generate requirements.md from prd/",
    "4. Fill in adr/001-initial-decision.md — reference F-N / R-N IDs from requirements.md",
    "5. Fill in tasks.md — each task must include '(Rule: R-N)' and contain no 'and'-joined work items",
    "6. Call gate_check G1 through G4 iteratively — fix violations before proceeding to the next gate",
    "7. Call run_all(path) to run all five gates in sequence",
    "8. Gate G5 will BLOCK until test files exist — expected for pre-implementation projects",
    "9. Add tests/, then run_all again to confirm G5 passes and all gates are green",
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
