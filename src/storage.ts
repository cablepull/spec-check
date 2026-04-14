// Story 016 — Storage Architecture (DuckDB + Parquet)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join, dirname, resolve, isAbsolute } from "path";
import { homedir, tmpdir } from "os";
import { execFileSync, execSync } from "child_process";
import type { ActorIdentity, LLMIdentity, ServiceInfo } from "./types.js";

// ─── Path resolution ──────────────────────────────────────────────────────────

export interface StoragePaths {
  storageRoot: string;
  org: string;
  repo: string;
  service: string;
  commit8: string;
  branch: string;
}

export interface LegacyMigrationReport {
  found: number;
  migrated: number;
  removed: number;
  skipped: number;
  failed: number;
  remaining: number;
}

function sanitiseBranch(raw: string): string {
  return raw.replace(/\//g, "__").replace(/\s+/g, "-").slice(0, 40) || "unknown";
}

function sanitiseName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-_.]/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function gitCommand(cmd: string, cwd: string): string {
  try {
    return execSync(`git -C "${cwd}" ${cmd}`, { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }).trim();
  } catch {
    return "";
  }
}

function resolveOrgRepo(cwd: string): { org: string; repo: string } {
  const remote = gitCommand("remote get-url origin", cwd);
  if (!remote) return { org: "local", repo: sanitiseName(cwd.split("/").pop() ?? "unknown") };

  // Parse github.com/org/repo, git@github.com:org/repo, etc.
  const match = remote.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (match) {
    return {
      org: sanitiseName(match[1]!),
      repo: sanitiseName(match[2]!),
    };
  }
  return { org: "local", repo: sanitiseName(cwd.split("/").pop() ?? "unknown") };
}

function resolveStorageRoot(configured: string, projectRoot?: string): string {
  const withHome = configured.replace(/^~/, homedir());
  if (isAbsolute(withHome)) return withHome;
  // Relative paths are resolved against the project root, not the process cwd.
  return resolve(projectRoot ?? process.cwd(), withHome);
}

export function buildStoragePaths(
  projectRoot: string,
  service: ServiceInfo,
  storageRoot: string
): StoragePaths {
  const { org, repo } = resolveOrgRepo(projectRoot);
  const commit8 = gitCommand("rev-parse --short=8 HEAD", projectRoot) || "no-commit";
  const branch = sanitiseBranch(gitCommand("branch --show-current", projectRoot) || "unknown");
  return {
    storageRoot: resolveStorageRoot(storageRoot, projectRoot),
    org,
    repo,
    service: sanitiseName(service.name),
    commit8,
    branch,
  };
}

export function buildFilePath(
  paths: StoragePaths,
  llm: LLMIdentity,
  checkType: string,
  timestamp: Date = new Date()
): string {
  const yyyy = timestamp.getUTCFullYear().toString();
  const mm = (timestamp.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = timestamp.getUTCDate().toString().padStart(2, "0");
  const hhmmssmmm =
    timestamp.getUTCHours().toString().padStart(2, "0") +
    timestamp.getUTCMinutes().toString().padStart(2, "0") +
    timestamp.getUTCSeconds().toString().padStart(2, "0") +
    timestamp.getUTCMilliseconds().toString().padStart(3, "0");

  const filename = `${paths.commit8}_${paths.branch}_${llm.id}_${checkType}_${hhmmssmmm}.parquet`;

  return join(
    paths.storageRoot,
    paths.org,
    paths.repo,
    paths.service,
    yyyy,
    mm,
    dd,
    filename
  );
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function writeRecord(
  filePath: string,
  record: Record<string, unknown>
): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpJson = filePath + ".tmp.json";
    const tmpParquet = filePath + ".tmp.parquet";
    const serialised = Object.fromEntries(
      Object.entries(record).map(([key, value]) => {
        if (value === undefined) return [key, null];
        if (value === null) return [key, null];
        if (Array.isArray(value)) return [key, JSON.stringify(value)];
        if (typeof value === "object") return [key, JSON.stringify(value)];
        return [key, value];
      })
    );
    writeFileSync(tmpJson, JSON.stringify(serialised) + "\n", "utf-8");

    execFileSync(process.execPath, ["-e", `
      const duckdb = require("duckdb");
      const db = new duckdb.Database(":memory:");
      const src = process.argv[1];
      const out = process.argv[2];
      db.run("COPY (SELECT * FROM read_json_auto('" + src.replace(/'/g, "''") + "')) TO '" + out.replace(/'/g, "''") + "' (FORMAT PARQUET)", (err) => {
        if (err) throw err;
        db.close(() => process.exit(0));
      });
    `, tmpJson, tmpParquet], { stdio: ["ignore", "ignore", "pipe"] });
    renameSync(tmpParquet, filePath);
    try { rmSync(tmpJson, { force: true }); } catch {}
    try { rmSync(tmpParquet, { force: true }); } catch {}
  } catch (e) {
    // Non-fatal: log to stderr, never throw
    process.stderr.write(`[spec-check] storage write failed: ${String(e)}\n`);
    try { rmSync(filePath + ".tmp.json", { force: true }); } catch {}
    try { rmSync(filePath + ".tmp.parquet", { force: true }); } catch {}
  }
}

