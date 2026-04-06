// Story 026 — Reconciliation Gate
// RC-1: README claims are consistent with actual repository artifacts.
// RC-2: Task completion claims are consistent with artifact content.
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import type { CriterionResult, GateStatus } from "./types.js";

export interface ReconciliationReport {
  path: string;
  status: GateStatus;
  criteria: CriterionResult[];
  durationMs: number;
}

function readFile(p: string): string {
  try { return readFileSync(p, "utf-8"); } catch { return ""; }
}

function buildStatus(criteria: CriterionResult[]): GateStatus {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

// ── README claim extraction ────────────────────────────────────────────────────
// Looks for backtick-quoted identifiers that look like file paths (contain / or .)
// and checks whether those paths exist relative to the project root.
function extractReadmePaths(readmeText: string): string[] {
  const paths: string[] = [];
  // Match backtick-quoted tokens that look like paths (contain . or /)
  const RE = /`([^`\s]+[./][^`\s]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(readmeText)) !== null) {
    const candidate = m[1]!;
    // Skip pure URLs
    if (/^https?:\/\//.test(candidate)) continue;
    // Skip version strings like "1.0.0"
    if (/^\d+\.\d+\.\d+/.test(candidate)) continue;
    paths.push(candidate);
  }
  return [...new Set(paths)]; // deduplicate
}

// Walk source tree to collect all file paths relative to root (excluding hidden and
// commonly irrelevant dirs)
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "target", ".spec-check"]);

function walkFiles(dir: string, root: string, results: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walkFiles(full, root, results);
    else results.push(full.slice(root.length + 1).replace(/\\/g, "/"));
  }
  return results;
}

// ── Completed task artifact path extraction ────────────────────────────────────
// Looks for checked checkboxes (- [x]) and extracts backtick-quoted paths from them.
function extractCompletedTaskPaths(tasksText: string): Array<{ task: string; path: string }> {
  const items: Array<{ task: string; path: string }> = [];
  const lines = tasksText.split("\n");
  for (const line of lines) {
    // Checked checkboxes
    const taskMatch = line.match(/^\s*[-*]\s*\[x\]\s*(.+)/i);
    if (!taskMatch) continue;
    const taskText = taskMatch[1]!.trim();
    const RE = /`([^`\s]+[./][^`\s]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(taskText)) !== null) {
      const candidate = m[1]!;
      if (/^https?:\/\//.test(candidate)) continue;
      if (/^\d+\.\d+\.\d+/.test(candidate)) continue;
      items.push({ task: taskText.slice(0, 80), path: candidate });
    }
  }
  return items;
}

// ── Main reconciliation runner ─────────────────────────────────────────────────

export function runReconciliation(projectRoot: string): ReconciliationReport {
  const start = Date.now();
  const root = resolve(projectRoot);
  const criteria: CriterionResult[] = [];

  // Build a set of all relative file paths in the repo for fast lookup
  const allFiles = new Set(walkFiles(root, root));

  // ── RC-1: README claims are consistent with actual repository artifacts ───────
  const readmeCandidates = ["README.md", "readme.md", "README.rst", "README"];
  let readmeText = "";
  let readmeFile = "";
  for (const name of readmeCandidates) {
    const full = join(root, name);
    if (existsSync(full)) {
      readmeText = readFile(full);
      readmeFile = name;
      break;
    }
  }

  if (!readmeText) {
    criteria.push({
      id: "RC-1",
      status: "WARNING",
      detail: "No README file found. README claim reconciliation could not run.",
      fix: "Add a README.md describing the project. Backtick-quoted paths in README are checked against actual files.",
    });
  } else {
    const claimedPaths = extractReadmePaths(readmeText);
    if (claimedPaths.length === 0) {
      criteria.push({
        id: "RC-1",
        status: "PASS",
        detail: `${readmeFile} contains no backtick-quoted path references to verify.`,
      });
    } else {
      const missingPaths = claimedPaths.filter((p) => !allFiles.has(p) && !existsSync(join(root, p)));
      if (missingPaths.length > 0) {
        criteria.push({
          id: "RC-1",
          status: "VIOLATION",
          detail: `${missingPaths.length} path(s) referenced in ${readmeFile} do not exist in the repository.`,
          evidence: missingPaths.slice(0, 8),
          fix: "Either create the missing files or update README to remove outdated references.",
        });
      } else {
        criteria.push({
          id: "RC-1",
          status: "PASS",
          detail: `All ${claimedPaths.length} path(s) referenced in ${readmeFile} exist in the repository.`,
          evidence: claimedPaths.slice(0, 5),
        });
      }
    }
  }

  // ── RC-2: Completed task artifact paths exist ────────────────────────────────
  const tasksCandidates = ["tasks.md", "TASKS.md", "tasks/tasks.md"];
  let tasksText = "";
  for (const name of tasksCandidates) {
    const full = join(root, name);
    if (existsSync(full)) { tasksText = readFile(full); break; }
  }

  if (!tasksText) {
    criteria.push({
      id: "RC-2",
      status: "WARNING",
      detail: "No tasks file found. Completed-task artifact reconciliation could not run.",
      fix: "Add tasks.md with markdown checkboxes. Completed tasks (- [x]) with backtick-quoted paths are checked against actual files.",
    });
  } else {
    const completedItems = extractCompletedTaskPaths(tasksText);
    if (completedItems.length === 0) {
      criteria.push({
        id: "RC-2",
        status: "PASS",
        detail: "No completed tasks with artifact path references were found to verify.",
      });
    } else {
      const missingItems = completedItems.filter(
        (item) => !allFiles.has(item.path) && !existsSync(join(root, item.path))
      );
      if (missingItems.length > 0) {
        criteria.push({
          id: "RC-2",
          status: "VIOLATION",
          detail: `${missingItems.length} completed task(s) reference artifact paths that do not exist.`,
          evidence: missingItems.slice(0, 8).map((item) => `"${item.task}" → missing: ${item.path}`),
          fix: "Either create the missing artifacts or uncheck the task if it has not been completed.",
        });
      } else {
        criteria.push({
          id: "RC-2",
          status: "PASS",
          detail: `All ${completedItems.length} completed task(s) with artifact paths are consistent with the repository.`,
        });
      }
    }
  }

  return {
    path: root,
    status: buildStatus(criteria),
    criteria,
    durationMs: Date.now() - start,
  };
}

export function formatReconciliationReport(report: ReconciliationReport): string {
  const icon = { PASS: "✅", BLOCKED: "🚫", FAILING: "❌", PASSING_WITH_WARNINGS: "⚠️" };
  const lines: string[] = [
    `Reconciliation — ${report.path}`,
    `Status: ${icon[report.status] ?? ""} ${report.status}  |  ${report.durationMs}ms`,
    "────────────────────────────────────────────────────────────",
  ];
  for (const c of report.criteria) {
    const sIcon = { PASS: "✅", BLOCK: "🚫", VIOLATION: "❌", WARNING: "⚠️" }[c.status] ?? "";
    lines.push(`${sIcon} [${c.id}] ${c.status}: ${c.detail}`);
    if (c.evidence?.length) c.evidence.forEach((e) => lines.push(`   Evidence: ${e}`));
    if (c.fix) lines.push(`   Fix: ${c.fix}`);
  }
  return lines.join("\n");
}
