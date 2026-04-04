import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import type { CriterionResult, GateStatus, LLMIdentity, ResolvedConfig, ServiceInfo } from "./types.js";
import { detectCertaintyLanguage } from "./nlp.js";
import { getThreshold } from "./config.js";
import { buildFilePath, buildStoragePaths, writeRecord } from "./storage.js";

export interface AssumptionRow {
  id: string;
  assumption: string;
  basis: string;
  status: string;
  raw: string[];
}

export interface AssumptionValidationResult {
  path: string;
  status: GateStatus;
  criteria: CriterionResult[];
  assumptions: AssumptionRow[];
  durationMs: number;
}

export interface TrackAssumptionResult {
  artifact_path: string;
  assumption_id: string;
  status: "added" | "updated";
}

export interface InvalidateAssumptionResult {
  artifact_path: string;
  assumption_id: string;
  archive_path: string;
  replacement_path: string;
  status: "superseded";
}

export interface ListedAssumptionsResult {
  path: string;
  items: Array<{
    artifact_path: string;
    artifact_type: string;
    assumptions: AssumptionRow[];
  }>;
  durationMs: number;
}

export interface SupersessionHistoryResult {
  path: string;
  events: Array<{
    timestamp: string;
    original_artifact: string;
    replacement_artifact: string;
    archive_artifact: string;
    artifact_type?: string;
    assumption_id: string;
    assumption_text: string;
    reason: string;
    original_model: string;
    days_to_invalidation: number | null;
  }>;
  durationMs: number;
}

export interface AssumptionMetricsResult {
  path: string;
  since: string | null;
  totals: {
    assumptions_made: number;
    assumptions_invalidated: number;
    invalidation_rate: number | null;
    average_days_to_invalidation: number | null;
    trend: "improving" | "declining" | "stable" | "insufficient_data";
  };
  by_artifact_type: Array<{
    artifact_type: string;
    made: number;
    invalidated: number;
    invalidation_rate: number | null;
  }>;
  top_invalidated_categories: Array<{ category: string; count: number }>;
  by_model: Array<{
    model: string;
    assumptions_made: number;
    assumptions_invalidated: number;
    invalidation_rate: number | null;
  }>;
  history: Array<{ timestamp: string; invalidation_rate: number }>;
  durationMs: number;
}

const EMPTY_DECLARATION = "None — all decisions explicitly specified by the user.";

