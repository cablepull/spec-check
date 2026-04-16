// spec-check — Story 024: Spec Writing Guide
// Returns a structured reference that teaches an LLM to write passing spec files
// on the first attempt. Pure data module — no file I/O.

export interface GuideExample {
  label: string;
  correct: string;
  incorrect: string;
  why: string;
}

export interface GuideSection {
  file: string;
  gate: string;
  gate_name: string;
  summary: string;
  rules: string[];
  examples: GuideExample[];
  common_violations: string[];
}

export interface SpecGuide {
  quick_start: string;
  workflow: string[];
  sections: GuideSection[];
  cross_cutting: string[];
  gate_status_glossary: string[];
}

// ─── Quick-start diagram ──────────────────────────────────────────────────────

const QUICK_START = `
spec-check workflow for a new project
──────────────────────────────────────────────────────────────────────────────

  scaffold_spec(path)               ← call this first on any new project
       │
       ▼
  write intent.md          G1 checks: problem language, causal/constraint,
  write requirements.md    G2 checks: Feature→Rule→Example, GWT structure,
  write design.md                     positive + negative examples
  write tasks.md           G3 checks: traceability to requirements
                           G4 checks: atomic tasks, Rule references
       │
       ▼
  run_all(path)             ← runs G1→G5 in sequence, stops at first BLOCK
       │
       ├─ PASS              ← all five gates green; proceed to implementation
       ├─ FAILING           ← one or more VIOLATION; fix the listed criteria
       ├─ PASSING_WITH_WARNINGS ← advisory issues; may proceed but should fix
       └─ BLOCKED           ← a required file or section is missing entirely
              │
              ▼
         fix violations (see next_steps in run_all output)
              │
              ▼
         run_all again … repeat until PASS
              │
              ▼
  Gate G5 (Executability) will BLOCK until test files exist.
  Write tests → run_all → PASS → begin implementation.

──────────────────────────────────────────────────────────────────────────────
`.trim();

// ─── Workflow steps ───────────────────────────────────────────────────────────

const WORKFLOW = [
  "1. Call scaffold_spec(path) to generate template files for this project",
  "2. Fill in [PLACEHOLDER] markers in each file using the project's PRD or README as source",
  "3. Call run_all(path) to check all five gates",
  "4. Read the 'next_steps' in the output — each item names the criterion ID and the fix",
  "5. Edit the relevant file, then call run_all again",
  "6. Repeat until G1–G4 all show PASS (G5 will BLOCK until test files exist — that is expected)",
  "7. Write test files, call run_all, confirm G5 passes, then begin implementation",
  "8. After each code change, call run_all again to confirm spec integrity is maintained",
];

// ─── Per-file sections ────────────────────────────────────────────────────────

