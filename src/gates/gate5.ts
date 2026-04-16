// Gate 5 — Executability Valid
// Checks E-1 through E-3 against project tests and rule coverage.
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { join, relative } from "path";
import type { GateResult, CriterionResult, ResolvedConfig } from "../types.js";
import { getThreshold } from "../config.js";

const TEST_DIR_SKIP = new Set([
  "node_modules", "dist", "build", ".git", ".next", "coverage", ".cache", "__pycache__", "vendor",
]);

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|cs)$/i,
  /(^|\/)__tests__\//i,
  /(^|\/)test\//i,
  /(^|\/)tests\//i,
];

interface ParsedRule {
  id: string;
  text: string;
}

function readFile(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function walkTests(dir: string): string[] {
  const files: string[] = [];
  function scan(current: string) {
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith(".") || TEST_DIR_SKIP.has(entry)) continue;
      const full = join(current, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        scan(full);
      } else if (stat.isFile() && TEST_FILE_PATTERNS.some((pattern) => pattern.test(full))) {
        files.push(full);
      }
    }
  }
  scan(dir);
  return files.sort();
}

function findRequirementsFile(specPath: string): string | null {
  const candidates = ["requirements.md", "REQUIREMENTS.md", "requirements/requirements.md"];
  for (const name of candidates) {
    const full = join(specPath, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function extractRules(text: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const lines = text.split("\n");
  const headingPattern = /^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?(?:\*\*)?Rule\s+(R-\d+[a-z]?)(?:\*\*)?[:\s]+(.+)$/i;
  for (const line of lines) {
    const match = line.match(headingPattern);
    if (match) rules.push({ id: match[1]!, text: match[2]!.trim() });
  }
  return rules;
}

function normaliseTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`"'():[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["validate", "rule", "must", "have", "with", "that", "each"].includes(token));
}

function similarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

function findRuleCoverage(
  rules: ParsedRule[],
  testFiles: string[],
  projectRoot: string,
  threshold: number
): {
  covered: ParsedRule[];
  missing: ParsedRule[];
  evidence: string[];
} {
  const tests = testFiles.map((file) => ({
    file,
    rel: relative(projectRoot, file),
    text: readFile(file),
    tokens: normaliseTokens(readFile(file)),
  }));

  const covered: ParsedRule[] = [];
  const missing: ParsedRule[] = [];
  const evidence: string[] = [];

  for (const rule of rules) {
    const ruleTokens = normaliseTokens(rule.text);
    const exactNeedle = ruleTokens.join(" ");
    let bestScore = 0;
    let bestFile: string | null = null;

    for (const test of tests) {
      const text = test.text.toLowerCase();
      if (rule.id && text.includes(rule.id.toLowerCase())) {
        bestScore = 1;
        bestFile = test.rel;
        break;
      }
      if (exactNeedle && text.includes(exactNeedle)) {
        bestScore = 1;
        bestFile = test.rel;
        break;
      }
      const score = similarity(ruleTokens, test.tokens);
      if (score > bestScore) {
        bestScore = score;
        bestFile = test.rel;
      }
    }

    if (bestScore >= threshold && bestFile) {
      covered.push(rule);
      evidence.push(`${rule.id} -> ${bestFile} (${Math.round(bestScore * 100)}%)`);
    } else {
      missing.push(rule);
    }
  }

  return { covered, missing, evidence };
}

function hasSpecStyleLanguage(testFiles: string[]): { pass: boolean; evidence: string[] } {
  const evidence: string[] = [];
  for (const file of testFiles) {
    const text = readFile(file);
    if (/\b(given|when|then|scenario|example)\b/i.test(text)) {
      evidence.push(relative(process.cwd(), file));
    }
  }
  return { pass: evidence.length > 0, evidence: evidence.slice(0, 5) };
}

// ── Generic test runner ───────────────────────────────────────────────────────

interface CommandOutcome {
  command: string;
  exitCode: number | null;
  stderr: string;
}

function runOne(command: string, projectRoot: string): CommandOutcome {
  const result = spawnSync(command, {
    shell: true,
    cwd: projectRoot,
    encoding: "utf-8",
    timeout: 120_000,
    env: process.env,
  });
  return {
    command,
    exitCode: result.status,
    stderr: (result.stderr ?? "").trim().slice(0, 800),
  };
}

/**
 * Ecosystem probes used when no explicit test_commands are configured.
 * Each entry: [sentinel file/condition, default command, optional sub-check].
 * Probes are evaluated in order; all matching ecosystems are included.
 */
interface EcosystemProbe {
  sentinel: string;
  /** If set, the sentinel file must contain this substring for the probe to match. */
  contains?: string;
  command: string;
  label: string;
}

const ECOSYSTEM_PROBES: EcosystemProbe[] = [
  { sentinel: "Cargo.toml", command: "cargo test",     label: "Rust"       },
  { sentinel: "go.mod",     command: "go test ./...",   label: "Go"         },
  { sentinel: "package.json", contains: '"test"',
                             command: "npm test",        label: "Node/npm"   },
  { sentinel: "pyproject.toml",
                             command: "python -m pytest", label: "Python"   },
  { sentinel: "setup.py",   command: "python -m pytest", label: "Python"   },
  { sentinel: "Makefile",   contains: "\ntest:",
                             command: "make test",       label: "Make"       },
  { sentinel: "build.gradle",
                             command: "gradle test",     label: "Gradle/JVM" },
  { sentinel: "pom.xml",    command: "mvn test",         label: "Maven/JVM"  },
  { sentinel: "mix.exs",    command: "mix test",         label: "Elixir"     },
  { sentinel: "Gemfile",    command: "bundle exec rspec", label: "Ruby"      },
];

/**
 * Resolve which test commands to run.
 *
 * Priority:
 *   1. `test_commands` in config  — explicit list, use as-is
 *   2. `test_command`  in config  — single override
 *   3. Auto-detect via ECOSYSTEM_PROBES (all matching ecosystems)
 */
function resolveTestCommands(
  projectRoot: string,
  configCommand?: string,
  configCommands?: string[]
): { commands: string[]; autoDetected: boolean } {
  if (configCommands && configCommands.length > 0) {
    return { commands: configCommands, autoDetected: false };
  }
  if (configCommand) {
    return { commands: [configCommand], autoDetected: false };
  }

  const detected: string[] = [];
  for (const probe of ECOSYSTEM_PROBES) {
    const sentinelPath = join(projectRoot, probe.sentinel);
    if (!existsSync(sentinelPath)) continue;
    if (probe.contains) {
      const content = readFile(sentinelPath);
      if (!content.includes(probe.contains)) continue;
    }
    // Deduplicate — don't add the same command twice (e.g. two Python sentinels).
    if (!detected.includes(probe.command)) {
      detected.push(probe.command);
    }
  }

  return { commands: detected, autoDetected: true };
}

function resolveGate5Status(criteria: CriterionResult[]): GateResult["status"] {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function checkE1Tests(
  testFiles: string[],
  commands: string[],
  projectRoot: string,
  autoDetected: boolean,
  criteria: CriterionResult[]
): boolean {
  if (testFiles.length === 0 && commands.length === 0) {
    criteria.push({ id: "E-1", status: "BLOCK", detail: "No test files found and no test runner detected.", fix: "Add test files (*.test.ts, *.spec.rs, test/*.py, …) or set `test_commands` in spec-check.config.json. Example: { \"test_commands\": [\"npm test\", \"cargo test\"] }" });
    return false;
  }
  if (commands.length === 0) {
    criteria.push({ id: "E-1", status: "WARNING", detail: `${testFiles.length} test file(s) found but no test runner was detected.`, evidence: testFiles.slice(0, 5).map((f) => relative(projectRoot, f)), fix: "Set `test_commands` in spec-check.config.json to specify how to run the test suite." });
    return true;
  }
  const outcomes = commands.map((cmd) => runOne(cmd, projectRoot));
  const failures = outcomes.filter((o) => o.exitCode !== 0);
  if (failures.length > 0) {
    const detail = failures.map((o) => `\`${o.command}\` exited with code ${o.exitCode}`).join("; ");
    criteria.push({ id: "E-1", status: "BLOCK", detail, evidence: failures.flatMap((o) => o.stderr ? [o.stderr] : []), fix: "Fix failing tests reported above before proceeding." });
    return false;
  }
  const passed = outcomes.map((o) => `\`${o.command}\``).join(", ");
  const evidence = [...testFiles.slice(0, 5).map((f) => relative(projectRoot, f)), ...(autoDetected ? ["(commands auto-detected)"] : [])];
  criteria.push({ id: "E-1", status: "PASS", detail: `${testFiles.length} test file(s) found. ${passed} exited 0.`, evidence });
  return true;
}

