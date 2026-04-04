import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import type { FailureReason, InstallFailure } from "./types.js";

type PackageManager = "pipx" | "pip" | "npm" | "yarn" | "pnpm" | "go";
type RuntimeName = "python" | "node" | "go";

interface DependencySpec {
  name: string;
  check: string;
  install: Partial<Record<PackageManager, string>>;
  requiresRuntime: RuntimeName;
  covers: string[];
  languages: string[];
}

interface DependencyStatus {
  name: string;
  installed: boolean;
  version: string | null;
  covers: string[];
  languages: string[];
  requires_runtime: RuntimeName;
  runtime_available: boolean;
  check_command: string;
  install_commands: Partial<Record<PackageManager, string>>;
  missing_reason?: string;
}

interface CheckDependenciesResult {
  available_package_managers: Record<PackageManager, boolean>;
  available_runtimes: Record<RuntimeName, boolean>;
  installed: DependencyStatus[];
  missing: DependencyStatus[];
  unavailable_metrics: Array<{ metric: string; languages: string[]; dependencies: string[] }>;
  durationMs: number;
}

interface InstallDependencySuccess {
  ok: true;
  dependency: string;
  manager: PackageManager;
  version: string | null;
  stdout: string;
  stderr: string;
}

interface InstallDependencyFailure {
  ok: false;
  manager?: PackageManager;
  failure: InstallFailure;
}

type InstallDependencyResult = InstallDependencySuccess | InstallDependencyFailure;

export const DEPENDENCY_REGISTRY: Record<string, DependencySpec> = {
  lizard: {
    name: "lizard",
    check: "lizard --version",
    install: { pipx: "pipx install lizard", pip: "pip install lizard" },
    requiresRuntime: "python",
    covers: ["cc", "length"],
    languages: ["java", "c", "cpp", "csharp", "ruby", "swift", "rust"],
  },
  gocognit: {
    name: "gocognit",
    check: "gocognit -help",
    install: { go: "go install github.com/uudashr/gocognit/cmd/gocognit@latest" },
    requiresRuntime: "go",
    covers: ["cognitive_complexity"],
    languages: ["go"],
  },
  radon: {
    name: "radon",
    check: "radon --version",
    install: { pipx: "pipx install radon", pip: "pip install radon" },
    requiresRuntime: "python",
    covers: ["cc", "cognitive_complexity", "length"],
    languages: ["python"],
  },
  stryker: {
    name: "stryker",
    check: "npx --no-install stryker --version",
    install: {
      npm: "npm install --save-dev @stryker-mutator/core @stryker-mutator/typescript-checker",
      yarn: "yarn add --dev @stryker-mutator/core @stryker-mutator/typescript-checker",
      pnpm: "pnpm add --save-dev @stryker-mutator/core @stryker-mutator/typescript-checker",
    },
    requiresRuntime: "node",
    covers: ["mutation_score"],
    languages: ["typescript", "javascript"],
  },
  mutmut: {
    name: "mutmut",
    check: "mutmut --version",
    install: { pipx: "pipx install mutmut", pip: "pip install mutmut" },
    requiresRuntime: "python",
    covers: ["mutation_score"],
    languages: ["python"],
  },
  "go-mutesting": {
    name: "go-mutesting",
    check: "go-mutesting --help",
    install: { go: "go install github.com/zimmski/go-mutesting/...@latest" },
    requiresRuntime: "go",
    covers: ["mutation_score"],
    languages: ["go"],
  },
};

const PACKAGE_MANAGER_PRIORITY: Record<RuntimeName, PackageManager[]> = {
  python: ["pipx", "pip", "npm", "yarn", "pnpm", "go"],
  node: ["npm", "yarn", "pnpm", "pipx", "pip", "go"],
  go: ["go", "pipx", "pip", "npm", "yarn", "pnpm"],
};

function runShell(command: string, cwd?: string, timeout = 30_000) {
  return spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf-8",
    timeout,
    env: process.env,
  });
}

