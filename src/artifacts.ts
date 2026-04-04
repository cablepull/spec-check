import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, extname, join, resolve } from "path";
import type { CriterionResult, GateResult, GateStatus } from "./types.js";

type ArtifactKind = "story" | "adr" | "rca";

export interface ArtifactValidationSummary {
  target: string;
  kind: ArtifactKind | "mixed";
  status: GateStatus;
  results: Array<GateResult & { file: string; artifactKind: ArtifactKind }>;
  durationMs: number;
}

const STORY_REFERENCE = /\b(?:story[\s:-]*\d{1,3}|stories\/\d{3}[-\w]*\.md|intent\.md)\b/i;
const REQUIREMENT_REFERENCE = /\[[^\]]+\]\([^)]+\)|\b(?:R-\d+|F-\d+|PRD Section \d+(?:\.\d+)?)\b/i;

function readFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function normalizeValue(text: string): string {
  return text.trim().replace(/[`*_]/g, "").replace(/\.$/, "").toLowerCase();
}

function collectSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = text.split("\n");
  let current: string | null = null;
  const buffer: string[] = [];

  const flush = () => {
    if (current) sections.set(current, buffer.join("\n").trim());
    buffer.length = 0;
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1]!.trim().toLowerCase();
    } else if (current) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

function buildStatus(criteria: CriterionResult[]): GateStatus {
  if (criteria.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((c) => c.status === "VIOLATION")) return "FAILING";
  if (criteria.some((c) => c.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function inferArtifactKind(path: string, text: string): ArtifactKind | null {
  const normal = path.replace(/\\/g, "/").toLowerCase();
  const name = basename(normal);

  if (normal.includes("/adr/") || /^adr[-_]/.test(name) || /alternatives considered/i.test(text)) return "adr";
  if (normal.includes("/rca/") || /^rca[-_]/.test(name) || /violated requirement/i.test(text)) return "rca";
  if (normal.includes("/stories/") || /^\d{3}-/.test(name)) return "story";
  return null;
}

function validateStory(file: string, text: string): GateResult & { file: string; artifactKind: "story" } {
  const start = Date.now();
  const sections = collectSections(text);
  const criteria: CriterionResult[] = [];

  const intent = sections.get("intent") ?? "";
  criteria.push(
    intent
      ? { id: "S-1", status: "PASS", detail: "Intent section present." }
      : {
          id: "S-1",
          status: "VIOLATION",
          detail: "Missing or empty `## Intent` section.",
          evidence: [`${file}: Intent`],
          fix: "Add a non-empty `## Intent` section describing the story purpose.",
        }
  );

  const acceptance = sections.get("acceptance criteria") ?? "";
  criteria.push(
    acceptance && /^\s*[-*]\s*\[[ x]\]/im.test(acceptance)
      ? { id: "S-2", status: "PASS", detail: "Acceptance Criteria section contains checklist items." }
      : {
          id: "S-2",
          status: "VIOLATION",
          detail: "Missing `## Acceptance Criteria` checklist items.",
          evidence: [`${file}: Acceptance Criteria`],
          fix: "Add `## Acceptance Criteria` with markdown checklist items.",
        }
  );

  const requirements = sections.get("requirements") ?? "";
  criteria.push(
    requirements && REQUIREMENT_REFERENCE.test(requirements)
      ? { id: "S-3", status: "PASS", detail: "Requirements section contains a requirement reference." }
      : {
          id: "S-3",
          status: "VIOLATION",
          detail: "Requirements section is missing a requirement reference or link.",
          evidence: [`${file}: Requirements`],
          fix: "Reference at least one requirement ID, PRD section, or markdown link in `## Requirements`.",
        }
  );

  const adrRequired = normalizeValue(sections.get("adr required") ?? "");
  criteria.push(
    adrRequired === "yes" || adrRequired === "no" || adrRequired.startsWith("yes ") || adrRequired.startsWith("no ")
      ? { id: "S-4", status: "PASS", detail: "`ADR Required` value is valid." }
      : {
          id: "S-4",
          status: "VIOLATION",
          detail: "`## ADR Required` must be `yes` or `no`.",
          evidence: [`${file}: ADR Required = ${sections.get("adr required") ?? "(missing)"}`],
          fix: "Set `## ADR Required` to `Yes` or `No`.",
        }
  );

  criteria.push(
    sections.has("assumptions")
      ? { id: "S-5", status: "PASS", detail: "Assumptions section present." }
      : {
          id: "S-5",
          status: "VIOLATION",
          detail: "Missing `## Assumptions` section.",
          evidence: [`${file}: Assumptions`],
          fix: "Add `## Assumptions`, even if the content states that none were needed.",
        }
  );

  return {
    gate: "S",
    name: "Story Validation",
    status: buildStatus(criteria),
    criteria,
    durationMs: Date.now() - start,
    file,
    artifactKind: "story",
  };
}

