// Gate 4 — Tasks Valid
// Checks T-1 through T-5 against the tasks document.
// Assumption: tasks file is named tasks.md, TASKS.md, or similar under specPath.
// Assumption: tasks are markdown checkbox lines: "- [ ] ..." or "- [x] ..."
// Assumption: "traces to a rule" is detected by presence of a Rule ID (R-N, F-N, Story NNN)
//   in or immediately after the task line — checked within a 3-line window.
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { GateResult, CriterionResult, ResolvedConfig } from "../types.js";
import { detectCompoundTask } from "../nlp.js";
import { getThreshold } from "../config.js";

const TASK_NAMES = ["tasks.md", "TASKS.md", "tasks/tasks.md", "TODO.md"];

function findFile(specPath: string, names: string[]): string | null {
  for (const name of names) {
    const full = join(specPath, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function readFile(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

interface Task {
  text: string;
  lineNo: number;
  context: string; // surrounding lines for traceability check
}

function extractTasks(text: string): Task[] {
  const lines = text.split("\n");
  const tasks: Task[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match markdown checkboxes
    const m = line.match(/^\s*[-*]\s*\[[x ]\]\s*(.+)/i);
    if (m) {
      // Include ±2 lines as context for traceability scan
      const contextLines = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3));
      tasks.push({ text: m[1]!.trim(), lineNo: i + 1, context: contextLines.join(" ") });
    }
  }
  return tasks;
}

// Check if a task (or its context) traces to a known spec ID
// Covers: R-3, F-1, Story 001, story-001, Rule: story-NNN, T-2, I-2, D-3, E-2, AS-3, G1–G5
const TRACE_PATTERN = /\b(R-\d+[a-z]?|F-\d+|T-\d+|I-\d+|D-\d+|E-\d+|AS-\d+|G[1-5]|[Ss]tory[\s:-]*\d{1,3}|[Rr]ule[:\s]+[\w-]+)\b/;

function hasTraceability(task: Task): boolean {
  return TRACE_PATTERN.test(task.context) || TRACE_PATTERN.test(task.text);
}

// T-3 specificity: task text should be longer than 5 words and not vague
const VAGUE_TERMS = /^\s*(update|fix|improve|refactor|clean|misc|tbd|todo|work on)\s*$/i;
const MIN_WORDS = 5;

function isSpecific(task: Task): boolean {
  const words = task.text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < MIN_WORDS) return false;
  if (VAGUE_TERMS.test(task.text)) return false;
  return true;
}

function checkT2Compound(tasks: Task[], threshold: number): CriterionResult {
  const compound: string[] = [];
  for (const task of tasks) {
    const result = detectCompoundTask(task.text);
    if (result.matched && result.confidence >= threshold) compound.push(`Line ${task.lineNo}: ${result.evidence[0]}`);
  }
  if (compound.length > 0) {
    return { id: "T-2", status: "VIOLATION", detail: `${compound.length} task(s) are compound (contain 'and' joining two work items).`, evidence: compound.slice(0, 5), fix: "Split compound tasks: one task = one atomic deliverable." };
  }
  return { id: "T-2", status: "PASS", detail: `All ${tasks.length} task(s) are atomic.` };
}

function checkT3Traceability(tasks: Task[], threshold: number): CriterionResult {
  const untraceable = tasks.filter((t) => !hasTraceability(t));
  const traceRatio = (tasks.length - untraceable.length) / tasks.length;
  if (traceRatio < threshold) {
    return { id: "T-3", status: "VIOLATION", detail: `${untraceable.length} of ${tasks.length} task(s) lack traceability to a spec ID (R-N, F-N, etc.).`, evidence: untraceable.slice(0, 5).map((t) => `Line ${t.lineNo}: "${t.text.slice(0, 60)}"`), fix: "Append the rule or feature ID to each task, e.g. '- [ ] Implement token validation (R-3)'" };
  }
  if (untraceable.length > 0) {
    return { id: "T-3", status: "WARNING", detail: `${untraceable.length} task(s) lack traceability (ratio ${(traceRatio * 100).toFixed(0)}% passes threshold).`, evidence: untraceable.slice(0, 3).map((t) => `Line ${t.lineNo}: "${t.text.slice(0, 60)}"`) };
  }
  return { id: "T-3", status: "PASS", detail: `All ${tasks.length} task(s) are traceable to spec IDs.` };
}

function checkT4Specificity(tasks: Task[], threshold: number): CriterionResult {
  const vague = tasks.filter((t) => !isSpecific(t));
  const ratio = (tasks.length - vague.length) / tasks.length;
  if (ratio < threshold) {
    return { id: "T-4", status: "VIOLATION", detail: `${vague.length} task(s) are too vague or too short (< ${MIN_WORDS} words).`, evidence: vague.slice(0, 5).map((t) => `Line ${t.lineNo}: "${t.text.slice(0, 60)}"`), fix: "Write specific task descriptions: what, where, and the acceptance condition." };
  }
  if (vague.length > 0) {
    return { id: "T-4", status: "WARNING", detail: `${vague.length} task(s) could be more specific.`, evidence: vague.slice(0, 3).map((t) => `Line ${t.lineNo}: "${t.text.slice(0, 60)}"`) };
  }
  return { id: "T-4", status: "PASS", detail: `All ${tasks.length} task(s) are specific.` };
}

function checkT5Assumptions(text: string): CriterionResult {
  if (!/^#+\s*assumptions?\b/im.test(text)) {
    return { id: "T-5", status: "VIOLATION", detail: "Tasks document is missing an ## Assumptions section.", fix: "Add '## Assumptions' listing any scheduling, dependency, or scope assumptions." };
  }
  return { id: "T-5", status: "PASS", detail: "Assumptions section present." };
}

function checkS5StoryArtifacts(specPath: string): CriterionResult {
  const storiesDir = join(specPath, "stories");
  if (!existsSync(storiesDir)) {
    return { id: "S-5", status: "WARNING", detail: "No stories/ directory found. Story-first enforcement is not active for this project.", fix: "Create a stories/ directory and add story artifacts to enable story-first enforcement." };
  }
  let storyFiles: string[] = [];
  try { storyFiles = readdirSync(storiesDir).filter((f) => f.endsWith(".md")); } catch { /* ignore */ }
  if (storyFiles.length === 0) {
    return { id: "S-5", status: "BLOCK", detail: "A stories/ directory exists but contains no story artifacts. Implementation tasks cannot proceed without a corresponding story.", fix: "Add a story file (e.g. stories/001-your-feature.md) with Intent, Acceptance Criteria, and Assumptions sections before proceeding." };
  }
  return { id: "S-5", status: "PASS", detail: `${storyFiles.length} story artifact(s) present in stories/.`, evidence: storyFiles.slice(0, 5) };
}

function gateStatus(criteria: CriterionResult[]): GateResult["status"] {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

export async function runGate4(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  const taskFile = findFile(specPath, TASK_NAMES);
  if (!taskFile) {
    criteria.push({ id: "T-1", status: "BLOCK", detail: "No tasks document found. Expected tasks.md under the spec path.", fix: "Create tasks.md with markdown checkbox items tracing to requirement rule IDs." });
    return { gate: "G4", name: "Tasks Valid", status: "BLOCKED", criteria, durationMs: Date.now() - start };
  }

  criteria.push({ id: "T-1", status: "PASS", detail: `Tasks document found: ${taskFile}` });

  const text = readFile(taskFile);
  const tasks = extractTasks(text);

  if (tasks.length === 0) {
    criteria.push({ id: "T-1", status: "VIOLATION", detail: "Tasks file found but contains no checkbox task items.", fix: "Add tasks as markdown checkboxes: '- [ ] Task description (R-N)'" });
    return { gate: "G4", name: "Tasks Valid", status: "FAILING", criteria, durationMs: Date.now() - start };
  }

  criteria.push(checkT2Compound(tasks, getThreshold(config, "T-2")));
  criteria.push(checkT3Traceability(tasks, getThreshold(config, "T-3")));
  criteria.push(checkT4Specificity(tasks, getThreshold(config, "T-4")));
  criteria.push(checkT5Assumptions(text));
  criteria.push(checkS5StoryArtifacts(specPath));

  return { gate: "G4", name: "Tasks Valid", status: gateStatus(criteria), criteria, durationMs: Date.now() - start };
}
