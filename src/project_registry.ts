import { mkdirSync, existsSync, readFileSync, writeFileSync, realpathSync, renameSync, rmSync } from "fs";
import { dirname, resolve } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

export interface RegisteredProject {
  project_id: string;
  name: string;
  path: string;
  created_at: string;
}

interface ProjectRegistryFile {
  projects: RegisteredProject[];
}

function sanitiseProjectId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

function registryPath(): string {
  const override = process.env["SPEC_CHECK_PROJECT_REGISTRY"];
  if (override && override.trim()) return resolve(override);
  return resolve(homedir(), ".spec-check", "projects.json");
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function loadRegistry(): ProjectRegistryFile {
  const path = registryPath();
  if (!existsSync(path)) return { projects: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ProjectRegistryFile>;
    return { projects: Array.isArray(raw.projects) ? raw.projects : [] };
  } catch {
    return { projects: [] };
  }
}

function saveRegistry(registry: ProjectRegistryFile): void {
  const path = registryPath();
  ensureParent(path);
  const tmpPath = `${path}.${randomUUID().replace(/-/g, "")}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(registry, null, 2));
    renameSync(tmpPath, path);
  } finally {
    try { rmSync(tmpPath, { force: true }); } catch {}
  }
}

export function canonicalProjectPath(inputPath: string): string {
  const absPath = resolve(inputPath);
  return realpathSync(absPath);
}

export function listRegisteredProjects(): RegisteredProject[] {
  return loadRegistry().projects.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function registerProject(inputPath: string, name?: string): RegisteredProject {
  const path = canonicalProjectPath(inputPath);
  const fallbackName = path.split("/").filter(Boolean).at(-1) ?? "project";
  const projectName = (name?.trim() || fallbackName).trim();
  const projectId = sanitiseProjectId(projectName);
  if (!projectId) throw new Error("Project name must contain at least one alphanumeric character.");

  const registry = loadRegistry();
  const existingByPath = registry.projects.find((project) => project.path === path);
  if (existingByPath) return existingByPath;

  const existingById = registry.projects.find((project) => project.project_id === projectId);
  if (existingById) {
    throw new Error(`Project id "${projectId}" is already registered for ${existingById.path}.`);
  }

  const record: RegisteredProject = {
    project_id: projectId,
    name: projectName,
    path,
    created_at: new Date().toISOString(),
  };
  registry.projects.push(record);
  saveRegistry(registry);
  return record;
}

export function getRegisteredProject(projectId: string): RegisteredProject | null {
  const id = sanitiseProjectId(projectId);
  return loadRegistry().projects.find((project) => project.project_id === id) ?? null;
}
