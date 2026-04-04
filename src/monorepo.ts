// Story 022 — Monorepo Detection and Service Routing
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import type { ServiceMap, ServiceInfo, ResolvedConfig } from "./types.js";

const SKIP_DIRS = new Set([
  "node_modules", "vendor", "dist", "build", ".git", ".github",
  ".next", "__pycache__", ".cache", "coverage",
]);

const DEFAULT_ROOT_CHECKS = ["diff", "deps", "gate-adr", "gate-rca"];

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function listDirs(parent: string): string[] {
  if (!existsSync(parent)) return [];
  try {
    return readdirSync(parent).filter((d) => {
      if (SKIP_DIRS.has(d) || d.startsWith(".")) return false;
      return statSync(join(parent, d)).isDirectory();
    });
  } catch {
    return [];
  }
}

function normaliseName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hasManifest(dir: string, manifests: string[]): boolean {
  return manifests.some((m) => existsSync(join(dir, m)));
}

// Step 1: check root package.json for workspaces
function detectWorkspaces(
  root: string
): string[] | null {
  const pkg = readJson<{ workspaces?: string[] | { packages?: string[] } }>(
    join(root, "package.json")
  );
  if (!pkg) return null;
  const ws = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : pkg.workspaces?.packages;
  if (!ws || ws.length === 0) return null;
  const results = new Set<string>();
  for (const pattern of ws) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      const fullBase = join(root, base);
      if (!existsSync(fullBase)) continue;
      for (const entry of listDirs(fullBase)) {
        results.add(join(base, entry));
      }
      continue;
    }
    const clean = pattern.replace(/\*/g, "");
    if (existsSync(join(root, clean))) results.add(clean.replace(/\/$/, ""));
  }
  return results.size > 0 ? [...results] : null;
}

// Step 2: scan for manifests at depth 1–2 (not root itself)
function detectSubdirManifests(
  root: string,
  manifests: string[],
  maxDepth: number
): string[] {
  const found: string[] = [];
  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;
    for (const entry of listDirs(dir)) {
      const full = join(dir, entry);
      if (hasManifest(full, manifests)) {
        found.push(normaliseName(entry));
      } else if (depth < maxDepth) {
        scan(full, depth + 1);
      }
    }
  }
  scan(root, 1);
  return [...new Set(found)];
}

// Step 3: conventional monorepo directories
const CONVENTIONAL_DIRS = ["packages", "apps", "services", "modules", "libs"];
function detectConventionalDirs(root: string): string[] | null {
  for (const cdir of CONVENTIONAL_DIRS) {
    const full = join(root, cdir);
    if (!existsSync(full) || !statSync(full).isDirectory()) continue;
    const subs = listDirs(full);
    if (subs.length > 0) return subs.map(normaliseName);
  }
  return null;
}

function buildServiceInfo(
  root: string,
  name: string,
  servicePath: string,
  specPath?: string
): ServiceInfo {
  const resolvedSpec = specPath
    ? resolve(root, specPath)
    : existsSync(join(servicePath, "specs"))
    ? join(servicePath, "specs")
    : existsSync(join(servicePath, "requirements.md"))
    ? servicePath
    : servicePath;

  return { name, rootPath: root, servicePath, specPath: resolvedSpec };
}

export function detectServices(root: string, config: ResolvedConfig): ServiceMap {
  const monoCfg = config.value.monorepo;
  const rootChecks = monoCfg.root_checks ?? DEFAULT_ROOT_CHECKS;

  // Strategy: flat — always root
  if (monoCfg.strategy === "flat") {
    return {
      projectRoot: root,
      services: [buildServiceInfo(root, "root", root)],
      isMonorepo: false,
      strategy: "flat",
      rootChecks,
    };
  }

  // Strategy: explicit services
  if (monoCfg.strategy === "services" || monoCfg.strategy === "explicit") {
    const defs = monoCfg.services ?? [];
    if (defs.length > 0) {
      const services = defs.map((d) =>
        buildServiceInfo(root, normaliseName(d.name), resolve(root, d.path), d.spec_path)
      );
      return { projectRoot: root, services, isMonorepo: true, strategy: "services", rootChecks };
    }
    // Explicit but no services defined — fall back to root
    return {
      projectRoot: root,
      services: [buildServiceInfo(root, "root", root)],
      isMonorepo: false,
      strategy: "explicit-fallback",
      rootChecks,
    };
  }

  // Strategy: auto (default)
  const manifests = monoCfg.auto_detect?.manifests ?? DEFAULT_ROOT_CHECKS;
  const depth = monoCfg.auto_detect?.depth ?? 2;

  // Step 1: workspaces in root package.json
  if (monoCfg.auto_detect?.workspaces !== false) {
    const ws = detectWorkspaces(root);
    if (ws && ws.length > 0) {
      const services = ws.map((relPath) => {
        const found = join(root, relPath);
        const name = normaliseName(relPath.split("/").pop() ?? relPath);
        return buildServiceInfo(root, name, found);
      });
      return { projectRoot: root, services, isMonorepo: true, strategy: "auto-workspaces", rootChecks };
    }
  }

  // Step 2: manifest files at depth 1–2
  const subdirServices = detectSubdirManifests(root, manifests, depth);
  if (subdirServices.length > 0) {
    const services = subdirServices.map((name) => {
      const full = join(root, name);
      return buildServiceInfo(root, name, existsSync(full) ? full : root);
    });
    return { projectRoot: root, services, isMonorepo: true, strategy: "auto-manifests", rootChecks };
  }

  // Step 3: conventional dirs
  const conventional = detectConventionalDirs(root);
  if (conventional && conventional.length > 0) {
    const cdir = CONVENTIONAL_DIRS.find((d) => existsSync(join(root, d)))!;
    const services = conventional.map((name) =>
      buildServiceInfo(root, name, join(root, cdir, name))
    );
    return { projectRoot: root, services, isMonorepo: true, strategy: "auto-conventional", rootChecks };
  }

  // Step 4: fallback to root
  return {
    projectRoot: root,
    services: [buildServiceInfo(root, "root", root)],
    isMonorepo: false,
    strategy: "auto-flat",
    rootChecks,
  };
}