function readText(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function artifactType(path: string): string {
  const file = basename(path).toLowerCase();
  if (file === "intent.md") return "intent";
  if (path.includes("/stories/")) return "story";
  if (path.includes("/rca/")) return "rca";
  if (path.includes("/adr/")) return "adr";
  if (file === "design.md") return "design";
  if (file === "tasks.md") return "tasks";
  if (file === "requirements.md") return "requirements";
  return "artifact";
}

function findAssumptionsSection(text: string): { start: number; end: number; body: string } | null {
  const match = text.match(/^##\s+Assumptions\s*$/im);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const afterHeading = start + match[0].length;
  const tail = text.slice(afterHeading);
  const nextHeading = tail.match(/^##\s+/m);
  const end = nextHeading && nextHeading.index !== undefined ? afterHeading + nextHeading.index : text.length;
  return { start, end, body: text.slice(afterHeading, end).trim() };
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseAssumptions(text: string): { assumptions: AssumptionRow[]; empty: boolean; section: ReturnType<typeof findAssumptionsSection> } {
  const section = findAssumptionsSection(text);
  if (!section) return { assumptions: [], empty: false, section: null };
  if (section.body.includes(EMPTY_DECLARATION)) {
    return { assumptions: [], empty: true, section };
  }

  const lines = section.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const tableLines = lines.filter((line) => line.startsWith("|"));
  if (tableLines.length < 3) return { assumptions: [], empty: false, section };

  const header = splitTableRow(tableLines[0]!);
  const idIndex = header.findIndex((cell) => /^id$/i.test(cell) || /^#$/i.test(cell));
  const assumptionIndex = header.findIndex((cell) => /^assumption$/i.test(cell));
  const basisIndex = header.findIndex((cell) => /^basis$/i.test(cell));
  const statusIndex = header.findIndex((cell) => /^status$/i.test(cell));
  if ([idIndex, assumptionIndex, basisIndex, statusIndex].some((index) => index < 0)) {
    return { assumptions: [], empty: false, section };
  }

  const assumptions: AssumptionRow[] = [];
  for (const line of tableLines.slice(2)) {
    const cells = splitTableRow(line);
    if (cells.every((cell) => cell === "")) continue;
    assumptions.push({
      id: cells[idIndex] ?? "",
      assumption: cells[assumptionIndex] ?? "",
      basis: cells[basisIndex] ?? "",
      status: cells[statusIndex] ?? "",
      raw: cells,
    });
  }

  return { assumptions, empty: false, section };
}

function assumptionTable(rows: AssumptionRow[]): string {
  const lines = [
    "## Assumptions",
    "",
    "| ID | Assumption | Basis | Status |",
    "|----|------------|-------|--------|",
    ...rows.map((row) => `| ${row.id} | ${row.assumption} | ${row.basis} | ${row.status} |`),
  ];
  return lines.join("\n");
}

function nextAssumptionId(rows: AssumptionRow[]): string {
  const nums = rows
    .map((row) => row.id.match(/(\d+)/)?.[1])
    .filter(Boolean)
    .map((raw) => Number(raw));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `A-${String(next).padStart(3, "0")}`;
}

function insertOrReplaceAssumptions(text: string, rows: AssumptionRow[]): string {
  const table = assumptionTable(rows);
  const section = findAssumptionsSection(text);
  if (!section) {
    const suffix = text.endsWith("\n") ? "" : "\n";
    return `${text}${suffix}\n${table}\n`;
  }
  return `${text.slice(0, section.start).trimEnd()}\n\n${table}\n\n${text.slice(section.end).trimStart()}`.trimEnd() + "\n";
}

function insertHeaderBlock(text: string, heading: string, body: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && /^#\s+/.test(lines[0]!)) {
    return `${lines[0]}\n\n## ${heading}\n\n${body}\n\n${lines.slice(1).join("\n").trimStart()}`.trimEnd() + "\n";
  }
  return `## ${heading}\n\n${body}\n\n${text.trimStart()}`.trimEnd() + "\n";
}

function buildStatus(criteria: CriterionResult[]): GateStatus {
  if (criteria.some((criterion) => criterion.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((criterion) => criterion.status === "VIOLATION")) return "FAILING";
  if (criteria.some((criterion) => criterion.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function scanMarkdownFiles(root: string, includeArchived: boolean): string[] {
  const files: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      if (!includeArchived && entry === "archive") continue;
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) scan(full);
      else if (stat.isFile() && extname(full).toLowerCase() === ".md") files.push(full);
    }
  }
  scan(root);
  return files.sort();
}

function readOriginalModel(text: string): string {
  const author = text.match(/^\*\*Author:\*\*\s*(.+)$/im)?.[1]?.trim();
  return author || "unknown";
}

function classifyAssumption(text: string, basis: string): string {
  const haystack = `${text} ${basis}`.toLowerCase();
  const taxonomy: Array<{ category: string; pattern: RegExp }> = [
    { category: "auth", pattern: /\b(auth|oauth|login|token|session)\b/ },
    { category: "pagination", pattern: /\b(page|pagination|cursor|offset|limit)\b/ },
    { category: "async", pattern: /\b(async|queue|retry|eventual|background|worker)\b/ },
    { category: "data-format", pattern: /\b(json|xml|csv|schema|format|payload)\b/ },
    { category: "error-handling", pattern: /\b(error|failure|exception|fallback|timeout)\b/ },
    { category: "infrastructure", pattern: /\b(database|cache|redis|queue|broker|service|cluster)\b/ },
    { category: "ux", pattern: /\b(user|ui|ux|screen|form|click|flow)\b/ },
    { category: "performance", pattern: /\b(latency|performance|throughput|slow|fast|scale)\b/ },
    { category: "security", pattern: /\b(security|encrypt|authorization|authentication|permission|secret)\b/ },
  ];
  for (const item of taxonomy) {
    if (item.pattern.test(haystack)) return item.category;
  }
  return "other";
}

function trend(values: number[]): "improving" | "declining" | "stable" | "insufficient_data" {
  if (values.length < 2) return "insufficient_data";
  const xs = values.map((_, idx) => idx);
  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgY = values.reduce((a, b) => a + b, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    numerator += (xs[i]! - avgX) * (values[i]! - avgY);
    denominator += (xs[i]! - avgX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  if (slope > 0.02) return "declining";
  if (slope < -0.02) return "improving";
  return "stable";
}

function estimateDaysToInvalidation(path: string, invalidatedAt: Date): number | null {
  try {
    const stat = statSync(path);
    return Math.max(0, Math.floor((invalidatedAt.getTime() - stat.mtime.getTime()) / 86_400_000));
  } catch {
    return null;
  }
}

export function checkAssumptions(artifactPath: string, config?: ResolvedConfig): AssumptionValidationResult {
  const start = Date.now();
  const fullPath = resolve(artifactPath);
  const criteria: CriterionResult[] = [];

  if (!existsSync(fullPath)) {
    criteria.push({
      id: "AS-0",
      status: "BLOCK",
      detail: `Artifact not found: ${fullPath}`,
      fix: "Provide a path to an existing artifact.",
    });
    return { path: fullPath, status: buildStatus(criteria), criteria, assumptions: [], durationMs: Date.now() - start };
  }

  const text = readText(fullPath);
  const parsed = parseAssumptions(text);
  if (!parsed.section) {
    criteria.push({
      id: "AS-1",
      status: "VIOLATION",
      detail: "Artifact is missing an `## Assumptions` section.",
      fix: "Add `## Assumptions` with either a table of assumptions or the valid empty declaration.",
    });
    return { path: fullPath, status: buildStatus(criteria), criteria, assumptions: [], durationMs: Date.now() - start };
  }

  criteria.push({ id: "AS-1", status: "PASS", detail: "Assumptions section present." });
  if (parsed.empty) {
    return { path: fullPath, status: buildStatus(criteria), criteria, assumptions: [], durationMs: Date.now() - start };
  }

  const malformed = parsed.assumptions.filter((row) => !row.id || !row.assumption || !row.basis || !row.status);
  if (malformed.length > 0 || parsed.assumptions.length === 0) {
    criteria.push({
      id: "AS-2",
      status: "VIOLATION",
      detail: "Assumption table must include ID, Assumption, Basis, and Status for every row.",
      evidence: malformed.map((row) => `${row.id || "(missing id)"} | ${row.assumption || "(missing assumption)"}`),
      fix: "Normalize the assumptions table to the required 4-column schema.",
    });
  } else {
    criteria.push({ id: "AS-2", status: "PASS", detail: "Assumption rows contain required fields." });
  }

  const as3Threshold = config ? getThreshold(config, "AS-3") : 0.8;
  const certaintyFailures = parsed.assumptions
    .map((row) => ({ row, certainty: detectCertaintyLanguage(row.assumption) }))
    .filter(({ certainty }) => certainty.matched && certainty.confidence >= as3Threshold);
  if (certaintyFailures.length > 0) {
    criteria.push({
      id: "AS-3",
      status: "VIOLATION",
      detail: `${certaintyFailures.length} assumption(s) are written with certainty language instead of hedging.`,
      evidence: certaintyFailures.map(({ row, certainty }) => `${row.id}: ${certainty.evidence.join(", ")}`),
      fix: "Rewrite assumptions with hedging language such as 'assumed', 'defaulted to', or 'not specified'.",
    });
  } else {
    criteria.push({ id: "AS-3", status: "PASS", detail: "Assumptions are hedged rather than stated as facts." });
  }

  const invalidated = parsed.assumptions.filter((row) => /invalidated/i.test(row.status));
  const archiveDir = join(dirname(fullPath), "archive");
  const archiveBase = basename(fullPath, extname(fullPath));
  const hasArchive = existsSync(archiveDir) && readdirSync(archiveDir).some((entry) => entry.startsWith(`${archiveBase}_`) && entry.includes("_superseded"));
  if (invalidated.length > 0 && !hasArchive) {
    criteria.push({
      id: "AS-4",
      status: "BLOCK",
      detail: "Artifact contains invalidated assumptions but no archived superseded copy was found.",
      evidence: invalidated.map((row) => row.id),
      fix: "Run invalidate_assumption so the archive copy and supersession record are created atomically.",
    });
  } else {
    criteria.push({ id: "AS-4", status: "PASS", detail: "No orphan invalidated assumptions detected." });
  }

  return {
    path: fullPath,
    status: buildStatus(criteria),
    criteria,
    assumptions: parsed.assumptions,
    durationMs: Date.now() - start,
  };
}

export function trackAssumption(artifactPath: string, name: string, basis = "Assumed because not explicitly specified by the user."): TrackAssumptionResult {
  const fullPath = resolve(artifactPath);
  const text = readText(fullPath);
  const parsed = parseAssumptions(text);
  const rows = [...parsed.assumptions];
  const existing = rows.find((row) => row.assumption === name);
  if (existing) {
    existing.basis = basis;
    existing.status = "assumed";
    writeFileSync(fullPath, insertOrReplaceAssumptions(text, rows), "utf-8");
    return { artifact_path: fullPath, assumption_id: existing.id, status: "updated" };
  }

  rows.push({
    id: nextAssumptionId(rows),
    assumption: name,
    basis,
    status: "assumed",
    raw: [],
  });
  writeFileSync(fullPath, insertOrReplaceAssumptions(text, rows), "utf-8");
  return { artifact_path: fullPath, assumption_id: rows[rows.length - 1]!.id, status: "added" };
}

export function invalidateAssumption(
  artifactPath: string,
  assumptionId: string,
  reason: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  llm: LLMIdentity
): InvalidateAssumptionResult | { error: string; code: string; detail: string } {
  const fullPath = resolve(artifactPath);
  const originalText = readText(fullPath);
  const parsed = parseAssumptions(originalText);
  const row = parsed.assumptions.find((item) => item.id === assumptionId);
  if (!row) {
    return {
      error: "Assumption not found",
      code: "VALIDATION_ERROR",
      detail: `No assumption with ID ${assumptionId} exists in ${fullPath}.`,
    };
  }

  const now = new Date();
  const originalDaysToInvalidation = estimateDaysToInvalidation(fullPath, now);
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const archiveDir = join(dirname(fullPath), "archive");
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${basename(fullPath, extname(fullPath))}_${yyyymmdd}_superseded${extname(fullPath)}`);

  const replacementRows = parsed.assumptions.map((item) =>
    item.id === assumptionId
      ? { ...item, status: `invalidated (${now.toISOString().slice(0, 10)}: ${reason})` }
      : item
  );

  const archivedBody = insertHeaderBlock(
    originalText,
    "Status",
    `Superseded on ${now.toISOString().slice(0, 10)}. Replacement: ${fullPath}. Reason: assumption ${assumptionId} invalidated.`
  );
  writeFileSync(fullPath, archivedBody, "utf-8");
  renameSync(fullPath, archivePath);

  const replacement = insertHeaderBlock(
    insertOrReplaceAssumptions(originalText, replacementRows),
    "Supersedes",
    `${archivePath}\n\nReason: assumption ${assumptionId} (${row.assumption}) was invalidated.`
  );
  writeFileSync(fullPath, replacement, "utf-8");

  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const filePath = buildFilePath(storage, llm, "supersession", now);
  writeRecord(filePath, {
    schema_version: 1,
    timestamp: now.toISOString(),
    original_artifact: fullPath,
    replacement_artifact: fullPath,
    archive_artifact: archivePath,
    artifact_type: artifactType(fullPath),
    assumption_id: row.id,
    assumption_text: row.assumption,
    assumption_basis: row.basis,
    reason,
    original_model: readOriginalModel(originalText),
    days_to_invalidation: originalDaysToInvalidation,
    llm_provider: llm.provider,
    llm_model: llm.model,
    llm_id: llm.id,
  });

  return {
    artifact_path: fullPath,
    assumption_id: assumptionId,
    archive_path: archivePath,
    replacement_path: fullPath,
    status: "superseded",
  };
}

export function listAssumptions(targetPath: string, includeArchived = false): ListedAssumptionsResult {
  const start = Date.now();
  const fullPath = resolve(targetPath);
  const files = statSync(fullPath).isDirectory() ? scanMarkdownFiles(fullPath, includeArchived) : [fullPath];
  const items = files
    .map((file) => {
      const parsed = parseAssumptions(readText(file));
      return {
        artifact_path: file,
        artifact_type: artifactType(file),
        assumptions: parsed.assumptions,
        empty: parsed.empty,
      };
    })
    .filter((item) => item.assumptions.length > 0 || item.empty)
    .map(({ artifact_path, artifact_type, assumptions }) => ({ artifact_path, artifact_type, assumptions }));

  return { path: fullPath, items, durationMs: Date.now() - start };
}

export function getSupersessionHistory(
  targetPath: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  since?: string,
  artifactType?: string
): SupersessionHistoryResult {
  const start = Date.now();
  const storage = buildStoragePaths(service.rootPath, service, config.value.metrics.db_path);
  const root = join(storage.storageRoot, storage.org, storage.repo, storage.service);
  const events: SupersessionHistoryResult["events"] = [];
  const sinceValue = since ? Date.parse(since) : null;

  function scan(dir: string) {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) scan(full);
      else if (/_supersession_/.test(entry) && entry.endsWith(".jsonl")) {
        for (const line of readText(full).split(/\r?\n/).filter(Boolean)) {
          try {
            const parsed = JSON.parse(line) as SupersessionHistoryResult["events"][number];
            const stamp = Date.parse(parsed.timestamp);
            if (sinceValue && !Number.isNaN(stamp) && stamp < sinceValue) continue;
            if (artifactType && parsed.artifact_type !== artifactType) continue;
            if (!resolve(parsed.original_artifact).startsWith(resolve(targetPath))) continue;
            events.push(parsed);
          } catch {}
        }
      }
    }
  }

  scan(root);
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { path: resolve(targetPath), events, durationMs: Date.now() - start };
}

export function getAssumptionMetrics(
  targetPath: string,
  service: ServiceInfo,
  config: ResolvedConfig,
  since?: string
): AssumptionMetricsResult {
  const start = Date.now();
  const listing = listAssumptions(targetPath, true);
  const history = getSupersessionHistory(targetPath, service, config, since);
  const sinceMs = since ? Date.parse(since) : null;

  const assumptionRows = listing.items.flatMap((item) =>
    item.assumptions.map((row) => ({
      ...row,
      artifact_type: item.artifact_type,
      artifact_path: item.artifact_path,
      model: readOriginalModel(readText(item.artifact_path)),
    }))
  );

  const assumptionsMade = assumptionRows.length;
  const assumptionsInvalidated = assumptionRows.filter((row) => /invalidated/i.test(row.status)).length;
  const days = history.events
    .map((event) => event.days_to_invalidation)
    .filter((value): value is number => typeof value === "number")
    .map((value) => Math.max(0, value));
  const averageDays = days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : null;

  const artifactTypeMap = new Map<string, { made: number; invalidated: number }>();
  for (const row of assumptionRows) {
    const current = artifactTypeMap.get(row.artifact_type) ?? { made: 0, invalidated: 0 };
    current.made += 1;
    if (/invalidated/i.test(row.status)) current.invalidated += 1;
    artifactTypeMap.set(row.artifact_type, current);
  }

  const categoryMap = new Map<string, number>();
  for (const event of history.events) {
    const category = classifyAssumption(event.assumption_text, event.reason);
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
  }

  const modelMap = new Map<string, { made: number; invalidated: number }>();
  for (const row of assumptionRows) {
    const current = modelMap.get(row.model) ?? { made: 0, invalidated: 0 };
    current.made += 1;
    if (/invalidated/i.test(row.status)) current.invalidated += 1;
    modelMap.set(row.model, current);
  }

  const historyBuckets = new Map<string, { made: number; invalidated: number }>();
  for (const row of assumptionRows) {
    let bucket = "current";
    if (sinceMs !== null) {
      const stamp = statSync(row.artifact_path).mtime.getTime();
      if (stamp < sinceMs) continue;
    }
    const current = historyBuckets.get(bucket) ?? { made: 0, invalidated: 0 };
    current.made += 1;
    if (/invalidated/i.test(row.status)) current.invalidated += 1;
    historyBuckets.set(bucket, current);
  }
  for (const event of history.events) {
    const day = event.timestamp.slice(0, 10);
    const current = historyBuckets.get(day) ?? { made: 0, invalidated: 0 };
    current.invalidated += 1;
    historyBuckets.set(day, current);
  }
  const historySeries = [...historyBuckets.entries()]
    .map(([timestamp, value]) => ({
      timestamp,
      invalidation_rate: value.made > 0 ? (value.invalidated / value.made) * 100 : 0,
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    path: resolve(targetPath),
    since: since ?? null,
    totals: {
      assumptions_made: assumptionsMade,
      assumptions_invalidated: assumptionsInvalidated,
      invalidation_rate: assumptionsMade > 0 ? (assumptionsInvalidated / assumptionsMade) * 100 : null,
      average_days_to_invalidation: averageDays,
      trend: history.events.length >= 2 ? trend(historySeries.map((item) => item.invalidation_rate)) : "insufficient_data",
    },
    by_artifact_type: [...artifactTypeMap.entries()].map(([artifact_type, value]) => ({
      artifact_type,
      made: value.made,
      invalidated: value.invalidated,
      invalidation_rate: value.made > 0 ? (value.invalidated / value.made) * 100 : null,
    })),
    top_invalidated_categories: [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([category, count]) => ({ category, count })),
    by_model: [...modelMap.entries()].map(([model, value]) => ({
      model,
      assumptions_made: value.made,
      assumptions_invalidated: value.invalidated,
      invalidation_rate: value.made > 0 ? (value.invalidated / value.made) * 100 : null,
    })),
    history: historySeries,
    durationMs: Date.now() - start,
  };
}
