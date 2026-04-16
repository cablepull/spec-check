// Story 021 — Configuration
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { type SpecCheckConfig, type ResolvedConfig, DEFAULT_CONFIG } from "./types.js";

type ConfigSource = "default" | "global" | "project";

export interface ConfigError {
  type: "CONFIG_PARSE_ERROR" | "CONFIG_VALIDATION_ERROR";
  file: string;
  message: string;
  detail?: string;
}

function globalConfigPath(): string {
  return join(homedir(), ".spec-check", "config.json");
}

function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, "spec-check.config.json");
}

function loadFile(filePath: string): { data: Partial<SpecCheckConfig> | null; error: ConfigError | null } {
  if (!existsSync(filePath)) return { data: null, error: null };
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Partial<SpecCheckConfig>;
    return { data, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      data: null,
      error: { type: "CONFIG_PARSE_ERROR", file: filePath, message: "Invalid JSON", detail: msg },
    };
  }
}

function validateThresholds(
  thresholds: Record<string, number | undefined>,
  file: string
): ConfigError | null {
  const nlpKeys = ["I-2","I-3","I-4","I-5","R-3","R-5","R-7","R-8","R-9","R-10",
                   "D-3","D-4","T-2","T-3","T-4","E-2","AS-3"];
  for (const key of nlpKeys) {
    const v = thresholds[key];
    if (v !== undefined && (typeof v !== "number" || v < 0 || v > 1)) {
      return {
        type: "CONFIG_VALIDATION_ERROR", file,
        message: `Threshold "${key}" must be a number between 0.0 and 1.0, got: ${v}`,
      };
    }
  }
  return null;
}

function validateWeights(
  weights: { G1?: number; G2?: number; G3?: number; G4?: number; G5?: number },
  file: string
): ConfigError | null {
  const vals = [weights.G1, weights.G2, weights.G3, weights.G4, weights.G5];
  if (vals.every((v) => v !== undefined)) {
    const sum = (vals as number[]).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      return {
        type: "CONFIG_VALIDATION_ERROR", file,
        message: `compliance_weights must sum to 1.0, got ${sum.toFixed(3)}`,
      };
    }
  }
  return null;
}

const OBJECT_MERGE_KEYS = new Set<keyof SpecCheckConfig>(["compliance_weights", "monorepo", "mutation"]);

function applyConfigKey(
  result: SpecCheckConfig,
  sources: Record<string, ConfigSource>,
  key: keyof SpecCheckConfig,
  val: unknown,
  source: ConfigSource
): void {
  if (key === "thresholds" && typeof val === "object" && val !== null) {
    Object.assign(result.thresholds, val);
    for (const k of Object.keys(val as object)) sources[`thresholds.${k}`] = source;
    return;
  }
  if (OBJECT_MERGE_KEYS.has(key) && typeof val === "object" && val !== null) {
    Object.assign(result[key] as object, val);
    sources[key] = source;
    return;
  }
  // @ts-expect-error dynamic assignment
  result[key] = val;
  sources[key] = source;
}

// Deep merge: project values override global, global overrides defaults.
// Returns merged config plus a sources map for each top-level key.
function mergeConfigs(
  defaults: SpecCheckConfig,
  global: Partial<SpecCheckConfig> | null,
  project: Partial<SpecCheckConfig> | null
): ResolvedConfig {
  const sources: Record<string, ConfigSource> = {};
  const result = structuredClone(defaults);

  const apply = (layer: Partial<SpecCheckConfig> | null, source: ConfigSource) => {
    if (!layer) return;
    for (const key of Object.keys(layer) as Array<keyof SpecCheckConfig>) {
      const val = layer[key];
      if (val === undefined) continue;
      applyConfigKey(result, sources, key, val, source);
    }
  };

  // Mark all defaults
  for (const k of Object.keys(defaults)) sources[k] = "default";

  apply(global, "global");
  apply(project, "project");

  return { value: result, sources };
}

function validateConfigLayer(
  data: Partial<SpecCheckConfig> | null,
  path: string | null,
  errors: ConfigError[]
): void {
  if (!data || !path) return;
  if (data.thresholds) {
    const e = validateThresholds(data.thresholds, path);
    if (e) errors.push(e);
  }
  if (data.compliance_weights) {
    const e = validateWeights(data.compliance_weights, path);
    if (e) errors.push(e);
  }
}

export function loadConfig(projectRoot?: string): {
  config: ResolvedConfig;
  errors: ConfigError[];
} {
  const errors: ConfigError[] = [];

  const { data: globalData, error: globalError } = loadFile(globalConfigPath());
  if (globalError) errors.push(globalError);

  const projectPath = projectRoot ? projectConfigPath(projectRoot) : null;
  const { data: projectData, error: projectError } = projectPath
    ? loadFile(projectPath)
    : { data: null, error: null };
  if (projectError) errors.push(projectError);

  validateConfigLayer(globalData, globalConfigPath(), errors);
  validateConfigLayer(projectData, projectPath, errors);

  const safeGlobal = globalError ? null : globalData;
  const safeProject = projectError ? null : projectData;

  return {
    config: mergeConfigs(DEFAULT_CONFIG, safeGlobal, safeProject),
    errors,
  };
}

export function getThreshold(config: ResolvedConfig, key: string): number {
  return (config.value.thresholds[key] as number | undefined) ??
    (DEFAULT_CONFIG.thresholds[key] as number | undefined) ?? 0.7;
}