function checkE2Coverage(specPath: string, testFiles: string[], projectRoot: string, threshold: number, criteria: CriterionResult[]): void {
  const reqFile = findRequirementsFile(specPath);
  const reqText = reqFile ? readFile(reqFile) : "";
  const rules = reqText ? extractRules(reqText) : [];
  if (rules.length === 0) {
    criteria.push({ id: "E-2", status: "WARNING", detail: "No parseable requirements rules were found to compare against tests.", fix: "Ensure requirements.md contains `Rule R-N:` headings before using Gate 5 coverage checks." });
    return;
  }
  const coverage = findRuleCoverage(rules, testFiles, projectRoot, threshold);
  const coveragePct = (coverage.covered.length / rules.length) * 100;
  if (coverage.missing.length > 0) {
    criteria.push({ id: "E-2", status: "VIOLATION", detail: `${coverage.missing.length}/${rules.length} rule(s) have no corresponding test. Coverage ${coveragePct.toFixed(1)}%.`, evidence: coverage.missing.slice(0, 8).map((rule) => `${rule.id}: ${rule.text}`), fix: "Add tests whose names or descriptions match each uncovered Rule, or reference the Rule ID directly in test titles." });
  } else {
    criteria.push({ id: "E-2", status: "PASS", detail: `All ${rules.length} rules have corresponding tests. Coverage ${coveragePct.toFixed(1)}%.`, evidence: coverage.evidence.slice(0, 8) });
  }
}

