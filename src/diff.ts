import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join, relative, resolve } from "path";
import { spawnSync } from "child_process";
import type { ActorIdentity, CriterionResult, GateStatus, ResolvedConfig, ServiceInfo } from "./types.js";
import { buildFilePath, buildStoragePaths, writeRecord } from "./storage.js";
import { actorFields } from "./workflow.js";

type ChangeCategory =
  | "intent"
  | "requirements"
  | "design"
  | "tasks"
  | "stories"
  | "prd"
  | "rca"
  | "adr"
  | "dependencies"
  | "code"
  | "tests"
  | "uncategorised";

export interface DiffFileChange {
  path: string;
  status: string;
  category: ChangeCategory;
  addedLines: string[];
}

export interface DiffNote {
  code: string;
  detail: string;
}

export interface DiffReport {
  path: string;
  status: GateStatus;
  base: string | null;
  files: DiffFileChange[];
  criteria: CriterionResult[];
  notes: DiffNote[];
  categories: Record<ChangeCategory, string[]>;
  durationMs: number;
}

const DEPENDENCY_FILES = new Set(["package.json", "go.mod", "requirements.txt", "Cargo.toml", "pom.xml"]);

// Security-sensitive file name patterns (path segments or base names)
const SECURITY_PATH_PATTERNS = [
  /\bauth\b/i, /\bsecurity\b/i, /\bcrypto\b/i, /\bpermission\b/i,
  /\bauthoriz/i, /\bauthenticat/i, /\bcsrf\b/i, /\bcors\b/i,
  /\bjwt\b/i, /\boauth\b/i, /\bpassword\b/i, /\bsecret\b/i,
];

// Deployment manifest file name / path patterns
const DEPLOYMENT_PATH_PATTERNS = [
  /^dockerfile/i, /docker-compose/i, /\bkubernetes\b/i, /\bk8s\b/i,
  /\bterraform\b/i, /\.tf$/, /\.tfvars$/, /\bhelm\b/i, /\bansible\b/i,
  /\.github\/workflows\/.*deploy/i, /\bheroku/i, /\bprocfile/i,
  /\bnginx\.conf$/i, /\bapache\.conf$/i, /\bkustomization\.ya?ml$/i,
];

function isSecurityFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  return SECURITY_PATH_PATTERNS.some((p) => p.test(norm));
}

function isDeploymentFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  return DEPLOYMENT_PATH_PATTERNS.some((p) => p.test(norm));
}

/** Returns true if any ADR file in the adr/ directory contains the search text. */
function adrCoversText(adrDir: string, searchText: string): boolean {
  if (!searchText || !existsSync(adrDir)) return false;
  const needle = searchText.toLowerCase();
  try {
    const entries = readdirSync(adrDir).filter((f) => f.endsWith(".md"));
    for (const entry of entries) {
      const content = readFileSync(join(adrDir, entry), "utf-8").toLowerCase();
      if (content.includes(needle)) return true;
    }
  } catch { /* ignore */ }
  return false;
}
const ADR_TRIGGER_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "infrastructure", pattern: /\b(database|queue|cache|service|broker|cluster|region|replica)\b/i },
  { kind: "constraint", pattern: /\b(performance|latency|throughput|compliance|regulation|security|encryption|authentication|authorization)\b/i },
  { kind: "integration", pattern: /\b(api|webhook|integration|third-party|external|provider)\b/i },
  { kind: "scale", pattern: /\b\d+(?:\.\d+)?\s*(users?|ms|s|rps|qps|requests?|gb|mb|tb|%|percent)\b/i },
];

function runGit(args: string[], cwd: string) {
  return spawnSync("git", args, { cwd, encoding: "utf-8", env: process.env });
}

function gitAvailable(cwd: string): boolean {
  return runGit(["rev-parse", "--is-inside-work-tree"], cwd).status === 0;
}

function readHeadMessage(cwd: string): string {
  const result = runGit(["log", "-1", "--pretty=%s"], cwd);
  return result.status === 0 ? result.stdout.trim() : "";
}

function isHotfix(message: string): boolean {
  return /\b(hotfix|fix:|bugfix)\b/i.test(message);
}