function validateAdr(file: string, text: string): GateResult & { file: string; artifactKind: "adr" } {
  const start = Date.now();
  const sections = collectSections(text);
  const criteria: CriterionResult[] = [];

  const required = ["status", "context", "decision", "consequences", "alternatives considered"];
  const missing = required.filter((name) => !(sections.get(name) ?? "").trim());
  criteria.push(
    missing.length === 0
      ? { id: "A-1", status: "PASS", detail: "All required ADR sections are present." }
      : {
          id: "A-1",
          status: "VIOLATION",
          detail: `${missing.length} required ADR section(s) are missing or empty.`,
          evidence: missing.map((name) => `${file}: ${name}`),
          fix: "Add non-empty sections for Status, Context, Decision, Consequences, and Alternatives Considered.",
        }
  );

  const status = sections.get("status") ?? "";
  const validStatuses = new Set(["proposed", "accepted", "superseded", "deprecated"]);
  const statusValue = normalizeValue(status.split("\n")[0] ?? "");
  criteria.push(
    validStatuses.has(statusValue)
      ? { id: "A-2", status: "PASS", detail: "ADR status value is valid." }
      : {
          id: "A-2",
          status: "VIOLATION",
          detail: "ADR status must be one of: Proposed, Accepted, Superseded, Deprecated.",
          evidence: [`${file}: Status = ${status || "(missing)"}`],
          fix: "Set `## Status` to one of the supported values.",
        }
  );

  criteria.push(
    STORY_REFERENCE.test(text)
      ? { id: "A-3", status: "PASS", detail: "ADR references a triggering story or intent artifact." }
      : {
          id: "A-3",
          status: "WARNING",
          detail: "No link to a triggering Story or Intent was found.",
          evidence: [file],
          fix: "Reference the originating story file or intent artifact in the ADR.",
        }
  );

  return {
    gate: "A",
    name: "ADR Validation",
    status: buildStatus(criteria),
    criteria,
    durationMs: Date.now() - start,
    file,
    artifactKind: "adr",
  };
}

