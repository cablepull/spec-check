// ─── Severity and status ─────────────────────────────────────────────────────

export type Severity = "BLOCK" | "VIOLATION" | "WARNING" | "PASS";
export type GateStatus = "PASS" | "BLOCKED" | "FAILING" | "PASSING_WITH_WARNINGS";
export type Format = "text" | "json" | "mermaid";
export type ArtifactType = "story" | "intent" | "rca" | "adr";

// ─── Criterion result (one per check ID e.g. I-1, R-6) ───────────────────────

export interface CriterionResult {
  id: string;              // e.g. "I-2", "R-6"
  status: Severity;
  detail: string;          // human explanation of what was found / not found
  evidence?: string[];     // matched text, file paths, line numbers
  fix?: string;            // specific action to resolve
  confidence?: number;     // 0–1 for NLP checks only
}

// ─── Gate result (one per gate G1–G5 or S/A/RC) ──────────────────────────────

export interface GateResult {
  gate: string;            // "G1" | "G2" | ... | "S" | "A" | "RC"
  name: string;            // human label e.g. "Intent Valid"
  status: GateStatus;
  criteria: CriterionResult[];
  durationMs: number;
}

// ─── Full run result ──────────────────────────────────────────────────────────

export interface RunResult {
  path: string;
  status: GateStatus;
  gates: GateResult[];
  nextSteps: string[];
  durationMs: number;
  llm: LLMIdentity;
  timestamp: string;
}

// ─── NLP check result ─────────────────────────────────────────────────────────

export interface NLPResult {
  matched: boolean;
  confidence: number;      // 0–1
  evidence: string[];      // matched phrases
}

// ─── LLM identity ────────────────────────────────────────────────────────────

export interface LLMIdentity {
  provider: string;        // "anthropic" | "openai" | "google" | "human" | "ci" | "unknown"
  model: string;           // e.g. "claude-sonnet-4-5"
  id: string;              // sanitised e.g. "claude-sonnet-4-5"
  source: "argument" | "env" | "config" | "fallback";
}

export type AgentKind =
  | "primary"
  | "planner"
  | "implementer"
  | "reviewer"
  | "fixer"
  | "human"
  | "ci"
  | "unknown";

export interface ActorIdentity extends LLMIdentity {
  agent_id: string;
  agent_kind: AgentKind;
  parent_agent_id: string | null;
  session_id: string;
  run_id: string;
}

export interface AgentState {
  current_goal: string | null;
  current_phase: string | null;
  working_set_paths: string[];
  changed_paths: string[];
  last_completed_check: string | null;
  required_next_checks: string[];
  open_violations: string[];
  assumptions_declared: boolean | null;
  metrics_due: boolean | null;
  summary_from_agent: string | null;
  status: "active" | "completed";
}