function categoryFor(file: string): ChangeCategory {
  const normalized = file.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  if (normalized === "intent.md") return "intent";
  if (normalized === "requirements.md") return "requirements";
  if (normalized === "design.md") return "design";
  if (normalized === "tasks.md") return "tasks";
  if (normalized.startsWith("prd/") && !normalized.startsWith("prd/archive/")) return "prd";
  if (normalized.startsWith("stories/") && !normalized.startsWith("stories/archive/")) return "stories";
  if (normalized.startsWith("rca/") && !normalized.startsWith("rca/archive/")) return "rca";
  if (normalized.startsWith("adr/") && !normalized.startsWith("adr/archive/")) return "adr";
  if (DEPENDENCY_FILES.has(base)) return "dependencies";
  if (/(__tests__\/|\/test\/|\.test\.|\.spec\.)/i.test(normalized)) return "tests";
  if (/^(src|lib|cmd)\//.test(normalized) || /\.(go|ts|tsx|js|jsx|py|java|rb|rs|c|cc|cpp|cxx|cs|swift|scala|kt)$/.test(normalized)) return "code";
  return "uncategorised";
}

function parseNameStatus(output: string): Array<{ status: string; path: string }> {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      return { status: parts[0] ?? "M", path: parts[parts.length - 1] ?? "" };
    })
    .filter((item) => item.path);
}

function parseAddedLines(diffText: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (fileMatch) {
      current = fileMatch[1]!;
      if (!map.has(current)) map.set(current, []);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      map.get(current)!.push(line.slice(1));
    }
  }
  return map;
}