function validateRca(file: string, text: string): GateResult & { file: string; artifactKind: "rca" } {
  const start = Date.now();
  const sections = collectSections(text);
  const criteria: CriterionResult[] = [];

  const required = [
    "summary",
    "root cause",
    "violated requirement",
    "resolution",
    "spec update required",
    "adr required",
  ];
  const missing = required.filter((name) => !(sections.get(name) ?? "").trim());
  criteria.push(
    missing.length === 0
      ? { id: "RC-1", status: "PASS", detail: "All required RCA sections are present." }
      : {
          id: "RC-1",
          status: "VIOLATION",
          detail: `${missing.length} required RCA section(s) are missing or empty.`,
          evidence: missing.map((name) => `${file}: ${name}`),
          fix: "Add non-empty sections for Summary, Root Cause, Violated Requirement, Resolution, Spec Update Required, and ADR Required.",
        }
  );

  const violatedRequirement = sections.get("violated requirement") ?? "";
  criteria.push(
    violatedRequirement && REQUIREMENT_REFERENCE.test(violatedRequirement)
      ? { id: "RC-2", status: "PASS", detail: "Violated Requirement section contains a reference." }
      : {
          id: "RC-2",
          status: "VIOLATION",
          detail: "`## Violated Requirement` must include a requirement reference or link.",
          evidence: [`${file}: Violated Requirement`],
          fix: "Reference the violated requirement with an ID, PRD section, or markdown link.",
        }
  );

  const specUpdate = normalizeValue(sections.get("spec update required") ?? "");
  criteria.push(
    specUpdate === "yes" || specUpdate === "no" || specUpdate.startsWith("yes ") || specUpdate.startsWith("no ")
      ? { id: "RC-3", status: "PASS", detail: "`Spec Update Required` value is valid." }
      : {
          id: "RC-3",
          status: "VIOLATION",
          detail: "`## Spec Update Required` must be `yes` or `no`.",
          evidence: [`${file}: Spec Update Required = ${sections.get("spec update required") ?? "(missing)"}`],
          fix: "Set `## Spec Update Required` to `Yes` or `No`.",
        }
  );

  const adrRequired = normalizeValue(sections.get("adr required") ?? "");
  criteria.push(
    adrRequired === "yes" || adrRequired === "no" || adrRequired.startsWith("yes ") || adrRequired.startsWith("no ")
      ? { id: "RC-4", status: "PASS", detail: "`ADR Required` value is valid." }
      : {
          id: "RC-4",
          status: "VIOLATION",
          detail: "`## ADR Required` must be `yes` or `no`.",
          evidence: [`${file}: ADR Required = ${sections.get("adr required") ?? "(missing)"}`],
          fix: "Set `## ADR Required` to `Yes` or `No`.",
        }
  );

  criteria.push(
    sections.has("assumptions")
      ? { id: "RC-5", status: "PASS", detail: "Assumptions section present." }
      : {
          id: "RC-5",
          status: "VIOLATION",
          detail: "Missing `## Assumptions` section.",
          evidence: [`${file}: Assumptions`],
          fix: "Add `## Assumptions` to the RCA.",
        }
  );

  return {
    gate: "RC",
    name: "RCA Validation",
    status: buildStatus(criteria),
    criteria,
    durationMs: Date.now() - start,
    file,
    artifactKind: "rca",
  };
}

function listCandidateFiles(dir: string, includeArchived = false): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!includeArchived && entry.toLowerCase() === "archive") continue;
        walk(full);
      } else if (stat.isFile() && extname(entry).toLowerCase() === ".md") {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results.sort();
}

function validateSingleFile(path: string): GateResult & { file: string; artifactKind: ArtifactKind } {
  const file = resolve(path);
  const text = readFile(file);
  const kind = inferArtifactKind(file, text);

  if (!kind) {
    const criteria: CriterionResult[] = [{
      id: "ARTIFACT-TYPE",
      status: "BLOCK",
      detail: "Could not determine whether this artifact is a story, ADR, or RCA.",
      evidence: [file],
      fix: "Place the file under `stories/`, `adr/`, or `rca/`, or use a recognizable filename.",
    }];
    return {
      gate: "ART",
      name: "Artifact Validation",
      status: "BLOCKED",
      criteria,
      durationMs: 0,
      file,
      artifactKind: "story",
    };
  }

  if (kind === "story") return validateStory(file, text);
  if (kind === "adr") return validateAdr(file, text);
  return validateRca(file, text);
}

export function validateArtifacts(target: string, includeArchived = false): ArtifactValidationSummary {
  const start = Date.now();
  const resolvedTarget = resolve(target);

  if (!existsSync(resolvedTarget)) {
    return {
      target: resolvedTarget,
      kind: "mixed",
      status: "BLOCKED",
      results: [],
      durationMs: Date.now() - start,
    };
  }

  const stat = statSync(resolvedTarget);
  const files = stat.isDirectory() ? listCandidateFiles(resolvedTarget, includeArchived) : [resolvedTarget];
  const results = files.map((file) => validateSingleFile(file));

  const kinds = [...new Set(results.map((result) => result.artifactKind))];
  const status = buildStatus(results.flatMap((result) => result.criteria));

  return {
    target: resolvedTarget,
    kind: kinds.length === 1 ? kinds[0]! : "mixed",
    status,
    results,
    durationMs: Date.now() - start,
  };
}