// ── Gate entry point ──────────────────────────────────────────────────────────

export async function runGate5(
  specPath: string,
  projectRoot: string,
  config: ResolvedConfig
): Promise<GateResult> {
  const start = Date.now();
  const criteria: CriterionResult[] = [];

  const testFiles = walkTests(projectRoot);
  const { commands, autoDetected } = resolveTestCommands(projectRoot, config.value.test_command, config.value.test_commands);

  const canContinue = checkE1Tests(testFiles, commands, projectRoot, autoDetected, criteria);
  if (!canContinue && criteria.some((c) => c.status === "BLOCK")) {
    return { gate: "G5", name: "Executability Valid", status: "BLOCKED", criteria, durationMs: Date.now() - start };
  }

  checkE2Coverage(specPath, testFiles, projectRoot, getThreshold(config, "E-2"), criteria);

  const specStyle = hasSpecStyleLanguage(testFiles);
  if (!specStyle.pass) {
    criteria.push({ id: "E-3", status: "WARNING", detail: "No tests were found using spec-style language such as Given/When/Then or Scenario/Example wording.", fix: "Prefer test names or descriptions that reflect spec language to preserve traceability." });
  } else {
    criteria.push({ id: "E-3", status: "PASS", detail: "Spec-style language detected in test files.", evidence: specStyle.evidence });
  }

  return { gate: "G5", name: "Executability Valid", status: resolveGate5Status(criteria), criteria, durationMs: Date.now() - start };
}