function listUntrackedFiles(cwd: string): string[] {
  const result = runGit(["ls-files", "--others", "--exclude-standard"], cwd);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readAddedLinesFromFile(root: string, relPath: string): string[] {
  const fullPath = join(root, relPath);
  try {
    return readFileSync(fullPath, "utf-8").split(/\r?\n/);
  } catch {
    return [];
  }
}

function emptyDiffReport(
  targetPath: string,
  base: string | undefined,
  criteria: CriterionResult[],
  notes: DiffNote[],
  categories: DiffReport["categories"],
  start: number
): DiffReport {
  return {
    path: resolve(targetPath),
    status: "PASS",
    base: base ?? null,
    files: [],
    criteria,
    notes,
    categories,
    durationMs: Date.now() - start,
  };
}

function collectDiffFiles(root: string, nameStatusOutput: string, patchOutput: string): DiffFileChange[] {
  const addedByFile = parseAddedLines(patchOutput);
  const fileMap = new Map<string, DiffFileChange>();
  for (const item of parseNameStatus(nameStatusOutput)) {
    const rel = item.path.replace(/\\/g, "/");
    fileMap.set(rel, {
      path: rel,
      status: item.status,
      category: categoryFor(rel),
      addedLines: addedByFile.get(rel) ?? [],
    });
  }
  for (const relPath of listUntrackedFiles(root)) {
    const rel = relPath.replace(/\\/g, "/");
    if (fileMap.has(rel)) continue;
    fileMap.set(rel, {
      path: rel,
      status: "A",
      category: categoryFor(rel),
      addedLines: readAddedLinesFromFile(root, rel),
    });
  }
  return Array.from(fileMap.values());
}

function populateCategories(files: DiffFileChange[], categories: DiffReport["categories"]): void {
  for (const file of files) categories[file.category].push(file.path);
}

function addTraceabilityCriteria(
  criteria: CriterionResult[],
  categories: DiffReport["categories"],
  hotfix: boolean
): void {
  const storyOrRcaChanged = categories.stories.length > 0 || categories.rca.length > 0;
  if (categories.code.length > 0 && !storyOrRcaChanged && !hotfix) {
    criteria.push({
      id: "R-26",
      status: "VIOLATION",
      detail: "Code changes are untraceable because no story or RCA changed in the same diff.",
      evidence: categories.code,
      fix: "Add or update a story, or create an RCA for a hotfix path before landing code changes.",
    });
  } else if (categories.code.length > 0) {
    criteria.push({
      id: "R-26",
      status: "PASS",
      detail: hotfix ? "Code changes are marked as hotfix-compatible by commit message." : "Code changes are accompanied by a story or RCA diff.",
    });
  }

  if (categories.code.length > 0 && categories.tests.length === 0) {
    criteria.push({
      id: "DIFF-CODE-TESTS",
      status: "WARNING",
      detail: "Code changed without corresponding test changes.",
      evidence: categories.code,
      fix: "Add or update tests, or re-run executability/quality checks for the changed code path.",
    });
  } else if (categories.code.length > 0) {
    criteria.push({ id: "DIFF-CODE-TESTS", status: "PASS", detail: "Code changes include matching test changes." });
  }

  // PRD changes require compile_requirements to be run so requirements.md stays current
  if (categories.prd.length > 0) {
    criteria.push({
      id: "DIFF-PRD-COMPILE",
      status: "VIOLATION",
      detail: `${categories.prd.length} PRD file(s) changed. requirements.md must be recompiled.`,
      evidence: categories.prd,
      fix: "Run compile_requirements with write:true to regenerate requirements.md from all prd/ files, then re-run G2 and G3.",
    });
  }

  // Stories changed without corresponding PRD or requirement update
  const reqOrPrdChanged = categories.requirements.length > 0 || categories.prd.length > 0;
  if (categories.stories.length > 0 && !reqOrPrdChanged) {
    criteria.push({
      id: "DIFF-STORY-REQ",
      status: "VIOLATION",
      detail: "Stories changed without corresponding PRD or requirement updates.",
      evidence: categories.stories,
      fix: "Update the relevant prd/ file and run compile_requirements, or update requirements.md directly.",
    });
  } else if (categories.stories.length > 0) {
    criteria.push({ id: "DIFF-STORY-REQ", status: "PASS", detail: "Story changes include PRD/requirement updates." });
  }

  // PRD or requirements changed without ADR update
  const reqChanged = categories.requirements.length > 0 || categories.prd.length > 0;
  const designChanged = categories.design.length > 0 || categories.adr.length > 0;
  if (reqChanged && !designChanged) {
    criteria.push({
      id: "DIFF-REQ-DESIGN",
      status: "WARNING",
      detail: "PRD/requirements changed without ADR changes; architecture decisions may be stale.",
      fix: "Review adr/ and update or add ADR files if requirement changes introduce new architectural decisions.",
    });
  } else if (reqChanged) {
    criteria.push({ id: "DIFF-REQ-DESIGN", status: "PASS", detail: "PRD/requirement changes include ADR updates." });
  }

  if (reqChanged && categories.tasks.length === 0) {
    criteria.push({
      id: "DIFF-REQ-TASKS",
      status: "WARNING",
      detail: "PRD/requirements changed without task updates; task coverage may be stale.",
      fix: "Review tasks.md and add tasks for any new features or rules introduced by this PRD change.",
    });
  } else if (reqChanged) {
    criteria.push({ id: "DIFF-REQ-TASKS", status: "PASS", detail: "PRD/requirement changes include task updates." });
  }

  if (categories.intent.length > 0 && !reqOrPrdChanged) {
    criteria.push({
      id: "DIFF-INTENT-REQ",
      status: "WARNING",
      detail: "Intent changed without requirement updates.",
      fix: "Review whether the prd/ files should change to reflect the updated intent scope.",
    });
  } else if (categories.intent.length > 0) {
    criteria.push({ id: "DIFF-INTENT-REQ", status: "PASS", detail: "Intent changes include requirement updates." });
  }
}

function collectAdrTriggers(files: DiffFileChange[]): { signals: string[]; evidence: string[]; dependencies: string[] } {
  const signals: string[] = [];
  const evidence: string[] = [];
  for (const file of files) {
    if (!["design", "adr", "dependencies", "code", "requirements", "prd", "intent"].includes(file.category)) continue;
    for (const line of file.addedLines) {
      for (const trigger of ADR_TRIGGER_PATTERNS) {
        if (trigger.pattern.test(line)) {
          signals.push(trigger.kind);
          evidence.push(`${file.path}: ${line.trim()}`);
        }
      }
    }
  }
  const dependencies = files
    .filter((file) => file.category === "dependencies")
    .flatMap((file) => dependencyAdditions(file));
  for (const dependency of dependencies) {
    signals.push("dependency");
    evidence.push(`dependency: ${dependency}`);
  }
  return { signals, evidence, dependencies };
}

function addAdrCriteria(
  criteria: CriterionResult[],
  files: DiffFileChange[],
  adrDir: string,
  adrChanged: boolean,
  triggerSignals: string[],
  triggerEvidence: string[],
  depAdded: string[]
): void {
  if (depAdded.length > 0) {
    const uncoveredDeps = depAdded.filter((dep) => !adrChanged && !adrCoversText(adrDir, dep));
    if (uncoveredDeps.length > 0) {
      criteria.push({
        id: "D-ADR-1",
        status: "BLOCK",
        detail: `${uncoveredDeps.length} new dependency/dependencies added without a corresponding ADR in adr/.`,
        evidence: uncoveredDeps.map((dep) => `dependency: ${dep}`),
        fix: "Add an ADR in adr/ that references each new dependency before merging this diff.",
      });
    } else {
      criteria.push({
        id: "D-ADR-1",
        status: "PASS",
        detail: "New dependencies are covered by an ADR.",
        evidence: depAdded.map((dep) => `dependency: ${dep}`),
      });
    }
  }

  const blockingRules: Array<{
    id: "D-ADR-2" | "D-ADR-3";
    files: DiffFileChange[];
    detail: string;
    fix: string;
  }> = [
    {
      id: "D-ADR-2",
      files: files.filter((file) => isSecurityFile(file.path)),
      detail: "security-related file(s) changed without a corresponding ADR in adr/.",
      fix: "Add an ADR in adr/ documenting the security constraint change before merging this diff.",
    },
    {
      id: "D-ADR-3",
      files: files.filter((file) => isDeploymentFile(file.path)),
      detail: "deployment manifest file(s) changed without a corresponding ADR in adr/.",
      fix: "Add an ADR in adr/ documenting the deployment topology change before merging this diff.",
    },
  ];
  for (const rule of blockingRules) {
    if (rule.files.length === 0) continue;
    const uncovered = rule.files.filter((file) => !adrChanged && !adrCoversText(adrDir, basename(file.path).replace(/\.[^.]+$/, "")));
    if (uncovered.length > 0) {
      criteria.push({
        id: rule.id,
        status: "BLOCK",
        detail: `${uncovered.length} ${rule.detail}`,
        evidence: uncovered.map((file) => file.path),
        fix: rule.fix,
      });
      continue;
    }
    criteria.push({
      id: rule.id,
      status: "PASS",
      detail: rule.id === "D-ADR-2" ? "Security-related file changes are covered by an ADR." : "Deployment manifest changes are covered by an ADR.",
      evidence: rule.files.map((file) => file.path),
    });
  }

  if (triggerSignals.length > 0 && !adrChanged) {
    criteria.push({
      id: "R-27",
      status: "VIOLATION",
      detail: "Diff introduced architectural trigger signals without an ADR change.",
      evidence: triggerEvidence.slice(0, 10),
      fix: "Add or update an ADR in the same diff to record the architectural decision.",
    });
  } else if (triggerSignals.length > 0) {
    criteria.push({
      id: "R-27",
      status: "PASS",
      detail: "Architectural trigger signals were accompanied by an ADR change.",
    });
  }
}

function addSupersessionCriteria(criteria: CriterionResult[], files: DiffFileChange[], root: string): void {
  const invalidatedAssumptionFiles = files.filter((file) => {
    if (!["stories", "intent", "rca"].includes(file.category)) return false;
    return file.addedLines.some((line) => /\binvalidated\b/i.test(line));
  });
  if (invalidatedAssumptionFiles.length === 0) return;
  const archiveFiles = listArchiveFiles(root).map((file) => relative(root, file).replace(/\\/g, "/"));
  const hasArchiveChange = files.some((file) => file.path.includes("/archive/")) || archiveFiles.some((file) => /_superseded\.md$/.test(file));
  if (!hasArchiveChange) {
    criteria.push({
      id: "DIFF-SUPERSESSION",
      status: "BLOCK",
      detail: "Invalidated assumptions were detected without a corresponding superseded archive artifact.",
      evidence: invalidatedAssumptionFiles.map((file) => file.path),
      fix: "Run invalidate_assumption so the archive copy and supersession record are created atomically.",
    });
    return;
  }
  criteria.push({ id: "DIFF-SUPERSESSION", status: "PASS", detail: "Invalidated assumptions are accompanied by supersession artifacts." });
}

function buildStatus(criteria: CriterionResult[]): GateStatus {
  if (criteria.some((criterion) => criterion.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((criterion) => criterion.status === "VIOLATION")) return "FAILING";
  if (criteria.some((criterion) => criterion.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function listArchiveFiles(root: string): string[] {
  const files: string[] = [];
  function scan(dir: string) {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) scan(full);
      else if (stat.isFile()) files.push(full);
    }
  }
  scan(root);
  return files;
}

function dependencyAdditions(change: DiffFileChange): string[] {
  if (change.path.endsWith("package.json")) {
    const deps: string[] = [];
    let inDependencyBlock = false;
    for (const raw of change.addedLines) {
      const line = raw.trim();
      if (/^"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/.test(line)) {
        inDependencyBlock = true;
        continue;
      }
      if (inDependencyBlock && line.startsWith("}")) {
        inDependencyBlock = false;
        continue;
      }
      if (!inDependencyBlock) continue;
      const key = line.match(/^"([^"]+)"\s*:/)?.[1];
      if (key) deps.push(key);
    }
    return deps;
  }
  return change.addedLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^module\s/.test(line));
}

export async function runDiffCheck(
  targetPath: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  llm: ActorIdentity,
  base?: string
): Promise<DiffReport> {
  const start = Date.now();
  const root = service.rootPath;
  const criteria: CriterionResult[] = [];
  const notes: DiffNote[] = [];
  const categories: DiffReport["categories"] = {
    intent: [],
    requirements: [],
    design: [],
    tasks: [],
    stories: [],
    prd: [],
    rca: [],
    adr: [],
    dependencies: [],
    code: [],
    tests: [],
    uncategorised: [],
  };

  if (!gitAvailable(root)) {
    notes.push({ code: "NO_GIT", detail: "Project is not in a git work tree or git is unavailable on PATH." });
    return emptyDiffReport(targetPath, base, criteria, notes, categories, start);
  }

  const nameArgs = base ? ["diff", "--name-status", base] : ["diff", "--name-status", "HEAD"];
  const patchArgs = base ? ["diff", "--unified=0", "--no-color", base] : ["diff", "--unified=0", "--no-color", "HEAD"];
  const nameResult = runGit(nameArgs, root);
  const patchResult = runGit(patchArgs, root);
  if (nameResult.status !== 0 || patchResult.status !== 0) {
    notes.push({ code: "NO_DIFF", detail: "No diff could be produced. This may be a repository with no prior commits or no diffable base." });
    return emptyDiffReport(targetPath, base, criteria, notes, categories, start);
  }

  const files = collectDiffFiles(root, nameResult.stdout, patchResult.stdout);
  populateCategories(files, categories);

  if (files.length === 0) {
    notes.push({ code: "EMPTY_DIFF", detail: "No changed files detected." });
  }

  if (categories.uncategorised.length > 0) {
    notes.push({ code: "UNCATEGORISED", detail: `${categories.uncategorised.length} changed file(s) were uncategorised and excluded from reconciliation rules.` });
  }

  const headMessage = readHeadMessage(root);
  const hotfix = isHotfix(headMessage);
  const adrChanged = categories.adr.length > 0;
  addTraceabilityCriteria(criteria, categories, hotfix);
  const { signals: triggerSignals, evidence: triggerEvidence, dependencies: depAdded } = collectAdrTriggers(files);
  const adrDir = join(root, "adr");
  addAdrCriteria(criteria, files, adrDir, adrChanged, triggerSignals, triggerEvidence, depAdded);
  addSupersessionCriteria(criteria, files, root);

  if (categories.code.length > 0) {
    notes.push({ code: "CC_RECHECK", detail: "Code changed; complexity metrics should be re-run for delta analysis." });
  }

  const report: DiffReport = {
    path: resolve(targetPath),
    status: buildStatus(criteria),
    base: base ?? null,
    files,
    criteria,
    notes,
    categories,
    durationMs: Date.now() - start,
  };

  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const filePath = buildFilePath(storage, llm, "diff", new Date());
  writeRecord(filePath, {
    schema_version: 2,
    check_type: "diff",
    project_path: report.path,
    org: storage.org,
    repo: storage.repo,
    service: storage.service,
    git_commit: storage.commit8,
    branch: storage.branch,
    timestamp: new Date().toISOString(),
    base: report.base,
    status: report.status,
    files: report.files,
    criteria: report.criteria,
    notes: report.notes,
    categories: report.categories,
    duration_ms: report.durationMs,
    ...actorFields(llm),
  });

  return report;
}