function probeBinary(name: string): boolean {
  const probe = process.platform === "win32" ? `where ${name}` : `command -v ${name}`;
  return runShell(probe).status === 0;
}

function parseVersion(output: string): string | null {
  const clean = output.trim();
  if (!clean) return null;
  const match = clean.match(/\b\d+(?:\.\d+){0,3}\b/);
  return match?.[0] ?? clean.split("\n")[0]!.trim();
}

function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

export function detectPackageManagers(): Record<PackageManager, boolean> {
  return {
    pipx: probeBinary("pipx"),
    pip: probeBinary("pip"),
    npm: probeBinary("npm"),
    yarn: probeBinary("yarn"),
    pnpm: probeBinary("pnpm"),
    go: probeBinary("go"),
  };
}

export function detectRuntimes(): Record<RuntimeName, boolean> {
  return {
    python: probeBinary("python3") || probeBinary("python"),
    node: probeBinary("node"),
    go: probeBinary("go"),
  };
}

function commonBinaryPaths(dep: DependencySpec, projectRoot?: string): string[] {
  const paths: string[] = [];
  const home = homedir();
  if (dep.requiresRuntime === "python") {
    paths.push(join(home, ".local", "bin", dep.name));
  }
  if (dep.requiresRuntime === "go") {
    paths.push(join(home, "go", "bin", dep.name));
  }
  if (projectRoot) {
    paths.push(join(projectRoot, "node_modules", ".bin", dep.name));
  }
  return paths;
}

function classifyFailure(dep: DependencySpec, rawOutput: string, projectRoot?: string): InstallFailure {
  const output = rawOutput.trim();
  const binaryPaths = commonBinaryPaths(dep, projectRoot);
  const firstExistingPath = binaryPaths.find((path) => existsSync(path));

  const patterns: Array<{
    pattern: RegExp;
    reason: FailureReason;
    human: string;
    suggestion: string;
  }> = [
    {
      pattern: /command not found:\s*(python|python3|pip|pipx)|'python' is not recognized|'pip' is not recognized/i,
      reason: "RUNTIME_NOT_FOUND",
      human: "Python is not installed or not in PATH.",
      suggestion: "Install Python 3.8+ and retry, or use a Python-aware package manager such as pipx.",
    },
    {
      pattern: /go:\s*command not found|'go' is not recognized/i,
      reason: "RUNTIME_NOT_FOUND",
      human: "Go is not installed or not in PATH.",
      suggestion: "Install Go from go.dev and retry.",
    },
    {
      pattern: /permission denied|eacces|operation not permitted/i,
      reason: "PERMISSION_DENIED",
      human: "The install command needs elevated permissions or a user-space install strategy.",
      suggestion: "Use pipx where possible, or retry with permissions that allow the target install location.",
    },
    {
      pattern: /no matching distribution found|404 not found|not found in registry|package .* not found/i,
      reason: "PACKAGE_NOT_FOUND",
      human: "The package could not be found in the registry or the registry was unreachable.",
      suggestion: "Verify the package name and network access, then retry.",
    },
    {
      pattern: /dependency resolver|resolution impossible|unable to resolve dependency tree|conflict/i,
      reason: "VERSION_CONFLICT",
      human: "Dependency conflict detected during installation.",
      suggestion: "Retry in an isolated environment or adjust conflicting package versions.",
    },
    {
      pattern: /installed in .* not on path|not on PATH/i,
      reason: "PATH_NOT_UPDATED",
      human: "The tool appears to be installed, but its binary directory is not on PATH.",
      suggestion: `Add the install directory to PATH${firstExistingPath ? `, for example ${firstExistingPath.replace(`/${dep.name}`, "")}` : ""}.`,
    },
    {
      pattern: /no space left on device|insufficient disk space/i,
      reason: "DISK_SPACE",
      human: "Installation failed because there is not enough disk space.",
      suggestion: "Free disk space and retry.",
    },
    {
      pattern: /externally managed|conda|virtualenv|pyenv|nvm conflict|environment is externally managed/i,
      reason: "ENV_CONFLICT",
      human: "The active runtime environment conflicts with this installation method.",
      suggestion: "Use an isolated environment appropriate for the tool, such as pipx, venv, or the correct nvm shell.",
    },
    {
      pattern: /requires python\s*>?=\s*\d+\.\d+|requires go\s*>?=\s*\d+\.\d+|unsupported engine/i,
      reason: "RUNTIME_VERSION",
      human: "The required runtime is present but too old for this dependency.",
      suggestion: "Upgrade the required runtime to the minimum supported version, then retry.",
    },
  ];

  for (const entry of patterns) {
    if (entry.pattern.test(output)) {
      return {
        dependency: dep.name,
        reason: entry.reason,
        human_explanation: entry.human,
        suggestion: entry.suggestion,
        affects_metrics: dep.covers,
        affects_languages: dep.languages,
        raw_output: rawOutput,
      };
    }
  }

  if (firstExistingPath) {
    return {
      dependency: dep.name,
      reason: "PATH_NOT_UPDATED",
      human_explanation: "The dependency appears to have been installed, but the binary is still not discoverable on PATH.",
      suggestion: `Add ${firstExistingPath.replace(`/${dep.name}`, "")} to PATH and retry the check command.`,
      affects_metrics: dep.covers,
      affects_languages: dep.languages,
      raw_output: rawOutput,
    };
  }

  return {
    dependency: dep.name,
    reason: "UNKNOWN",
    human_explanation: "The install failed for an unrecognized reason.",
    suggestion: "Review raw_output and retry with a supported package manager or runtime configuration.",
    affects_metrics: dep.covers,
    affects_languages: dep.languages,
    raw_output: rawOutput,
  };
}

