// Gate runner barrel — orchestrates all five gates in sequence
import { join } from "path";
import type { GateResult, GateStatus, RunResult, ResolvedConfig, LLMIdentity, ServiceInfo } from "../types.js";
import { runGate1 } from "./gate1.js";
import { runGate2 } from "./gate2.js";
import { runGate3 } from "./gate3.js";
import { runGate4 } from "./gate4.js";
import { runGate5 } from "./gate5.js";
import { validateArtifacts } from "../artifacts.js";

export { runGate1, runGate2, runGate3, runGate4, runGate5 };

// ── G-RCA gate: validates all files in rca/ directory ─────────────────────────
async function runGateRca(specPath: string, config: ResolvedConfig): Promise<GateResult> {
  const start = Date.now();
  const { existsSync, readdirSync } = await import("fs");
  const { join: j } = await import("path");
  const rcaDir = j(specPath, "rca");

  if (!existsSync(rcaDir)) {
    return {
      gate: "G-RCA",
      name: "RCA Valid",
      status: "PASSING_WITH_WARNINGS",
      criteria: [{
        id: "RC-0",
        status: "WARNING",
        detail: "No rca/ directory found. This is expected for new projects with no bugs yet.",
        fix: "Create rca/ and add an RCA file when a bug is found and resolved.",
      }],
      durationMs: Date.now() - start,
    };
  }

  let hasFiles = false;
  try { hasFiles = readdirSync(rcaDir).some((f: string) => f.endsWith(".md")); } catch {}

  if (!hasFiles) {
    return {
      gate: "G-RCA",
      name: "RCA Valid",
      status: "PASSING_WITH_WARNINGS",
      criteria: [{
        id: "RC-0",
        status: "WARNING",
        detail: "rca/ directory is empty. Add RCA files when bugs are discovered and resolved.",
      }],
      durationMs: Date.now() - start,
    };
  }

  const summary = validateArtifacts(rcaDir, false, config);
  const criteria = summary.results.flatMap((r) => r.criteria);
  const status = summary.status;
  return { gate: "G-RCA", name: "RCA Valid", status, criteria, durationMs: Date.now() - start };
}

// ── Run a single named gate ────────────────────────────────────────────────────
export async function runGate(
  gateName: string,
  service: ServiceInfo,
  config: ResolvedConfig
): Promise<GateResult> {
  const specPath = service.specPath;
  const projectRoot = service.rootPath;

  switch (gateName.toUpperCase()) {
    case "G1": return runGate1(specPath, config);
    case "G2": return runGate2(specPath, config);
    case "G3": return runGate3(specPath, config);
    case "G4": return runGate4(specPath, config);
    case "G5": return runGate5(specPath, projectRoot, config);
    case "G-RCA": return runGateRca(specPath, config);
    default:
      return {
        gate: gateName,
        name: "Unknown Gate",
        status: "BLOCKED",
        criteria: [{
          id: "GATE-UNKNOWN",
          status: "BLOCK",
          detail: `Unknown gate identifier: "${gateName}". Valid values: G1, G2, G3, G4, G5, G-RCA.`,
          fix: "Use one of: G1 (Stories), G2 (PRD), G3 (ADR), G4 (Tasks), G5 (Executability), G-RCA (RCA).",
        }],
        durationMs: 0,
      };
  }
}

// ── Roll up gate statuses to overall run status ────────────────────────────────
function rollupStatus(gates: GateResult[]): GateStatus {
  if (gates.some((g) => g.status === "BLOCKED")) return "BLOCKED";
  if (gates.some((g) => g.status === "FAILING")) return "FAILING";
  if (gates.some((g) => g.status === "PASSING_WITH_WARNINGS")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

// ── Next-step advisor ──────────────────────────────────────────────────────────
function buildNextSteps(gates: GateResult[]): string[] {
  const steps: string[] = [];
  for (const gate of gates) {
    const violations = gate.criteria.filter(
      (c) => c.status === "BLOCK" || c.status === "VIOLATION"
    );
    for (const v of violations) {
      if (v.fix) steps.push(`[${v.id}] ${v.fix}`);
      else steps.push(`[${v.id}] Resolve: ${v.detail.slice(0, 100)}`);
    }
    if (gate.status === "BLOCKED") {
      // Don't continue showing gates past a BLOCK
      steps.push(`Gates after ${gate.gate} not evaluated due to BLOCKED status.`);
      break;
    }
  }
  if (steps.length === 0) steps.push("All gates pass. You may proceed to implementation.");
  return steps;
}

// ── Run all five gates sequentially ────────────────────────────────────────────
// Sequential (not parallel) because later gates may depend on earlier spec files.
export async function runAllGates(
  service: ServiceInfo,
  config: ResolvedConfig,
  llm: LLMIdentity
): Promise<RunResult> {
  const start = Date.now();
  const gates: GateResult[] = [];

  const gateRunners = [
    () => runGate1(service.specPath, config),
    () => runGate2(service.specPath, config),
    () => runGate3(service.specPath, config),
    () => runGate4(service.specPath, config),
    () => runGate5(service.specPath, service.rootPath, config),
  ];

  for (const runner of gateRunners) {
    const result = await runner();
    gates.push(result);
    // Stop at first BLOCKED gate — subsequent gates are meaningless
    if (result.status === "BLOCKED") break;
  }

  return {
    path: service.specPath,
    status: rollupStatus(gates),
    gates,
    nextSteps: buildNextSteps(gates),
    durationMs: Date.now() - start,
    llm,
    timestamp: new Date().toISOString(),
  };
}