const SECTIONS: GuideSection[] = [
  {
    file: "intent.md",
    gate: "G1",
    gate_name: "Intent Valid",
    summary:
      "Explains WHY this project exists, what problem it solves, and what the solution must NOT be. " +
      "Starts with the problem, ends with a one-paragraph intent statement. No implementation names.",
    rules: [
      "I-1: The file must exist. Accepted names: intent.md, INTENT.md, proposal.md, WHY.md",
      "I-2: Must contain causal language — 'because', 'in order to', 'so that', 'the problem is', 'forces', 'enables', 'requires', 'therefore'",
      "I-3: Must contain constraint language — 'must', 'only', 'required', 'no', 'never', 'prohibited'",
      "I-4: The Problem section must come BEFORE any solution language. Open with 'The problem is that...'",
      "I-5: No PascalCase identifiers (e.g. IndexedDB), no snake_case with 3+ segments, no framework names in the Problem and Intent sections",
      "I-6: Must contain an ## Assumptions section with a table: | # | Assumption | Basis | Impact if wrong |",
    ],
    examples: [
      {
        label: "I-2 / I-4 — Problem-first with causal language",
        correct:
          "The problem is that users unknowingly share GPS coordinates embedded in their photos.\n" +
          "Because no trustworthy local tool exists, they must rely on cloud services that create a\n" +
          "secondary privacy exposure. Therefore the solution must run entirely in the browser.",
        incorrect:
          "CleanShot strips EXIF data from images using WebAssembly. The app runs in the browser\n" +
          "with no server required. Users drag and drop files to clean them.",
        why:
          "The incorrect version opens with the solution, not the problem. " +
          "I-4 requires problem language to appear before solution language. " +
          "The correct version opens with 'The problem is' (I-2 causal signal) and explains WHY before HOW.",
      },
      {
        label: "I-5 — No implementation identifiers in Problem/Intent",
        correct:
          "The solution must use no persistent browser storage after the tab is closed.",
        incorrect:
          "The solution must not write to localStorage, IndexedDB, or Cache API.",
        why:
          "PascalCase identifiers like 'IndexedDB' and specific API names trigger I-5. " +
          "In intent.md, describe the PROPERTY ('no persistent storage') not the mechanism ('IndexedDB'). " +
          "Implementation names belong in design.md.",
      },
      {
        label: "I-6 — Assumptions table format",
        correct:
          "## Assumptions\n\n" +
          "| # | Assumption | Basis | Impact if wrong |\n" +
          "|---|-----------|-------|------------------|\n" +
          "| A1 | Target browsers support WebAssembly | MDN compatibility tables 2026 | JS fallback required |",
        incorrect:
          "## Assumptions\n\nWe assume all modern browsers support WebAssembly.",
        why:
          "I-6 requires the table with all four columns. Prose assumptions without the table structure will FAIL.",
      },
    ],
    common_violations: [
      "Opening the file with the solution ('Build an app that...') instead of the problem ('The problem is that...')",
      "Using PascalCase API names (localStorage, IndexedDB, XMLHttpRequest) in the Problem section",
      "Omitting causal connectors — the checker looks for specific signal words",
      "Assumptions written as prose instead of the four-column table format",
      "The 'What this is not' section is optional but strongly recommended for I-5 disambiguation",
    ],
  },

  {
    file: "requirements.md",
    gate: "G2",
    gate_name: "Requirements Valid",
    summary:
      "Structured behavioural requirements in Feature → Rule → Example (Given/When/Then) hierarchy. " +
      "Every Rule needs both a positive and a negative Example. GIVEN describes state; THEN is observable.",
    rules: [
      "R-2: Must have Feature F-N headings with Rule R-N sub-headings and Example blocks",
      "R-3: Each Rule heading must start with an imperative verb: 'Validate', 'Ensure', 'Reject', 'Require'",
      "R-4: Examples must use Given/When/Then (or Given/When/And/Then) structure",
      "R-5 / R-6: Every Feature must have at least one negative Example (rejection, error, or failure path)",
      "R-7: GIVEN steps describe pre-existing STATE — no action verbs (clicks, drops, selects, submits, types, navigates)",
      "R-8: Rules must not be compound — no 'and' joining two separate behaviours in one Rule",
      "R-9: THEN steps must describe externally observable output — not internal state like 'the database contains' or 'the flag is set'",
      "R-10: No PascalCase identifiers or implementation-specific names in requirements text",
    ],
    examples: [
      {
        label: "R-7 — GIVEN describes state, not action",
        correct:
          "  Given a JPEG file with GPS coordinates in the drag payload\n" +
          "  When the drop event is processed\n" +
          "  Then the file is added to the processing queue",
        incorrect:
          "  Given the user drops a JPEG file onto the drop zone\n" +
          "  When the drop event fires\n" +
          "  Then the file is queued",
        why:
          "GIVEN must describe a pre-condition state, not an action. " +
          "'the user drops' contains the action verb 'drops' and will fail R-7. " +
          "'a JPEG file with GPS coordinates in the drag payload' describes what already exists.",
      },
      {
        label: "R-5 / R-6 — Every Feature needs a negative Example",
        correct:
          "Example: Valid JPEG file is accepted\n" +
          "  Given a valid JPEG image with extension .jpg in the drag payload\n" +
          "  When the drop event is processed\n" +
          "  Then the file is added to the queue\n\n" +
          "Example: Unsupported file format is rejected\n" +
          "  Given a GIF image with extension .gif in the drag payload\n" +
          "  When the drop event is processed\n" +
          "  Then the file is not added to the queue\n" +
          "  And an inline error message is displayed",
        incorrect:
          "Example: Valid JPEG file is accepted\n" +
          "  Given a valid JPEG file\n" +
          "  When dropped\n" +
          "  Then it is added to the queue\n\n" +
          "Example: Large batch of files is accepted\n" +
          "  Given 20 files\n" +
          "  When dropped\n" +
          "  Then all are queued",
        why:
          "The incorrect version has two positive examples for the same Feature. " +
          "R-6 requires at least one example that demonstrates rejection or error handling. " +
          "The checker identifies negative examples by looking for rejection/error keywords: " +
          "'rejected', 'not added', 'error', 'denied', 'invalid', 'fails', 'not found'.",
      },
      {
        label: "R-9 — THEN is observable output, not internal state",
        correct:
          "  Then the download filename shown in the browser is clean_photo_001.jpg",
        incorrect:
          "  Then the filename variable is set to clean_photo_001.jpg in memory",
        why:
          "THEN must describe something the user or system can observe externally. " +
          "Internal state (variables, memory, flags, database records) fails R-9. " +
          "Think: 'what would a user or integration test see?'",
      },
    ],
    common_violations: [
      "R-6: Having only positive (happy-path) Examples for one or more Features — every Feature needs at least one rejection/error example",
      "R-7: Using 'is dropped', 'is selected', 'is clicked', 'is submitted' in GIVEN (these are actions, not states)",
      "R-7: Using the word 'type' in GIVEN (e.g. 'MIME type') — 'type' can be flagged as an action verb; rephrase as 'format' or 'content format'",
      "R-10: Mentioning specific API names (DateTimeOriginal, localStorage, XMLHttpRequest) in requirement text",
      "R-3: Rule headings that start with nouns or adjectives instead of imperative verbs",
      "Missing ## Assumptions table at the end of the file",
    ],
  },

  {
    file: "design.md",
    gate: "G3",
    gate_name: "Design Valid",
    summary:
      "Describes HOW the system is built to satisfy the requirements. " +
      "Must reference every Feature and Rule from requirements.md. " +
      "Includes a traceability table and a component description.",
    rules: [
      "D-1: File must exist as design.md, architecture.md, or an adr/ directory",
      "D-2: Must include a References header listing all Feature IDs, AND a Requirement Traceability table mapping every Rule to a component",
      "D-3: Must contain component vocabulary — 'component', 'module', 'service', 'API', 'layer', 'interface', 'gateway', 'handler'",
      "D-4: Must not contain text that appears to contradict a requirement (checked as WARNING, not BLOCK)",
      "D-5: Must contain an ## Assumptions section with a table",
    ],
    examples: [
      {
        label: "D-2 — References header and traceability table (required structure)",
        correct:
          "# Design\n\n" +
          "References: Feature F-1 (File Input), Feature F-2 (JPEG Metadata Removal),\n" +
          "Feature F-3 (PNG Metadata Removal)\n\n" +
          "## Requirement Traceability\n\n" +
          "| Rule | Criterion | Satisfied By |\n" +
          "|------|-----------|---------------|\n" +
          "| R-1  | File types validated | File Validator — MIME allowlist |\n" +
          "| R-4  | EXIF segments removed | WASM Core → strip_jpeg() |",
        incorrect:
          "# Design\n\n" +
          "The system uses Rust/WASM for processing and a Web Worker for threading.\n\n" +
          "## Architecture\n\nFiles flow from the UI through a worker to the WASM binary.",
        why:
          "D-2 specifically looks for the References line (listing Feature IDs) and a table with " +
          "Rule IDs in the first column. Without these, D-2 fails even if the design is well-written. " +
          "The traceability table is the machine-readable part that links design to spec.",
      },
      {
        label: "D-3 — Component vocabulary",
        correct:
          "## Components\n\n" +
          "The **File Validator** component checks MIME type and file size before queuing.\n" +
          "The **WASM Core** module exposes three API functions...",
        incorrect:
          "## How it works\n\n" +
          "Files are checked and then sent to the Rust code for processing.",
        why:
          "D-3 looks for words like 'component', 'module', 'API', 'service', 'layer'. " +
          "Use these terms explicitly when describing the system parts.",
      },
    ],
    common_violations: [
      "D-2: Missing the 'References: Feature F-N...' line at the top — this is the most common first-run failure for design.md",
      "D-2: Requirement Traceability table rows that use different Rule ID format than requirements.md (must match R-N exactly)",
      "D-3: Using only plain English ('the thing that validates files') instead of component vocabulary",
      "D-5: Missing ## Assumptions table",
    ],
  },

  {
    file: "tasks.md",
    gate: "G4",
    gate_name: "Tasks Valid",
    summary:
      "Ordered checklist of atomic implementation tasks. " +
      "Each task traces to a Rule. No task joins two work items with 'and'. " +
      "Ends with an ## Assumptions section.",
    rules: [
      "T-1: File must exist with at least one markdown checkbox item (- [ ] ...)",
      "T-2: Each task must be ATOMIC — a task containing 'and' that joins two separate work items will FAIL",
      "T-3: Each task must trace to a Rule — include '(Rule: rule-name)' or a Rule ID at the end of the task",
      "T-4: Tasks must be specific — longer than a few words; 'Set up project' is too vague",
      "T-5: Must contain an ## Assumptions section",
    ],
    examples: [
      {
        label: "T-2 — Atomic tasks (no compound 'and')",
        correct:
          "- [ ] Implement MIME type validation in the File Validator (Rule: accepted file types are JPEG and PNG only)\n" +
          "- [ ] Implement file size check in the File Validator and reject files exceeding the limit (Rule: per-file size limit)",
        incorrect:
          "- [ ] Implement MIME validation and size checking in the File Validator (Rule: file input)",
        why:
          "The incorrect version joins two work items with 'and'. T-2 detects this pattern. " +
          "Note: 'and' in a title or name (e.g. 'JPEG and PNG') is fine — the check targets 'and' " +
          "that joins two verb phrases (validate AND check).",
      },
      {
        label: "T-3 — Rule traceability",
        correct:
          "- [ ] Strip all APP1 marker segments from JPEG files using the img-parts crate (Rule: all EXIF APP1 segments are removed from JPEG output)",
        incorrect:
          "- [ ] Strip EXIF from JPEG files",
        why:
          "T-3 requires each task to reference a Rule ID or Rule name. " +
          "The reference can be at the end in parentheses or inline. " +
          "Without it the task cannot be traced to a requirement.",
      },
    ],
    common_violations: [
      "T-2: Tasks like 'Create X and configure Y' or 'Add A and implement B' — split these into two separate tasks",
      "T-5: Forgetting the ## Assumptions section entirely — it is the most frequent G4 failure after T-2",
      "T-3: Tasks that describe implementation but don't reference any Rule or Feature",
      "T-4: One-line vague tasks like '- [ ] Set up project' or '- [ ] Add tests'",
    ],
  },
];