function convertJsonlToParquet(sourcePath: string, targetPath: string): void {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpParquet = targetPath + ".tmp.parquet";
  execFileSync(process.execPath, ["-e", `
    const duckdb = require("duckdb");
    const db = new duckdb.Database(":memory:");
    const src = process.argv[1];
    const out = process.argv[2];
    db.run("COPY (SELECT * FROM read_json_auto('" + src.replace(/'/g, "''") + "')) TO '" + out.replace(/'/g, "''") + "' (FORMAT PARQUET)", (err) => {
      if (err) throw err;
      db.close(() => process.exit(0));
    });
  `, sourcePath, tmpParquet], { stdio: ["ignore", "ignore", "pipe"] });
  renameSync(tmpParquet, targetPath);
  try { rmSync(tmpParquet, { force: true }); } catch {}
}

export function findLegacyJsonlFiles(storageRoot: string, projectRoot?: string): string[] {
  const resolved = resolveStorageRoot(storageRoot, projectRoot);
  if (!existsSync(resolved)) return [];
  const files: string[] = [];
  function scan(current: string) {
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      const full = join(current, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        scan(full);
      } else if (stat.isFile() && full.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }
  scan(resolved);
  return files.sort();
}

export function migrateLegacyJsonlRecords(storageRoot: string, projectRoot?: string): LegacyMigrationReport {
  const files = findLegacyJsonlFiles(storageRoot, projectRoot);
  const report: LegacyMigrationReport = {
    found: files.length,
    migrated: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
  };
  for (const file of files) {
    const target = file.replace(/\.jsonl$/i, ".parquet");
    try {
      if (existsSync(target)) {
        rmSync(file, { force: true });
        report.removed += 1;
        continue;
      }
      const preview = readFileSync(file, "utf-8").trim();
      if (!preview) {
        rmSync(file, { force: true });
        report.removed += 1;
        continue;
      }
      convertJsonlToParquet(file, target);
      rmSync(file, { force: true });
      report.migrated += 1;
    } catch (error) {
      report.failed += 1;
      process.stderr.write(`[spec-check] legacy storage migration failed for ${file}: ${String(error)}\n`);
    }
  }
  report.remaining = findLegacyJsonlFiles(storageRoot, projectRoot).length;
  return report;
}

export function globPattern(storageRoot: string, ...parts: string[]): string {
  const base = resolveStorageRoot(storageRoot);
  return join(base, ...parts, "**", "*.parquet");
}

export function runDuckQuery(sql: string): any[] {
  const outputPath = join(tmpdir(), `spec-check-duck-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    execFileSync(process.execPath, ["-e", `
      const duckdb = require("duckdb");
      const fs = require("fs");
      const db = new duckdb.Database(":memory:");
      const sql = process.argv[1];
      const out = process.argv[2];
      db.all(sql, (err, rows) => {
        if (err) {
          console.error(String(err));
          process.exit(1);
        }
        fs.writeFileSync(out, JSON.stringify(rows, (_key, value) => typeof value === "bigint" ? Number(value) : value), "utf-8");
        db.close(() => process.exit(0));
      });
    `, sql, outputPath], { encoding: "utf-8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 16 * 1024 * 1024 });
    const output = readFileSync(outputPath, "utf-8");
    return output ? JSON.parse(output) as any[] : [];
  } catch (error) {
    const message = String(error);
    if (message.includes("No files found that match the pattern")) {
      return [];
    }
    throw error;
  } finally {
    try { rmSync(outputPath, { force: true }); } catch {}
  }
}

export function buildGateRecord(opts: {
  projectRoot: string;
  org: string;
  repo: string;
  service: string;
  commit8: string;
  branch: string;
  llm: ActorIdentity | LLMIdentity;
  gate: string;
  triggeredBy: string;
  gateStatus: string;
  results: unknown[];
  durationMs: number;
  timestamp: Date;
  runBatchId: string | null;
}): Record<string, unknown> {
  return {
    schema_version: 2,
    check_type: "gate",
    project_path: opts.projectRoot,
    org: opts.org,
    repo: opts.repo,
    service: opts.service,
    timestamp: opts.timestamp.toISOString(),
    git_commit: opts.commit8,
    branch: opts.branch,
    llm_provider: opts.llm.provider,
    llm_model: opts.llm.model,
    llm_id: opts.llm.id,
    agent_id: "agent_id" in opts.llm ? opts.llm.agent_id : undefined,
    agent_kind: "agent_kind" in opts.llm ? opts.llm.agent_kind : undefined,
    parent_agent_id: "parent_agent_id" in opts.llm ? opts.llm.parent_agent_id : undefined,
    session_id: "session_id" in opts.llm ? opts.llm.session_id : undefined,
    run_id: "run_id" in opts.llm ? opts.llm.run_id : undefined,
    gate: opts.gate,
    triggered_by: opts.triggeredBy,
    run_batch_id: opts.runBatchId,
    status: opts.gateStatus,
    gate_status: opts.gateStatus,
    criteria: opts.results,
    results: opts.results,
    duration_ms: opts.durationMs,
  };
}

// Smoke test: verify storage root is accessible
export function smokeTest(storageRoot: string): { ok: boolean; error?: string } {
  try {
    const resolved = resolveStorageRoot(storageRoot);
    if (!existsSync(resolved)) {
      mkdirSync(resolved, { recursive: true });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
