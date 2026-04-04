// Story 016 — Storage Architecture (DuckDB + Parquet via JSONL)
// v1 implementation: writes JSONL; DuckDB reads via read_json_auto.
// Parquet migration tracked as a follow-up story.
import { existsSync, mkdirSync, writeFileSync, renameSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { LLMIdentity, ServiceInfo } from "./types.js";

// ─── Path resolution ──────────────────────────────────────────────────────────

export interface StoragePaths {
  storageRoot: string;
  org: string;
  repo: string;
  service: string;
  commit8: string;
  branch: string;
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

function resolveStorageRoot(configured: string): string {
  return configured.replace(/^~/, homedir());
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
    storageRoot: resolveStorageRoot(storageRoot),
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

  const filename = `${paths.commit8}_${paths.branch}_${llm.id}_${checkType}_${hhmmssmmm}.jsonl`;

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

    const line = JSON.stringify(record) + "\n";
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, line, "utf-8");
    renameSync(tmp, filePath);
  } catch (e) {
    // Non-fatal: log to stderr, never throw
    process.stderr.write(`[spec-check] storage write failed: ${String(e)}\n`);
  }
}

export function buildGateRecord(opts: {
  projectRoot: string;
  org: string;
  repo: string;
  service: string;
  commit8: string;
  branch: string;
  llm: LLMIdentity;
  gate: string;
  triggeredBy: string;
  gateStatus: string;
  results: unknown[];
  durationMs: number;
  timestamp: Date;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    project_path: opts.projectRoot,
    project_name: opts.repo,
    org: opts.org,
    repo: opts.repo,
    service: opts.service,
    timestamp: opts.timestamp.toISOString(),
    git_commit: opts.commit8,
    branch: opts.branch,
    llm_provider: opts.llm.provider,
    llm_model: opts.llm.model,
    llm_id: opts.llm.id,
    gate: opts.gate,
    triggered_by: opts.triggeredBy,
    gate_status: opts.gateStatus,
    results: JSON.stringify(opts.results),
    duration_ms: opts.durationMs,
  };
}

// ─── DuckDB query ─────────────────────────────────────────────────────────────
// Returns a string of SQL that callers can pass to DuckDB.
// Actual DuckDB execution deferred to metrics layer (Story 017+).

export function globPattern(storageRoot: string, ...parts: string[]): string {
  const resolved = resolveStorageRoot(storageRoot);
  const segments = parts.length > 0 ? parts.join("/") : "**/*";
  return join(resolved, segments);
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