// ─── Cross-cutting rules ──────────────────────────────────────────────────────

const CROSS_CUTTING = [
  "ASSUMPTIONS TABLE: All four spec files need an ## Assumptions section with the table header '| # | Assumption | Basis | Impact if wrong |'. This is checked in G1 (I-6), G2, G3 (D-5), and G4 (T-5).",
  "ASSUMPTION PHRASING: Assumptions must be stated as uncertain — use 'assumed', 'inferred', 'based on', 'not yet confirmed'. Do NOT write assumptions as facts. 'The system will use OAuth2' fails; 'OAuth2 is assumed to be sufficient' passes.",
  "GATE SEQUENCE: Spec-check runs G1→G5 in order and stops at the first BLOCK. Fix BLOCK conditions before VIOLATION conditions. G5 always BLOCKs until test files exist — this is expected and correct on a greenfield project.",
  "FILE NAMING: intent.md (not intent.txt, not INTENT.MD), requirements.md, design.md, tasks.md. These are the canonical names; spec-check checks a few aliases but the lowercase .md form is safest.",
  "FORMAT PARAMETER: All metric tools (metrics, get_rollup, complexity, check_mutation_score) accept format: 'text' | 'json' | 'mermaid'. Use 'json' for machine-readable output, 'text' for human-readable, 'mermaid' for chart-renderable diagrams.",
  "LLM PARAMETER: Pass llm: 'your-model-id' on every tool call so spec-check can track which model produced which results. This enables the model comparison view in rollup metrics.",
  "ITERATING: After each edit, call run_all again. The output always includes a 'next_steps' array — work through it top-to-bottom. Criteria earlier in the list are usually blocking criteria for later ones.",
];