function inspectDependency(
  dep: DependencySpec,
  runtimes: Record<RuntimeName, boolean>,
  availableManagers: Record<PackageManager, boolean>,
  projectRoot?: string
): DependencyStatus {
  const token = firstToken(dep.check);
  const localNodeBinary = projectRoot ? join(projectRoot, "node_modules", ".bin", dep.name) : "";
  const checkCommand =
    dep.name === "stryker" && localNodeBinary && existsSync(localNodeBinary)
      ? `${localNodeBinary} --version`
      : dep.check;
  const shouldSkipDirectCheck =
    (dep.name === "stryker" && !existsSync(localNodeBinary)) ||
    (token !== "npx" && !probeBinary(token));

  const check = shouldSkipDirectCheck
    ? { status: 1, stdout: "", stderr: `${token} not found` }
    : runShell(checkCommand, projectRoot, 800);
  const output = `${check.stdout ?? ""}\n${check.stderr ?? ""}`.trim();
  const installed = check.status === 0;

  const installCommands = Object.fromEntries(
    Object.entries(dep.install).filter(([manager]) => availableManagers[manager as PackageManager])
  ) as Partial<Record<PackageManager, string>>;

  let missingReason: string | undefined;
  if (!installed) {
    if (!runtimes[dep.requiresRuntime]) {
      missingReason = `${dep.requiresRuntime} runtime is not available`;
    } else if (Object.keys(installCommands).length === 0) {
      missingReason = "no supported package manager detected for this dependency";
    } else {
      missingReason = "binary not found";
    }
  }

  return {
    name: dep.name,
    installed,
    version: installed ? parseVersion(output) : null,
    covers: dep.covers,
    languages: dep.languages,
    requires_runtime: dep.requiresRuntime,
    runtime_available: runtimes[dep.requiresRuntime],
    check_command: checkCommand,
    install_commands: installCommands,
    missing_reason: missingReason,
  };
}

