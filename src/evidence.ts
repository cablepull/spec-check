// Story 027 — Evidence Artifacts
// EV-1: Verification evidence must be present when a release artifact exists.
// EV-2: Benchmark results must be present for performance-sensitive components.
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, extname, join, resolve } from "path";
import type { CriterionResult, GateStatus } from "./types.js";

export interface EvidenceReport {
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

// ── Release artifact scanner ───────────────────────────────────────────────────

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isFile()) results.push(entry);
    }
  } catch { /* ignore */ }
  return results;
}

/**
 * Returns true if any file in the given directory references searchText
 * (either by name or by content).
 */
function directoryCoversText(dir: string, searchText: string): boolean {
  if (!searchText || !existsSync(dir)) return false;
  const needle = searchText.toLowerCase();
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Check file name first (fast path)
      if (entry.toLowerCase().includes(needle)) return true;
      // Check file content
      const full = join(dir, entry);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isFile()) {
        const content = readFile(full).toLowerCase();
        if (content.includes(needle)) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

// ── Benchmark annotation detection ────────────────────────────────────────────
// Matches common benchmark annotation patterns across multiple languages.
// Patterns anchored to line-start (multiline) so they don't match within string literals or comments.
const BENCH_PATTERNS = [
  // Rust: #[bench] or #[criterion::bench] at start of line
  /^\s*#\[(?:\w+::)?bench(?:mark)?\]/im,
  // Python: @pytest.mark.benchmark or @benchmark at start of line
  /^\s*@(?:pytest\.mark\.)?benchmark\b/im,
  // Go: func BenchmarkXxx at start of line
  /^\s*func\s+Benchmark[A-Z]\w*/m,
  // JVM: @Benchmark at start of line
  /^\s*@Benchmark\b/im,
  // JS/TS: explicit benchmark framework calls at start of line
  /^\s*(?:suite\.add|bench\.add|new\s+Benchmark)\s*\(/im,
];

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".py", ".go", ".java", ".kt", ".scala",
  ".rs", ".c", ".cc", ".cpp", ".cxx", ".cs", ".swift",
]);

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "target", ".spec-check", "vendor"]);

interface BenchmarkAnnotation {
  file: string;  // relative path
  name: string;  // extracted function / component name
}

// Strip single-line and block comments from source text to avoid false pattern matches.
function stripComments(text: string): string {
  // Remove block comments first (non-greedy)
  let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  out = out.replace(/\/\/[^\n]*/g, "");
  // Remove Python/shell/Ruby/Rust doc-test line comments
  out = out.replace(/^\s*#[^\n]*/gm, "");
  return out;
}

function findBenchmarkAnnotations(root: string): BenchmarkAnnotation[] {
  const results: BenchmarkAnnotation[] = [];

  function scan(dir: string, relBase: string) {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const rel = `${relBase}${entry}`;
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) {
        scan(full, `${rel}/`);
      } else if (s.isFile() && SOURCE_EXTENSIONS.has(extname(entry))) {
        const raw = readFile(full);
        // Strip comments to avoid matching patterns in documentation text
        const text = stripComments(raw);
        for (const pattern of BENCH_PATTERNS) {
          if (pattern.test(text)) {
            results.push({ file: rel, name: basename(entry, extname(entry)) });
            break;
          }
        }
      }
    }
  }

  scan(root, "");
  return results;
}

// ── Main evidence runner ───────────────────────────────────────────────────────

export function runEvidenceCheck(projectRoot: string): EvidenceReport {
  const start = Date.now();
  const root = resolve(projectRoot);
  const criteria: CriterionResult[] = [];

  const releaseDir = join(root, "release");
  const verificationDir = join(root, "verification");
  const benchmarksDir = join(root, "benchmarks");

  // ── EV-1: Verification evidence present when a release artifact exists ────────
  const releaseFiles = listFiles(releaseDir);
  if (releaseFiles.length === 0) {
    // No release directory or no release files — not a violation, just note it
    criteria.push({
      id: "EV-1",
      status: "PASS",
      detail: "No release artifacts found in release/ — EV-1 check skipped.",
    });
  } else {
    const uncoveredRelease = releaseFiles.filter(
      (file) => !directoryCoversText(verificationDir, basename(file, extname(file)))
    );
    if (uncoveredRelease.length > 0) {
      criteria.push({
        id: "EV-1",
        status: "VIOLATION",
        detail: `${uncoveredRelease.length} release artifact(s) have no matching verification evidence in verification/.`,
        evidence: uncoveredRelease.map((file) => `release/${file} → missing: verification/*${basename(file, extname(file))}*`),
        fix: "Add a verification file to verification/ referencing each release artifact name.",
      });
    } else {
      criteria.push({
        id: "EV-1",
        status: "PASS",
        detail: `All ${releaseFiles.length} release artifact(s) have matching verification evidence.`,
        evidence: releaseFiles.slice(0, 5).map((f) => `release/${f}`),
      });
    }
  }

  // ── EV-2: Benchmark results present for performance-sensitive components ──────
  const annotations = findBenchmarkAnnotations(root);
  if (annotations.length === 0) {
    criteria.push({
      id: "EV-2",
      status: "PASS",
      detail: "No benchmark annotations detected in source files — EV-2 check skipped.",
    });
  } else {
    const uncoveredBenches = annotations.filter(
      (ann) => !directoryCoversText(benchmarksDir, ann.name)
    );
    if (uncoveredBenches.length > 0) {
      criteria.push({
        id: "EV-2",
        status: "WARNING",
        detail: `${uncoveredBenches.length} benchmark annotation(s) have no matching result file in benchmarks/.`,
        evidence: uncoveredBenches.slice(0, 8).map(
          (ann) => `${ann.file} → missing: benchmarks/*${ann.name}*`
        ),
        fix: "Add benchmark result files to benchmarks/ for each annotated component.",
      });
    } else {
      criteria.push({
        id: "EV-2",
        status: "PASS",
        detail: `All ${annotations.length} benchmark annotation(s) have matching result files.`,
        evidence: annotations.slice(0, 5).map((ann) => ann.file),
      });
    }
  }

  return {
    path: root,
    status: buildStatus(criteria),
    criteria,
    durationMs: Date.now() - start,
  };
}

export function formatEvidenceReport(report: EvidenceReport): string {
  const icon = { PASS: "✅", BLOCKED: "🚫", FAILING: "❌", PASSING_WITH_WARNINGS: "⚠️" };
  const lines: string[] = [
    `Evidence Artifacts — ${report.path}`,
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