// ─── Gate status glossary ─────────────────────────────────────────────────────

const GATE_STATUS_GLOSSARY = [
  "PASS: All criteria in this gate passed. Proceed to the next gate.",
  "PASSING_WITH_WARNINGS: Gate passed but one or more advisory criteria fired. Safe to proceed; worth fixing before implementation.",
  "FAILING: One or more VIOLATION criteria fired. Must fix before this project can be considered spec-compliant.",
  "BLOCKED: A required file, section, or structure is missing entirely. Everything downstream is halted. Fix the BLOCK condition first.",
];

// ─── Public exports ───────────────────────────────────────────────────────────

export function buildSpecGuide(): SpecGuide {
  return {
    quick_start: QUICK_START,
    workflow: WORKFLOW,
    sections: SECTIONS,
    cross_cutting: CROSS_CUTTING,
    gate_status_glossary: GATE_STATUS_GLOSSARY,
  };
}

function renderIndentedBlock(lines: string[], text: string, prefix: string): void {
  for (const line of text.split("\n")) lines.push(`${prefix}${line}`);
}

function appendGuideHeader(lines: string[], guide: SpecGuide): void {
  lines.push("spec-check Spec Writing Guide");
  lines.push("═".repeat(70));
  lines.push("");
  lines.push(guide.quick_start);
  lines.push("");
}