export interface WorkflowGuidance {
  phase: string;
  must_call_next: string[];
  should_call_metrics: boolean;
  must_report_state: boolean;
  blocked: boolean;
  blocked_by: string[];
  notes: string[];
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface ThresholdConfig {
  // Intent
  "I-2"?: number; "I-3"?: number; "I-4"?: number; "I-5"?: number;
  // Requirements
  "R-3"?: number; "R-5"?: number; "R-7"?: number;
  "R-8"?: number; "R-9"?: number; "R-10"?: number;
  // Design
  "D-3"?: number; "D-4"?: number;
  // Tasks
  "T-2"?: number; "T-3"?: number; "T-4"?: number;
  // Executability
  "E-2"?: number;
  // Assumptions
  "AS-3"?: number;
  // Complexity (integer thresholds)
  "CC-1"?: number; "CC-2"?: number; "CC-3"?: number;
  "CC-4"?: number; "CC-5"?: number;
  // Mutation (percentage thresholds)
  "MT-1"?: number; "MT-2"?: number; "MT-4"?: number;
  [key: string]: number | undefined;
}

export interface ComplianceWeights {
  G1: number; G2: number; G3: number; G4: number; G5: number;
}

export interface MonorepoAutoDetect {
  manifests: string[];
  depth: number;
  workspaces: boolean;
}

export interface ServiceDefinition {
  name: string;
  path: string;
  spec_path?: string;
  language?: string;
}

export interface MonorepoConfig {
  strategy: "auto" | "flat" | "explicit" | "services";
  auto_detect?: MonorepoAutoDetect;
  fallback?: string;
  services?: ServiceDefinition[];
  root_checks?: string[];
}

export interface MutationConfig {
  enabled: boolean;
  incremental: boolean;
  triggers: {
    default: string;
    available: string[];
    scheduled?: { enabled: boolean; cron: string };
  };
}

export interface MetricsConfig {
  db_path: string;
  retention_days: number;
}

export interface SpecCheckConfig {
  default_llm?: string;
  /** Single command override — superseded by test_commands if both are set. */
  test_command?: string;
  /** Run each command in order; gate fails if any exits non-zero. */
  test_commands?: string[];
  thresholds: ThresholdConfig;
  compliance_weights: ComplianceWeights;
  metrics: MetricsConfig;
  monorepo: MonorepoConfig;
  mutation: MutationConfig;
}

export interface ResolvedConfig {
  value: SpecCheckConfig;
  sources: Record<string, "default" | "global" | "project">;
}

// ─── Monorepo ─────────────────────────────────────────────────────────────────

export interface ServiceInfo {
  name: string;            // "root" or service name
  rootPath: string;        // absolute path to the project root
  servicePath: string;     // absolute path to the service directory
  specPath: string;        // where specs live for this service
}

export interface ServiceMap {
  projectRoot: string;
  services: ServiceInfo[];
  isMonorepo: boolean;
  strategy: string;
  rootChecks: string[];
}

// ─── Tool call arguments ──────────────────────────────────────────────────────

export interface ToolArgs {
  path?: string;
  format?: Format;
  llm?: string;
  agent_id?: string;
  agent_kind?: AgentKind;
  parent_agent_id?: string;
  session_id?: string;
  run_id?: string;
  since?: string;
  base?: string;
  threshold?: number;
  story_id?: string;
  adr_id?: string;
  rca_id?: string;
  artifact_path?: string;
  assumption_id?: string;
  reason?: string;
  name?: string;
  state?: Partial<AgentState>;
  include_archived?: boolean;
}

// ─── Default config ───────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: SpecCheckConfig = {
  thresholds: {
    "I-2": 0.7, "I-3": 0.6, "I-4": 0.7, "I-5": 0.5,
    "R-3": 0.8, "R-5": 0.7, "R-7": 0.8, "R-8": 0.8,
    "R-9": 0.7, "R-10": 0.5,
    "D-3": 0.7, "D-4": 0.6,
    "T-2": 0.8, "T-3": 0.7, "T-4": 0.6,
    "E-2": 0.7,
    "AS-3": 0.8,
    "CC-1": 10, "CC-2": 10, "CC-3": 5, "CC-4": 4, "CC-5": 5,
    "MT-1": 80, "MT-2": 90, "MT-4": 10,
  },
  compliance_weights: { G1: 0.15, G2: 0.30, G3: 0.20, G4: 0.15, G5: 0.20 },
  metrics: { db_path: "~/.spec-check/data", retention_days: 365 },
  monorepo: {
    strategy: "auto",
    auto_detect: {
      manifests: ["package.json", "go.mod", "requirements.txt", "Cargo.toml", "pom.xml"],
      depth: 2,
      workspaces: true,
    },
    fallback: "root",
    root_checks: ["diff", "deps", "gate-adr", "gate-rca"],
  },
  mutation: {
    enabled: true,
    incremental: true,
    triggers: {
      default: "pre_merge",
      available: ["pre_merge", "nightly", "weekly", "on_demand", "pre_commit"],
      scheduled: { enabled: false, cron: "0 2 * * 1" },
    },
  },
};

// ─── Quality signal metrics (reconciliation + evidence) ───────────────────────

export interface ReconciliationMetrics {
  rc1_pass_rate: number | null;  // % of runs where RC-1 (README claims) passes
  rc2_pass_rate: number | null;  // % of runs where RC-2 (completed tasks) passes
  latest_status: GateStatus | null;
  run_count: number;
}

export interface EvidenceMetrics {
  ev1_pass_rate: number | null;  // % of runs where EV-1 (release verification) passes
  ev2_pass_rate: number | null;  // % of runs where EV-2 (benchmark coverage) passes
  latest_status: GateStatus | null;
  run_count: number;
}

export interface DiffAdrMetrics {
  dadr1_pass_rate: number | null;  // % of diffs where new dependencies have an ADR
  dadr2_pass_rate: number | null;  // % of diffs where security changes have an ADR
  dadr3_pass_rate: number | null;  // % of diffs where deployment changes have an ADR
  checked_diffs: number;
}

// ─── Structured error types ───────────────────────────────────────────────────

export type FailureReason =
  | "RUNTIME_NOT_FOUND"
  | "PACKAGE_MANAGER_MISSING"
  | "PERMISSION_DENIED"
  | "PACKAGE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "PATH_NOT_UPDATED"
  | "DISK_SPACE"
  | "ENV_CONFLICT"
  | "RUNTIME_VERSION"
  | "UNKNOWN";

export interface InstallFailure {
  dependency: string;
  reason: FailureReason;
  human_explanation: string;
  suggestion: string;
  affects_metrics: string[];
  affects_languages: string[];
  raw_output: string;
}