export function checkDependencies(projectRoot?: string): CheckDependenciesResult {
  const start = Date.now();
  const root = projectRoot ? resolve(projectRoot) : process.cwd();
  const packageManagers = detectPackageManagers();
  const runtimes = detectRuntimes();
  const statuses = Object.values(DEPENDENCY_REGISTRY).map((dep) =>
    inspectDependency(dep, runtimes, packageManagers, root)
  );
  const installed = statuses.filter((status) => status.installed);
  const missing = statuses.filter((status) => !status.installed);

  const metricMap = new Map<string, { languages: Set<string>; dependencies: Set<string> }>();
  for (const status of missing) {
    for (const metric of status.covers) {
      const current = metricMap.get(metric) ?? { languages: new Set<string>(), dependencies: new Set<string>() };
      status.languages.forEach((lang) => current.languages.add(lang));
      current.dependencies.add(status.name);
      metricMap.set(metric, current);
    }
  }

  return {
    available_package_managers: packageManagers,
    available_runtimes: runtimes,
    installed,
    missing,
    unavailable_metrics: [...metricMap.entries()].map(([metric, value]) => ({
      metric,
      languages: [...value.languages].sort(),
      dependencies: [...value.dependencies].sort(),
    })),
    durationMs: Date.now() - start,
  };
}

function chooseInstallManager(dep: DependencySpec, managers: Record<PackageManager, boolean>): PackageManager | null {
  const priority = PACKAGE_MANAGER_PRIORITY[dep.requiresRuntime];
  for (const manager of priority) {
    if (managers[manager] && dep.install[manager]) return manager;
  }
  return null;
}

export function installDependency(name: string, projectRoot?: string): InstallDependencyResult {
  const dep = DEPENDENCY_REGISTRY[name];
  if (!dep) {
    return {
      ok: false,
      failure: {
        dependency: name,
        reason: "PACKAGE_NOT_FOUND",
        human_explanation: "The requested dependency is not in the spec-check registry.",
        suggestion: `Use one of: ${Object.keys(DEPENDENCY_REGISTRY).join(", ")}.`,
        affects_metrics: [],
        affects_languages: [],
        raw_output: name,
      },
    };
  }

  const root = projectRoot ? resolve(projectRoot) : process.cwd();
  const runtimes = detectRuntimes();
  if (!runtimes[dep.requiresRuntime]) {
    return {
      ok: false,
      failure: {
        dependency: dep.name,
        reason: "RUNTIME_NOT_FOUND",
        human_explanation: `${dep.requiresRuntime} is not installed or not in PATH.`,
        suggestion: `Install ${dep.requiresRuntime} first, then retry installing ${dep.name}.`,
        affects_metrics: dep.covers,
        affects_languages: dep.languages,
        raw_output: `${dep.requiresRuntime} runtime missing`,
      },
    };
  }

  const managers = detectPackageManagers();
  const manager = chooseInstallManager(dep, managers);
  if (!manager) {
    return {
      ok: false,
      failure: {
        dependency: dep.name,
        reason: "PACKAGE_MANAGER_MISSING",
        human_explanation: "No supported package manager was detected for this dependency.",
        suggestion: `Install one of the supported package managers for ${dep.requiresRuntime}: ${Object.keys(dep.install).join(", ")}.`,
        affects_metrics: dep.covers,
        affects_languages: dep.languages,
        raw_output: JSON.stringify(managers),
      },
    };
  }

  const command = dep.install[manager]!;
  const install = runShell(command, root);
  const rawOutput = `${install.stdout ?? ""}\n${install.stderr ?? ""}`.trim();

  if (install.status !== 0) {
    return {
      ok: false,
      manager,
      failure: classifyFailure(dep, rawOutput, root),
    };
  }

  const postCheck = runShell(dep.check, root);
  const postOutput = `${postCheck.stdout ?? ""}\n${postCheck.stderr ?? ""}`.trim();
  if (postCheck.status !== 0) {
    return {
      ok: false,
      manager,
      failure: classifyFailure(dep, `${rawOutput}\n${postOutput}`.trim(), root),
    };
  }

  return {
    ok: true,
    dependency: dep.name,
    manager,
    version: parseVersion(postOutput),
    stdout: install.stdout ?? "",
    stderr: install.stderr ?? "",
  };
}