function appendGuideWorkflow(lines: string[], workflow: string[]): void {
  lines.push("WORKFLOW");
  lines.push("─".repeat(70));
  for (const step of workflow) lines.push(`  ${step}`);
  lines.push("");
}

function appendGuideExamples(lines: string[], examples: GuideExample[]): void {
  lines.push("  Examples (correct vs incorrect):");
  for (const example of examples) {
    lines.push(`    ─── ${example.label}`);
    lines.push("    ✅ CORRECT:");
    renderIndentedBlock(lines, example.correct, "       ");
    lines.push("    ❌ INCORRECT:");
    renderIndentedBlock(lines, example.incorrect, "       ");
    lines.push("    WHY:");
    renderIndentedBlock(lines, example.why, "       ");
    lines.push("");
  }
}

function appendGuideSection(lines: string[], section: GuideSection): void {
  lines.push(`${section.file}  (${section.gate} — ${section.gate_name})`);
  lines.push("─".repeat(70));
  lines.push(section.summary);
  lines.push("");
  lines.push("  Rules:");
  for (const rule of section.rules) lines.push(`    • ${rule}`);
  lines.push("");
  appendGuideExamples(lines, section.examples);
  lines.push("  Common violations:");
  for (const violation of section.common_violations) lines.push(`    ⚠ ${violation}`);
  lines.push("");
}

function appendCrossCuttingRules(lines: string[], rules: string[]): void {
  lines.push("CROSS-CUTTING RULES (apply to all files)");
  lines.push("─".repeat(70));
  for (const rule of rules) {
    const [head, ...rest] = rule.split(": ");
    lines.push(`  ${head}:`);
    if (rest.length > 0) lines.push(`    ${rest.join(": ")}`);
    lines.push("");
  }
}

function appendGateStatusGlossary(lines: string[], glossary: string[]): void {
  lines.push("GATE STATUS GLOSSARY");
  lines.push("─".repeat(70));
  for (const entry of glossary) lines.push(`  ${entry}`);
  lines.push("");
}

export function specGuideToText(guide: SpecGuide): string {
  const lines: string[] = [];
  appendGuideHeader(lines, guide);
  appendGuideWorkflow(lines, guide.workflow);
  for (const section of guide.sections) appendGuideSection(lines, section);
  appendCrossCuttingRules(lines, guide.cross_cutting);
  appendGateStatusGlossary(lines, guide.gate_status_glossary);
  return lines.join("\n");
}
