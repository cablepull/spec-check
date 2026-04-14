import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, extname, join, relative, resolve } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import type { ActorIdentity, CriterionResult, GateStatus, ResolvedConfig, ServiceInfo } from "./types.js";
import { getThreshold } from "./config.js";
import { buildFilePath, buildStoragePaths, globPattern, runDuckQuery, writeRecord } from "./storage.js";
import { DEPENDENCY_REGISTRY } from "./dependencies.js";
import { actorFields } from "./workflow.js";

type MutationLanguage = "typescript" | "javascript" | "python" | "go" | "java" | "rust";
type MutationTool = "stryker" | "mutmut" | "go-mutesting" | "pitest" | "cargo-mutants" | "lightweight";
type MutationTrigger = "pre_merge" | "nightly" | "weekly" | "on_demand" | "pre_commit";

export interface MutationFunctionResult {
  name: string;
  file: string;
  score: number | null;
  critical: boolean;
  critical_match?: "exact" | "similar";
  surviving_mutants: string[];
  cc: number | null;
}

export interface MutationNote {
  code: string;
  detail: string;
  file?: string;
}

export interface MutationReport {
  path: string;
  status: GateStatus;
  trigger: MutationTrigger;
  tool: MutationTool | null;
  language: MutationLanguage | "mixed" | "unknown";
  incremental: boolean;
  criteria: CriterionResult[];
  notes: MutationNote[];
  durationMs: number;
  total_mutants: number;
  killed: number;
  survived: number;
  timeout: number;
  score: number | null;
  scope: string;
  functions: MutationFunctionResult[];
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "coverage", ".cache", "__pycache__", "vendor",
]);

const LANGUAGE_BY_EXT: Record<string, MutationLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
};

interface ScopeInfo {
  root: string;
  files: string[];
  language: MutationReport["language"];
}

interface SpecHint {
  label: string;
  tokens: string[];
}

interface RawMutationResult {
  tool: MutationTool;
  incremental: boolean;
  total_mutants: number;
  killed: number;
  survived: number;
  timeout: number;
  score: number | null;
  functions: MutationFunctionResult[];
  notes: MutationNote[];
  raw_output?: string;
  exit_code?: number | null;
}

interface LightweightMutant {
  file: string;
  line: number;
  name: string;
  mutated: string;
}

const LIGHTWEIGHT_MUTATION_PATTERNS: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /===/, replacement: "!==", label: "strict-equality-flip" },
  { pattern: /!==/, replacement: "===", label: "strict-inequality-flip" },
  { pattern: /\btrue\b/, replacement: "false", label: "boolean-flip" },
  { pattern: /\bfalse\b/, replacement: "true", label: "boolean-flip" },
  { pattern: /&&/, replacement: "||", label: "logical-operator-flip" },
  { pattern: /\|\|/, replacement: "&&", label: "logical-operator-flip" },
  { pattern: /\+/, replacement: "-", label: "arithmetic-flip" },
  { pattern: />=/, replacement: "<", label: "comparison-flip" },
  { pattern: /<=/, replacement: ">", label: "comparison-flip" },
];

function runShell(command: string, cwd?: string, timeout = 300_000) {
  return spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf-8",
    timeout,
    env: process.env,
  });
}

function probeBinary(name: string, cwd?: string): boolean {
  const probe = process.platform === "win32" ? `where ${name}` : `command -v ${name}`;
  return runShell(probe, cwd, 15_000).status === 0;
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) scan(full);
      else if (stat.isFile() && LANGUAGE_BY_EXT[extname(entry).toLowerCase()]) files.push(full);
    }
  }
  scan(root);
  return files.sort();
}

function detectScope(targetPath: string, service: ServiceInfo): ScopeInfo {
  const resolvedTarget = resolve(targetPath);
  if (!existsSync(resolvedTarget)) {
    return { root: service.rootPath, files: [], language: "unknown" };
  }

  const stat = statSync(resolvedTarget);
  const files = stat.isDirectory() ? walkFiles(resolvedTarget) : [resolvedTarget];
  const langs = [...new Set(files.map((file) => LANGUAGE_BY_EXT[extname(file).toLowerCase()]).filter(Boolean))];
  return {
    root: stat.isDirectory() ? resolvedTarget : service.rootPath,
    files,
    language: langs.length === 0 ? "unknown" : langs.length === 1 ? langs[0]! : "mixed",
  };
}

function readText(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function looksLikeTestFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return /(^|\/)(__tests__|tests)\//.test(normalized) || /\.(test|spec)\.[^.]+$/.test(normalized);
}

function normaliseTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`"'():[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !["rule", "example", "feature", "given", "when", "then"].includes(token));
}

function parseSpecHints(specPath: string): SpecHint[] {
  const requirementsPath = join(specPath, "requirements.md");
  const text = readText(requirementsPath);
  const hints: SpecHint[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const feature = line.match(/^##\s+Feature\s+F-\d+\s*[:\-]?\s*(.+)$/i);
    const rule = line.match(/^###\s+Rule\s+R-\d+\s*[:\-]?\s*(.+)$/i);
    const example = line.match(/^####\s+Example\s+\d+\s*[:\-]?\s*(.+)$/i);
    const label = feature?.[1] ?? rule?.[1] ?? example?.[1];
    if (!label) continue;
    const tokens = normaliseTokens(label);
    if (tokens.length > 0) hints.push({ label: label.trim(), tokens });
  }

  return hints;
}

function readPackageTestScript(root: string): string | null {
  const packageJson = join(root, "package.json");
  if (!existsSync(packageJson)) return null;
  try {
    const parsed = JSON.parse(readText(packageJson)) as { scripts?: Record<string, string> };
    return parsed.scripts?.test ?? null;
  } catch {
    return null;
  }
}

function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.max(left.size, right.size);
}

function markCriticalFunctions(functions: MutationFunctionResult[], specHints: SpecHint[]): MutationFunctionResult[] {
  return functions.map((fn) => {
    const fnTokens = normaliseTokens(fn.name);
    let bestExact = false;
    let bestSimilarity = 0;

    for (const hint of specHints) {
      const hintText = hint.tokens.join(" ");
      const fnText = fnTokens.join(" ");
      if (hintText && fnText && (fnText.includes(hintText) || hintText.includes(fnText))) {
        bestExact = true;
        break;
      }
      bestSimilarity = Math.max(bestSimilarity, similarity(fnTokens, hint.tokens));
    }

    if (bestExact) {
      return { ...fn, critical: true, critical_match: "exact" };
    }
    if (bestSimilarity >= 0.6) {
      return { ...fn, critical: true, critical_match: "similar" };
    }
    return fn;
  });
}

function detectTrigger(config: ResolvedConfig): { trigger: MutationTrigger; inPreMergeContext: boolean } {
  const trigger = (config.value.mutation.triggers.default as MutationTrigger | undefined) ?? "pre_merge";
  const env = process.env;
  const inPreMergeContext = Boolean(
    env.CI === "true" ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.BUILDKITE ||
    env.CIRCLECI ||
    env.GERRIT_PROJECT ||
    env.GIT_MERGE_HEAD
  );
  return { trigger, inPreMergeContext };
}

function loadComplexityMap(service: ServiceInfo, config: ResolvedConfig): Map<string, number> {
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const baseDir = join(storage.storageRoot, storage.org, storage.repo, storage.service);
  const result = new Map<string, number>();
  const rows = runDuckQuery(`
    SELECT results
    FROM read_parquet('${globPattern(baseDir).replace(/'/g, "''")}', union_by_name=true)
    WHERE check_type = 'complexity'
  `);
  for (const row of rows) {
    let parsed: Array<{ name?: string; cc?: number; file?: string }> = [];
    try { parsed = JSON.parse(row.results ?? "[]") as Array<{ name?: string; cc?: number; file?: string }>; } catch {}
    for (const fn of parsed) {
      if (!fn.name || typeof fn.cc !== "number") continue;
      const key = `${fn.file ?? ""}::${fn.name}`;
      result.set(key, fn.cc);
    }
  }
  return result;
}

function latestHistoricalScores(service: ServiceInfo, config: ResolvedConfig): number[] {
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const baseDir = join(storage.storageRoot, storage.org, storage.repo, storage.service);
  const items = runDuckQuery(`
    SELECT timestamp, score
    FROM read_parquet('${globPattern(baseDir).replace(/'/g, "''")}', union_by_name=true)
    WHERE check_type = 'mutation' AND score IS NOT NULL
  `) as Array<{ timestamp: string; score: number }>;
  return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((item) => item.score).slice(-3);
}

function makeMinimalStrykerConfig(scopeRoot: string, scopeFiles: string[]): { path: string; generated: boolean } | null {
  const jsFiles = scopeFiles.filter((file) => [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(file).toLowerCase()));
  if (jsFiles.length === 0) return null;
  const existing = ["stryker.config.json", "stryker.config.js"].find((name) => existsSync(join(scopeRoot, name)));
  if (existing) return { path: join(scopeRoot, existing), generated: false };

  const tempDir = mkdtempSync(join(tmpdir(), "spec-check-stryker-"));
  const configPath = join(tempDir, "stryker.config.json");
  const mutate = jsFiles.slice(0, 100).map((file) => relative(scopeRoot, file).replace(/\\/g, "/"));
  const config = {
    mutate,
    testRunner: "command",
    commandRunner: { command: "npm test -- --runInBand" },
    reporters: ["clear-text", "json"],
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return { path: configPath, generated: true };
}

function parseStryker(scopeRoot: string, stdout: string, notes: MutationNote[]): RawMutationResult {
  const scoreMatch = stdout.match(/Mutation score[:\s]+(\d+(?:\.\d+)?)%/i);
  const killedMatch = stdout.match(/Killed[:\s]+(\d+)/i);
  const survivedMatch = stdout.match(/Survived[:\s]+(\d+)/i);
  const timeoutMatch = stdout.match(/Timeout[:\s]+(\d+)/i);
  const totalMutants = (killedMatch ? Number(killedMatch[1]) : 0) + (survivedMatch ? Number(survivedMatch[1]) : 0) + (timeoutMatch ? Number(timeoutMatch[1]) : 0);
  const jsonCandidates = [
    join(scopeRoot, "reports", "mutation", "mutation.json"),
    join(scopeRoot, "reports", "stryker", "mutation.json"),
  ];

  const functions: MutationFunctionResult[] = [];
  for (const candidate of jsonCandidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readText(candidate)) as {
        files?: Record<string, { mutants?: Array<{ status?: string; mutatorName?: string; replacement?: string; location?: { start?: { line?: number } } }> }>;
      };
      for (const [file, value] of Object.entries(parsed.files ?? {})) {
        const grouped = new Map<string, MutationFunctionResult>();
        for (const mutant of value.mutants ?? []) {
          const line = mutant.location?.start?.line ?? 1;
          const key = `${file}:${line}`;
          const current = grouped.get(key) ?? {
            name: `${basename(file)}:${line}`,
            file,
            score: null,
            critical: false,
            surviving_mutants: [],
            cc: null,
          };
          if (mutant.status === "Survived") {
            current.surviving_mutants.push(mutant.mutatorName ?? mutant.replacement ?? "survived mutant");
          }
          grouped.set(key, current);
        }
        functions.push(...grouped.values());
      }
      break;
    } catch {
      notes.push({ code: "MT_PARSE_WARN", detail: `Unable to parse Stryker JSON report at ${candidate}` });
    }
  }

  return {
    tool: "stryker",
    incremental: /--incremental/.test(stdout),
    total_mutants: totalMutants,
    killed: killedMatch ? Number(killedMatch[1]) : 0,
    survived: survivedMatch ? Number(survivedMatch[1]) : 0,
    timeout: timeoutMatch ? Number(timeoutMatch[1]) : 0,
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    functions,
    notes,
    raw_output: stdout,
  };
}

function parseMutmut(stdout: string, scopeRoot: string, notes: MutationNote[]): RawMutationResult {
  const lines = stdout.split(/\r?\n/);
  const summary = lines.find((line) => /survived|killed|timed/i.test(line)) ?? "";
  const survived = Number(summary.match(/(\d+)\s+survived/i)?.[1] ?? 0);
  const killed = Number(summary.match(/(\d+)\s+killed/i)?.[1] ?? 0);
  const timeout = Number(summary.match(/(\d+)\s+timed?\s*out/i)?.[1] ?? 0);
  const totalMutants = survived + killed + timeout;
  const score = totalMutants > 0 ? (killed / totalMutants) * 100 : null;
  const functions: MutationFunctionResult[] = [];

  for (const line of lines) {
    const match = line.match(/^(.+?):\s*(.+?)\s+\((survived|killed|timeout)\)$/i);
    if (!match) continue;
    const file = match[1]!.trim();
    const name = match[2]!.trim();
    if (/survived/i.test(match[3]!)) {
      functions.push({
        name,
        file: file.startsWith(scopeRoot) ? relative(scopeRoot, file) : file,
        score: 0,
        critical: false,
        surviving_mutants: ["survived mutant"],
        cc: null,
      });
    }
  }

  if (!summary) notes.push({ code: "MT_PARSE_WARN", detail: "mutmut output did not include a recognized summary line." });

  return {
    tool: "mutmut",
    incremental: false,
    total_mutants: totalMutants,
    killed,
    survived,
    timeout,
    score,
    functions,
    notes,
    raw_output: stdout,
  };
}

function parseGoMutesting(stdout: string, scopeRoot: string, notes: MutationNote[]): RawMutationResult {
  const lines = stdout.split(/\r?\n/);
  const killed = lines.filter((line) => /killed/i.test(line)).length;
  const survivedLines = lines.filter((line) => /survived/i.test(line));
  const survived = survivedLines.length;
  const timeout = lines.filter((line) => /timeout/i.test(line)).length;
  const totalMutants = killed + survived + timeout;
  const score = totalMutants > 0 ? (killed / totalMutants) * 100 : null;
  const functions = survivedLines.map((line) => ({
    name: line.match(/([A-Za-z0-9_./]+)$/)?.[1] ?? "unknown",
    file: relative(scopeRoot, scopeRoot),
    score: 0,
    critical: false,
    surviving_mutants: [line.trim()],
    cc: null,
  }));

  if (totalMutants === 0) notes.push({ code: "MT_PARSE_WARN", detail: "go-mutesting output did not include recognized kill/survive markers." });

  return {
    tool: "go-mutesting",
    incremental: false,
    total_mutants: totalMutants,
    killed,
    survived,
    timeout,
    score,
    functions,
    notes,
    raw_output: stdout,
  };
}

function parseCargoMutants(output: string, notes: MutationNote[]): RawMutationResult {
  // cargo-mutants summary line: "N mutants tested: X caught, Y missed, Z unviable, W timeout"
  // or "ok N/M: caught X, missed Y, ..."
  let total = 0, killed = 0, survived = 0, timeout = 0;

  const summaryMatch = output.match(/(\d+)\s+mutants?\s+tested[^\n]*caught[:\s]+(\d+)[^\n]*missed[:\s]+(\d+)/i);
  if (summaryMatch) {
    killed = parseInt(summaryMatch[2]!, 10);
    survived = parseInt(summaryMatch[3]!, 10);
    const timeoutMatch = output.match(/timeout[:\s]+(\d+)/i);
    timeout = timeoutMatch ? parseInt(timeoutMatch[1]!, 10) : 0;
    total = killed + survived + timeout;
  } else {
    // Fallback: count per-mutant status lines
    const lines = output.split(/\r?\n/);
    total = lines.filter((l) => /^(ok|MISSED|TIMEOUT)\s/i.test(l)).length;
    killed = lines.filter((l) => /^ok\s/i.test(l)).length;
    survived = lines.filter((l) => /^MISSED\s/i.test(l)).length;
    timeout = lines.filter((l) => /^TIMEOUT\s/i.test(l)).length;
  }

  const score = total > 0 ? (killed / total) * 100 : null;
  if (total === 0) {
    notes.push({ code: "MT_PARSE_WARN", detail: "cargo-mutants output did not include a recognized summary. Verify the cargo-mutants version." });
  }

  // Extract survived mutant descriptions for function-level reporting
  const missedLines = output.split(/\r?\n/).filter((l) => /^MISSED\s/i.test(l));
  const functions: MutationFunctionResult[] = missedLines.map((line) => {
    const fileMatch = line.match(/([^/\s]+\.rs:\d+:\d+)/);
    return {
      name: fileMatch?.[1] ?? "unknown",
      file: fileMatch?.[1]?.split(":")[0] ?? "unknown",
      score: 0,
      critical: false,
      surviving_mutants: [line.trim()],
      cc: null,
    };
  });

  return {
    tool: "cargo-mutants",
    incremental: false,
    total_mutants: total,
    killed,
    survived,
    timeout,
    score,
    functions,
    notes,
    raw_output: output,
  };
}

function executeTool(language: MutationLanguage, scope: ScopeInfo, config: ResolvedConfig): RawMutationResult | null {
  const notes: MutationNote[] = [];
  switch (language) {
    case "typescript":
    case "javascript":
      return executeStryker(scope, config, notes);
    case "python":
      return executeMutmut(scope, notes);
    case "go":
      return executeGoMutesting(scope, notes);
    case "rust":
      return executeCargoMutants(scope, notes);
    default:
      return {
        tool: "pitest",
        incremental: false,
        total_mutants: 0,
        killed: 0,
        survived: 0,
        timeout: 0,
        score: null,
        functions: [],
        notes: [
          { code: "UNSUPPORTED_LANGUAGE", detail: "Java mutation testing is deferred in v1; Pitest integration is not implemented yet." },
        ],
      };
  }
}

function noteTimeout(result: ReturnType<typeof runShell>, notes: MutationNote[], tool: string): void {
  if (result.error && result.error.message.includes("timed out")) {
    notes.push({ code: "MT_TIMEOUT", detail: `${tool} timed out before completion.` });
  }
}

function executeStryker(scope: ScopeInfo, config: ResolvedConfig, notes: MutationNote[]): RawMutationResult | null {
  const localBinary = join(scope.root, "node_modules", ".bin", "stryker");
  const binary = existsSync(localBinary) ? `"${localBinary}"` : (probeBinary("stryker", scope.root) ? "stryker" : "");
  if (!binary) return null;
  const testScript = readPackageTestScript(scope.root);
  if (!testScript) {
    return {
      tool: "stryker",
      incremental: false,
      total_mutants: 0,
      killed: 0,
      survived: 0,
      timeout: 0,
      score: null,
      functions: [],
      notes: [{ code: "TEST_COMMAND_MISSING", detail: "package.json does not define a test script, so Stryker has no test command to execute." }],
      raw_output: "",
      exit_code: null,
    };
  }
  const cfg = makeMinimalStrykerConfig(scope.root, scope.files);
  const parts = [`${binary} run`];
  if (cfg) parts.push(`"${cfg.path}"`);
  if (config.value.mutation.incremental) parts.push("--incremental");
  const result = runShell(parts.join(" "), scope.root, 300_000);
  if (cfg?.generated) {
    try { rmSync(join(cfg.path, ".."), { recursive: true, force: true }); } catch {}
  }
  noteTimeout(result, notes, "Stryker");
  const strykerOutput = [result.stdout, result.stderr, result.error?.message ?? ""].filter(Boolean).join("\n");
  if (/listen EPERM|operation not permitted 0\.0\.0\.0/i.test(strykerOutput)) {
    const fallback = runLightweightMutationFallback(scope, notes);
    if (fallback) return fallback;
  }
  const parsed = parseStryker(scope.root, strykerOutput, notes);
  parsed.exit_code = result.status;
  return parsed;
}

function buildLightweightMutants(scope: ScopeInfo): LightweightMutant[] {
  const candidates = scope.files
    .filter((file) => ["typescript", "javascript"].includes(LANGUAGE_BY_EXT[extname(file).toLowerCase()] ?? ""))
    .filter((file) => !looksLikeTestFile(file))
    .slice(0, 20);
  const mutants: LightweightMutant[] = [];
  for (const file of candidates) {
    const lines = readText(file).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (!line.trim() || line.trim().startsWith("//")) continue;
      for (const candidate of LIGHTWEIGHT_MUTATION_PATTERNS) {
        if (!candidate.pattern.test(line)) continue;
        const mutatedLine = line.replace(candidate.pattern, candidate.replacement);
        if (mutatedLine === line) continue;
        const mutatedLines = [...lines];
        mutatedLines[index] = mutatedLine;
        mutants.push({
          file,
          line: index + 1,
          name: `${candidate.label}@${basename(file)}:${index + 1}`,
          mutated: mutatedLines.join("\n"),
        });
        break;
      }
      if (mutants.length >= 12) return mutants;
    }
  }
  return mutants;
}

function runLightweightMutationFallback(scope: ScopeInfo, notes: MutationNote[]): RawMutationResult | null {
  const testScript = readPackageTestScript(scope.root);
  if (!testScript) return null;
  const mutants = buildLightweightMutants(scope);
  if (mutants.length === 0) {
    notes.push({ code: "MT_FALLBACK_EMPTY", detail: "Lightweight fallback could not find any eligible TypeScript/JavaScript mutations in the requested scope." });
    return {
      tool: "lightweight",
      incremental: false,
      total_mutants: 0,
      killed: 0,
      survived: 0,
      timeout: 0,
      score: null,
      functions: [],
      notes,
      raw_output: "",
      exit_code: null,
    };
  }

  const functions: MutationFunctionResult[] = [];
  let killed = 0;
  let survived = 0;
  let timeout = 0;
  for (const mutant of mutants) {
    const original = readText(mutant.file);
    writeFileSync(mutant.file, mutant.mutated, "utf-8");
    const result = runShell("npm test", scope.root, 120_000);
    writeFileSync(mutant.file, original, "utf-8");

    if (result.error && result.error.message.includes("timed out")) {
      timeout += 1;
      functions.push({
        name: mutant.name,
        file: relative(scope.root, mutant.file).replace(/\\/g, "/"),
        score: 0,
        critical: false,
        surviving_mutants: [`timeout at line ${mutant.line}`],
        cc: null,
      });
      continue;
    }
    if ((result.status ?? 1) !== 0) {
      killed += 1;
      functions.push({
        name: mutant.name,
        file: relative(scope.root, mutant.file).replace(/\\/g, "/"),
        score: 100,
        critical: false,
        surviving_mutants: [],
        cc: null,
      });
      continue;
    }
    survived += 1;
    functions.push({
      name: mutant.name,
      file: relative(scope.root, mutant.file).replace(/\\/g, "/"),
      score: 0,
      critical: false,
      surviving_mutants: [`survived line ${mutant.line}`],
      cc: null,
    });
  }

  notes.push({
    code: "MT_FALLBACK",
    detail: "Used lightweight local mutation fallback because Stryker could not start in the current environment.",
  });
  const total = mutants.length;
  return {
    tool: "lightweight",
    incremental: false,
    total_mutants: total,
    killed,
    survived,
    timeout,
    score: total > 0 ? (killed / total) * 100 : null,
    functions,
    notes,
    raw_output: "",
    exit_code: 0,
  };
}

function executeMutmut(scope: ScopeInfo, notes: MutationNote[]): RawMutationResult | null {
  if (!probeBinary("mutmut", scope.root)) return null;
  const target = scope.files.length === 1 ? relative(scope.root, scope.files[0]!) : ".";
  const result = runShell(`mutmut run ${target}`, scope.root, 300_000);
  noteTimeout(result, notes, "mutmut");
  return parseMutmut(`${result.stdout}\n${result.stderr}`, scope.root, notes);
}

function executeGoMutesting(scope: ScopeInfo, notes: MutationNote[]): RawMutationResult | null {
  if (!probeBinary("go-mutesting", scope.root)) return null;
  const target = scope.files.length === 1 ? relative(scope.root, scope.files[0]!) : "./...";
  const result = runShell(`go-mutesting ${target}`, scope.root, 300_000);
  noteTimeout(result, notes, "go-mutesting");
  return parseGoMutesting(`${result.stdout}\n${result.stderr}`, scope.root, notes);
}

function executeCargoMutants(scope: ScopeInfo, notes: MutationNote[]): RawMutationResult | null {
  if (!probeBinary("cargo-mutants", scope.root)) return null;
  const result = runShell("cargo mutants", scope.root, 300_000);
  noteTimeout(result, notes, "cargo-mutants");
  const parsed = parseCargoMutants(`${result.stdout}\n${result.stderr}`, notes);
  parsed.exit_code = result.status;
  return parsed;
}

function attachComplexity(functions: MutationFunctionResult[], complexity: Map<string, number>): MutationFunctionResult[] {
  return functions.map((fn) => {
    const exact = complexity.get(`${fn.file}::${fn.name}`) ?? complexity.get(`::${fn.name}`) ?? null;
    return { ...fn, cc: exact };
  });
}

function buildStatus(criteria: CriterionResult[]): GateStatus {
  if (criteria.some((item) => item.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((item) => item.status === "VIOLATION")) return "FAILING";
  if (criteria.some((item) => item.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function classifyExecutionProblem(raw: RawMutationResult): { detail: string; fix: string } | null {
  const output = raw.raw_output ?? "";
  if (raw.notes.some((note) => note.code === "TEST_COMMAND_MISSING")) {
    return {
      detail: "Mutation tool could not run because no test command is configured for this project.",
      fix: "Add a working test script to package.json before running mutation testing.",
    };
  }
  if (/listen EPERM|operation not permitted 0\.0\.0\.0/i.test(output)) {
    return {
      detail: "Mutation tool could not open a local listening socket in the current environment.",
      fix: "Run mutation testing in an environment that permits local worker/socket setup; this is an execution-environment restriction, not a project failure.",
    };
  }
  if (/Missing script:\s*\"test\"|npm error missing script: test/i.test(output)) {
    return {
      detail: "Mutation tool failed because the project has no npm test script.",
      fix: "Add a working test script or provide an explicit command-runner configuration.",
    };
  }
  if (raw.exit_code && raw.exit_code !== 0) {
    return {
      detail: "Mutation tool exited without producing a valid report.",
      fix: "Inspect the mutation tool stderr/stdout and correct the test-runner or environment configuration.",
    };
  }
  return null;
}

function persistMutationReport(
  report: MutationReport,
  service: ServiceInfo,
  config: ResolvedConfig,
  llm: ActorIdentity
): void {
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const filePath = buildFilePath(storage, llm, "mutation", new Date());
  writeRecord(filePath, {
    schema_version: 2,
    check_type: "mutation",
    timestamp: new Date().toISOString(),
    project_path: report.path,
    org: storage.org,
    repo: storage.repo,
    service: storage.service,
    git_commit: storage.commit8,
    branch: storage.branch,
    scope: report.scope,
    trigger: report.trigger,
    tool: report.tool,
    language: report.language,
    incremental: report.incremental,
    total_mutants: report.total_mutants,
    killed: report.killed,
    survived: report.survived,
    timeout: report.timeout,
    score: report.score,
    status: report.status,
    duration_ms: report.durationMs,
    functions: report.functions,
    criteria: report.criteria,
    notes: report.notes,
    ...actorFields(llm),
  });
}

function makeMutationReport(
  targetPath: string,
  start: number,
  trigger: MutationTrigger,
  scope: ScopeInfo,
  criteria: CriterionResult[],
  notes: MutationNote[],
  overrides: Partial<MutationReport> = {}
): MutationReport {
  return {
    path: resolve(targetPath),
    status: buildStatus(criteria),
    trigger,
    tool: null,
    language: scope.language,
    incremental: false,
    criteria,
    notes,
    durationMs: Date.now() - start,
    total_mutants: 0,
    killed: 0,
    survived: 0,
    timeout: 0,
    score: null,
    scope: scope.root,
    functions: [],
    ...overrides,
  };
}

function languageBlockDetail(language: MutationReport["language"]): string {
  return language === "mixed"
    ? "Mutation scope contains multiple languages. v1 requires a single-language scope per run."
    : "No supported mutation-testing language was detected in the requested scope.";
}

function missingDependencyForLanguage(language: MutationLanguage): string {
  if (language === "python") return "mutmut";
  if (language === "go") return "go-mutesting";
  if (language === "rust") return "cargo-mutants";
  return "stryker";
}

function checkMT1ProjectScore(raw: RawMutationResult, config: ResolvedConfig): CriterionResult {
  const threshold = getThreshold(config, "MT-1");
  if (typeof raw.score === "number" && raw.score < threshold) {
    return { id: "MT-1", status: "WARNING", detail: `Project mutation score ${raw.score.toFixed(1)}% is below threshold ${threshold}%.`, fix: `Improve tests to close the ${(threshold - raw.score).toFixed(1)} point gap.` };
  }
  return { id: "MT-1", status: "PASS", detail: typeof raw.score === "number" ? `Project mutation score ${raw.score.toFixed(1)}% meets threshold ${threshold}%.` : "Project mutation score was unavailable from the underlying tool." };
}

function checkMT2CriticalFunctions(functions: MutationFunctionResult[], config: ResolvedConfig): CriterionResult {
  const threshold = getThreshold(config, "MT-2");
  const failures = functions.filter((fn) => fn.critical && typeof fn.score === "number" && fn.score < threshold);
  if (failures.length > 0) {
    return { id: "MT-2", status: "VIOLATION", detail: `${failures.length} spec-critical functions fell below the ${threshold}% threshold.`, evidence: failures.map((fn) => `${fn.file}:${fn.name}=${fn.score?.toFixed(1)}% survivors=${fn.surviving_mutants.join(", ") || "none"}`), fix: "Strengthen assertions around the spec-critical behaviors until surviving mutants are killed." };
  }
  return { id: "MT-2", status: "PASS", detail: "No spec-critical functions were found below the configured mutation threshold." };
}

function checkMT3Trend(raw: RawMutationResult, service: ServiceInfo, config: ResolvedConfig): CriterionResult {
  const prior = latestHistoricalScores(service, config);
  const series = [...prior, raw.score].filter((v): v is number => typeof v === "number");
  const len = series.length;
  if (len >= 3 && series[len - 3]! > series[len - 2]! && series[len - 2]! > series[len - 1]!) {
    return { id: "MT-3", status: "WARNING", detail: `Mutation score declined across three consecutive runs: ${series.slice(-3).map((v) => v.toFixed(1)).join(" -> ")}.`, fix: "Inspect recently changed tests and surviving mutants before the decline becomes persistent." };
  }
  return { id: "MT-3", status: "PASS", detail: len >= 2 ? "No consecutive multi-run decline detected." : "Not enough historical mutation runs to evaluate decline." };
}

function checkMT4HighCcSurvivors(functions: MutationFunctionResult[], config: ResolvedConfig): CriterionResult {
  const threshold = getThreshold(config, "MT-4");
  const survivors = functions.filter((fn) => (fn.cc ?? -1) > threshold && fn.surviving_mutants.length > 0);
  if (survivors.length > 0) {
    return { id: "MT-4", status: "VIOLATION", detail: `${survivors.length} high-complexity functions have surviving mutants.`, evidence: survivors.map((fn) => `${fn.file}:${fn.name} cc=${fn.cc} survivors=${fn.surviving_mutants.join(", ")}`), fix: "Prioritize stronger tests for the highest-complexity functions first." };
  }
  return { id: "MT-4", status: "PASS", detail: "No surviving mutants were found in functions above the configured complexity threshold." };
}

function checkMTDuration(start: number): CriterionResult | null {
  if (Date.now() - start <= 300_000) return null;
  return { id: "MT-DUR", status: "WARNING", detail: "Mutation run exceeded 5 minutes.", fix: "Narrow scope or use incremental mode where supported." };
}

export async function runMutation(
  targetPath: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  llm: ActorIdentity
): Promise<MutationReport> {
  const start = Date.now();
  const scope = detectScope(targetPath, service);
  const criteria: CriterionResult[] = [];
  const notes: MutationNote[] = [];
  const { trigger, inPreMergeContext } = detectTrigger(config);

  if (!config.value.mutation.enabled) {
    criteria.push({
      id: "MT-0",
      status: "WARNING",
      detail: "Mutation testing is disabled in configuration.",
      fix: "Enable mutation.enabled to run mutation analysis.",
    });
    const report = makeMutationReport(targetPath, start, trigger, scope, criteria, notes);
    persistMutationReport(report, service, config, llm);
    return report;
  }

  if (trigger === "pre_merge" && !inPreMergeContext) {
    notes.push({ code: "TRIGGER_CONTEXT", detail: "Default trigger is pre_merge, but no CI or merge context signal was detected. Running anyway because this tool was invoked directly." });
  }
  if (trigger === "pre_commit") {
    criteria.push({
      id: "MT-T",
      status: "WARNING",
      detail: "pre_commit is not recommended for large codebases because mutation testing is usually too slow for commit-time feedback.",
      fix: "Prefer pre_merge or on_demand for the default trigger.",
    });
  }

  if (scope.language === "mixed" || scope.language === "unknown") {
    criteria.push({
      id: "MT-L",
      status: "BLOCK",
      detail: languageBlockDetail(scope.language),
      fix: "Run check_mutation_score on a single-language directory or file.",
    });
    const report = makeMutationReport(targetPath, start, trigger, scope, criteria, notes);
    persistMutationReport(report, service, config, llm);
    return report;
  }

  const raw = executeTool(scope.language, scope, config);
  if (scope.language === "java") {
    criteria.push({
      id: "MT-U",
      status: "BLOCK",
      detail: "Java mutation testing is unsupported in v1. Pitest integration is deferred.",
      fix: "Use check_mutation_score on TS/JS, Python, or Go in v1, or implement Pitest support in a follow-up story.",
    });
    notes.push({ code: "UNSUPPORTED_LANGUAGE", detail: "Java mutation testing is deferred in v1; Pitest integration is not implemented yet." });
    const report = makeMutationReport(targetPath, start, trigger, scope, criteria, notes);
    persistMutationReport(report, service, config, llm);
    return report;
  }
  if (!raw) {
    const dependency = missingDependencyForLanguage(scope.language);
    const dep = DEPENDENCY_REGISTRY[dependency];
    criteria.push({
      id: "MT-D",
      status: "BLOCK",
      detail: `${dependency} is not installed or not available in PATH/project-local tooling.`,
      fix: Object.values(dep.install).join(" | "),
    });
    notes.push({ code: "DEPENDENCY_MISSING", detail: `Mutation testing for ${scope.language} requires ${dependency}.` });
    const report = makeMutationReport(targetPath, start, trigger, scope, criteria, notes);
    persistMutationReport(report, service, config, llm);
    return report;
  }

  notes.push(...raw.notes);
  const executionProblem = classifyExecutionProblem(raw);
  if (executionProblem) {
    criteria.push({
      id: "MT-E",
      status: "BLOCK",
      detail: executionProblem.detail,
      evidence: raw.raw_output ? raw.raw_output.split(/\r?\n/).filter(Boolean).slice(0, 3) : undefined,
      fix: executionProblem.fix,
    });
    const report: MutationReport = {
      path: resolve(targetPath),
      status: buildStatus(criteria),
      trigger,
      tool: raw.tool,
      language: scope.language,
      incremental: raw.incremental,
      criteria,
      notes,
      durationMs: Date.now() - start,
      total_mutants: raw.total_mutants,
      killed: raw.killed,
      survived: raw.survived,
      timeout: raw.timeout,
      score: raw.score,
      scope: scope.root,
      functions: [],
    };
    persistMutationReport(report, service, config, llm);
    return report;
  }

  let functions = raw.functions;
  const specHints = parseSpecHints(service.specPath);
  functions = markCriticalFunctions(functions, specHints);
  functions = attachComplexity(functions, loadComplexityMap(service, config));

  criteria.push(checkMT1ProjectScore(raw, config));
  criteria.push(checkMT2CriticalFunctions(functions, config));
  criteria.push(checkMT3Trend(raw, service, config));
  criteria.push(checkMT4HighCcSurvivors(functions, config));
  const durCriteria = checkMTDuration(start);
  if (durCriteria) criteria.push(durCriteria);

  const report: MutationReport = {
    path: resolve(targetPath),
    status: buildStatus(criteria),
    trigger,
    tool: raw.tool,
    language: scope.language,
    incremental: raw.incremental,
    criteria,
    notes,
    durationMs: Date.now() - start,
    total_mutants: raw.total_mutants,
    killed: raw.killed,
    survived: raw.survived,
    timeout: raw.timeout,
    score: raw.score,
    scope: scope.root,
    functions,
  };

  persistMutationReport(report, service, config, llm);
  return report;
}
