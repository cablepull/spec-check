# Tasks

## Story 001 — MCP Server Foundation

- [ ] Scaffold `src/server.ts` with `@modelcontextprotocol/sdk` stdio transport (Rule: server starts and responds reliably)
- [ ] Implement Tool Router with unknown-tool structured error response (Rule: server starts and responds reliably)
- [ ] Implement Identity Resolver with four-level priority chain (Rule: LLM identity resolved from available context)
- [ ] Attach resolved identity and server version to every MCP response envelope (Rule: LLM identity resolved from available context)
- [ ] Implement `PATH_NOT_FOUND` structured error for missing path arguments (Rule: server starts and responds reliably)
- [ ] Wrap all tool handlers in try/catch returning structured errors, never raw stack traces (Rule: server starts and responds reliably)

## Story 002 — get_protocol

- [ ] Define the embedded protocol constant with all gate criteria, artifact contracts, assumption format, supersession flow, and tool-call guidance (Rule: tool is always the source of truth for its own protocol)
- [ ] Implement Protocol Builder that merges the protocol constant with resolved config thresholds (Rule: tool is always the source of truth for its own protocol)
- [ ] Add `protocol_version` integer and `generated_at` timestamp to protocol output (Rule: protocol includes version and timestamp)
- [ ] Implement `format: text | json | markdown` rendering for `get_protocol` (Rule: tool is always the source of truth for its own protocol)
- [ ] Add `path` argument support to `get_protocol` so it resolves config for a specific project (Rule: protocol returns active thresholds for current project)
- [ ] Label each threshold in output with its source: `default`, `global`, or `project` (Rule: protocol returns active thresholds for current project)

## Story 003 — Gate 1: Intent

- [ ] Implement intent document discovery: search root for all candidate filenames, return structured BLOCK if none found (Rule: intent document must exist)
- [ ] Implement `detectCausalLanguage` NLP function with defined signal words, threshold-aware result (Rule: intent must articulate why)
- [ ] Implement I-4 sentence-order scoring: detect whether solution language precedes problem language (Rule: intent must articulate why)
- [ ] Implement I-5 implementation-leak detection: PascalCase, snake_case (2+ segments), framework name patterns (Rule: implementation details must not appear in intent)
- [ ] Implement I-6 word count check with threshold at 50 (Rule: intent must articulate why)
- [ ] Wire all I-1 through I-6 checks into `check_intent` tool with per-criterion results and fix suggestions (Rule: intent document must exist, Rule: intent must articulate why)

## Story 004 — Gate 2: Requirements

- [ ] Implement markdown and Gherkin parser: extract Feature → Rule → Example → GWT hierarchy (Rule: every Feature must have at least one Rule)
- [ ] Implement R-1 Feature detection with BLOCK on zero features (Rule: every Feature must have at least one Rule)
- [ ] Implement R-2 Rule-per-Feature check (Rule: every Feature must have at least one Rule)
- [ ] Implement `detectImperativeVerb` NLP function for R-3 declarative-rule check (Rule: every Rule must have both a positive and negative example)
- [ ] Implement R-4 and R-5 positive/negative example detection using error-signal keywords (Rule: every Rule must have both a positive and negative example)
- [ ] Implement R-6 WHEN-count check per Example with BLOCK on zero or >1 (Rule: each Example must have exactly one WHEN)
- [ ] Implement `detectActionVerb` NLP function for R-7 GIVEN state check (Rule: GIVEN steps must describe state not actions)
- [ ] Implement `detectCompoundClause` NLP function for R-8 single-action WHEN check (Rule: WHEN must describe one actor performing one action)
- [ ] Implement `detectInternalState` NLP function for R-9 observable THEN check (Rule: THEN steps must be externally observable)
- [ ] Implement R-10 implementation-leak check across all GWT steps (Rule: THEN steps must be externally observable)
- [ ] Wire R-1 through R-10 into `check_requirements` tool with grouped output and line-range evidence (Rule: every Rule must have both a positive and negative example)

## Story 005 — Gate 3: Design

- [ ] Implement design document discovery: search for `design.md`, `architecture.md`, `adr/` directory (Rule: design document must exist)
- [ ] Implement D-2 requirement-reference matching: extract Rule IDs and Feature name fragments from requirements, search design document (Rule: design must reference requirements it addresses)
- [ ] Implement `detectComponentLanguage` NLP function for D-3 component/boundary check (Rule: design document must exist)
- [ ] Implement `detectNegationProximity` NLP function for D-4 contradiction detection; enforce WARNING-only, never VIOLATION (Rule: design must not contradict requirements)
- [ ] Wire D-1 through D-4 into `check_design` tool with confidence scores on D-4 and human-review note (Rule: design must not contradict requirements)

## Story 006 — Gate 4: Tasks

- [ ] Implement tasks document discovery with checkbox item counting; BLOCK on zero items (Rule: tasks must be atomic)
- [ ] Implement `detectCompoundTask` NLP function for T-2: detect `and` joining two verb phrases (Rule: tasks must be atomic)
- [ ] Implement T-3 two-pass traceability: exact keyword match first, configurable NLP similarity second; report coverage percentage (Rule: each task must trace to a requirement)
- [ ] Implement T-4 Rule coverage check: map rules to tasks, report uncovered rules as WARNING (Rule: each task must trace to a requirement)
- [ ] Wire T-1 through T-4 into `check_tasks` tool (Rule: tasks must be atomic)

## Story 007 — Gate 5: Executability

- [ ] Implement test file discovery using patterns from PRD Section 9.1; exclude node_modules, vendor, dist, build (Rule: test files must exist)
- [ ] Implement E-2 Rule-to-test matching: extract test description strings from test files, match against Rule keywords (Rule: each Rule must have a corresponding test)
- [ ] Implement E-3 spec-language detection: scan test description strings for describe/it/should/Given/When/Then (Rule: each Rule must have a corresponding test)
- [ ] Wire E-1 through E-3 into `check_executability` tool with coverage percentage and sampled-file count (Rule: test files must exist)

## Story 008 — run_all

- [ ] Implement gate orchestrator: run G1→G5 in sequence, halt on BLOCK, collect WARNINGs without halting (Rule: test files must exist)
- [ ] Implement consolidated report builder: summary table + per-gate detail + ordered next-steps list (Rule: test files must exist)
- [ ] Assign overall status: PASS / BLOCKED / FAILING / PASSING_WITH_WARNINGS (Rule: test files must exist)
- [ ] Write gate-all Parquet record asynchronously after results are returned (Rule: every check run must be persisted)
- [ ] Implement `format: text | json | mermaid` for `run_all` output (Rule: test files must exist)

## Story 009 — Artifact Validation

- [ ] Implement section detector: H2 heading presence check, empty-section detection (Rule: stories must have all required sections)
- [ ] Implement `check_story`: validate S-1 through S-5 with per-criterion results (Rule: stories must have all required sections)
- [ ] Implement `check_adr`: validate A-1 through A-3 including status value enumeration (Rule: ADR status must be a valid value)
- [ ] Implement `check_rca`: validate RC-1 through RC-5 (Rule: RCAs must link to a violated requirement)
- [ ] Add directory-mode support: validate all matching files, return per-file results (Rule: stories must have all required sections)
- [ ] Skip `archive/` subdirectory by default; enable with `include_archived: true` (Rule: stories must have all required sections)

## Story 010 — Assumption Tracking

- [ ] Implement `check_assumptions`: validate AS-1 through AS-3; accept valid empty declaration (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement `detectCertaintyLanguage` NLP function for AS-3 (Rule: assumptions must not be stated as facts)
- [ ] Implement `invalidate_assumption`: validate assumption ID exists, update row status, move original to archive, create replacement scaffold, write supersession Parquet record (Rule: an invalidated assumption must produce a superseding artifact)
- [ ] Implement AS-4 BLOCK check: detect `invalidated` status with no corresponding replacement file (Rule: an invalidated assumption must produce a superseding artifact)
- [ ] Implement `get_supersession_history`: query supersession Parquet files, support `since` and `artifact_type` filters (Rule: an invalidated assumption must produce a superseding artifact)

## Story 011 — Diff Detection

- [ ] Implement `git diff` subprocess invocation with optional `base` argument; handle no-git-repo gracefully (Rule: code changes must trace to a story or RCA)
- [ ] Implement file categoriser: map changed files to change categories by extension and path pattern (Rule: code changes must trace to a story or RCA)
- [ ] Implement reconciliation rule engine: apply PRD Section 9.2 rules per detected change category pair (Rule: code changes must trace to a story or RCA)
- [ ] Implement ADR trigger scanner: detect infrastructure/constraint/integration/scale signals in added diff lines (Rule: new dependencies must have a corresponding ADR)
- [ ] Implement hotfix marker detection in commit message for story-traceability exemption (Rule: code changes must trace to a story or RCA)
- [ ] Wire `check_diff` tool with grouped output per change category (Rule: code changes must trace to a story or RCA)
- [ ] Write diff Parquet record after each `check_diff` run (Rule: code changes must trace to a story or RCA)

## Story 012 — Complexity Tier 1

- [ ] Implement TypeScript/JavaScript AST walker using `@typescript-eslint/parser`: CC, cognitive, length, nesting, param count (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement SonarSource cognitive complexity algorithm in the TS walker (Rule: increasing complexity trends must be surfaced)
- [ ] Implement embedded Python AST script: write to temp, invoke, parse JSON output (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement embedded Go AST program: write to temp dir, `go run`, parse JSON output (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Gracefully skip Python/Go analysis when runtime is not present; return structured `RUNTIME_NOT_FOUND` (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement delta computation: compare current function metrics to prior run in Parquet for same function signature (Rule: increasing complexity trends must be surfaced)
- [ ] Implement CC-1 through CC-9 criteria checks with thresholds from config (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement spec-scenario count lookup for CC-2: match function names against spec Examples (Rule: high-complexity functions must have sufficient spec scenario coverage)
- [ ] Wire `check_complexity` tool: results grouped by file → function, sorted by CC descending (Rule: no function may exceed the cyclomatic complexity threshold)

## Story 013 — Complexity Tier 2

- [ ] Implement lizard invocation: detect presence, invoke with a supported machine-readable output format, parse output (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Map lizard output to standard per-function schema; set cognitive and nesting to null with unsupported_reason (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement language-to-tier routing: Tier 1 by extension, Tier 2 for all other lizard-supported extensions (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Run CC-1 through CC-9 on available Tier 2 metrics; skip criteria requiring null metrics with explanation (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Merge Tier 1 and Tier 2 results into single `check_complexity` response with per-file tier label (Rule: no function may exceed the cyclomatic complexity threshold)

## Story 014 — Dependency Management

- [ ] Implement dependency registry as a structured constant in the server (Rule: missing tools must be reported with install guidance)
- [ ] Implement `check_dependencies`: probe each registry entry, detect available package managers, report installed/missing/unavailable (Rule: missing tools must be reported with install guidance)
- [ ] Implement package manager detector: `which`/`where` probe for pipx, pip, npm, yarn, pnpm, go (Rule: missing tools must be reported with install guidance)
- [ ] Implement `install_dependency`: select install command by package manager priority, execute, verify with check command (Rule: installation failures must be categorised)
- [ ] Implement install failure pattern matcher: map stderr patterns to all failure reason categories (Rule: installation failures must be categorised)
- [ ] Implement `PATH_NOT_UPDATED` detection: post-install check command failure with binary path existence check (Rule: installation failures must be categorised)
- [ ] Return `InstallFailure` object on any non-success with all required fields populated (Rule: installation failures must be categorised)

## Story 015 — Mutation Testing

- [ ] Implement mutation tool router: detect language, select tool, check for tool presence (Rule: project mutation score must meet configured threshold)
- [ ] Implement Stryker integration: generate default config if absent, invoke with `--incremental`, parse JSON output (Rule: project mutation score must meet configured threshold)
- [ ] Implement mutmut integration: invoke on specified path, parse output (Rule: project mutation score must meet configured threshold)
- [ ] Implement go-mutesting integration: invoke, parse output; note incremental not supported (Rule: project mutation score must meet configured threshold)
- [ ] Implement spec-critical function identification: name-match against Rule and Example keywords, NLP similarity fallback (Rule: spec-critical functions must meet a higher mutation threshold)
- [ ] Implement MT-1 through MT-4 criteria checks with thresholds from config (Rule: project mutation score must meet configured threshold)
- [ ] Detect mutation trigger context (`pre_merge`, `pre_commit`) from env vars and git context (Rule: project mutation score must meet configured threshold)
- [ ] Write mutation Parquet record after each run (Rule: every check run must be persisted)
- [ ] Wire `check_mutation_score` tool with full result schema and duration reporting (Rule: project mutation score must meet configured threshold)

## Story 016 — Storage Architecture

- [ ] Implement Parquet naming convention: derive path segments from git context (org, repo, commit, branch) (Rule: every check run must be persisted)
- [ ] Incorporate LLM identity and check type into Parquet filename segments (Rule: every check run must be persisted)
- [ ] Implement path sanitiser: branch name `/`→`__`, spaces→`-`, length truncation (Rule: every check run must be persisted)
- [ ] Implement git context extractor: remote URL → org/repo, branch, short SHA, fallback values (Rule: every check run must be persisted)
- [ ] Implement Parquet writer using `parquetjs` or equivalent: define schemas per check type, atomic write (temp→rename) (Rule: every check run must be persisted)
- [ ] Make write failures non-fatal: log to stderr, never surface in tool response (Rule: persistence failure does not block analysis results)
- [ ] Implement DuckDB query engine wrapper: glob pattern construction, parameterised SQL, result mapping (Rule: cross-project metrics must be queryable by glob)
- [ ] Run DuckDB smoke-test query at startup: log WARNING on failure, do not halt server start (Rule: every check run must be persisted)
- [ ] Add `duckdb` to `package.json` dependencies (Rule: every check run must be persisted)
- [ ] Add Parquet write library to `package.json` dependencies (Rule: every check run must be persisted)

## Story 017 — Per-Project Metrics

- [ ] Implement project identity resolution from path: derive org/repo/service glob pattern (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement gate pass rate query and trend direction calculation (linear regression slope) (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement violation frequency aggregation: group by criterion_id, count, rank top 5 (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement CC/cognitive/length/nesting average and delta queries per time window (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement mutation score trend query (Rule: project mutation score must meet configured threshold)
- [ ] Implement assumption invalidation rate and supersession rate queries (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement story cycle time and RCA resolution time queries via git log dates (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement compliance score computation using configured gate weights (Rule: cross-project metrics must be queryable by glob)
- [ ] Wire `get_project_metrics` tool with `since` filter and all output formats (Rule: cross-project metrics must be queryable by glob)

## Story 018 — Cross-Project Rollup

- [ ] Implement storage-root glob query: `{root}/**/*.parquet` with no org/repo filter (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement per-project compliance score ranking (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement model Gate pass rate ranking across all projects (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement model assumption accuracy ranking with minimum-run guard (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement model CC trend ranking (Rule: increasing complexity trends must be surfaced)
- [ ] Implement unresolved RCA detection query (Rule: RCAs must link to a violated requirement)
- [ ] Implement most-common violation aggregation (top 10 across all projects) (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement `format: model_comparison` side-by-side ASCII table renderer (Rule: cross-project metrics must be queryable by glob)
- [ ] Wire `get_rollup` tool with `since` filter and all output formats (Rule: cross-project metrics must be queryable by glob)

## Story 019 — Assumption Metrics

- [ ] Implement assumption category classifier: keyword taxonomy mapping against assumption text and basis fields (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement per-project assumption metrics queries: total, invalidated, rate, by-artifact-type, by-model (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement days-to-invalidation computation from git creation date and Parquet timestamp (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement invalidation rate trend direction (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Wire `get_assumption_metrics` tool with `since` filter and all output formats (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Wire `get_supersession_history` tool with `since` and `artifact_type` filters (Rule: an invalidated assumption must produce a superseding artifact)

## Story 020 — Visualization

- [ ] Implement sparkline renderer: 14-entry history, fixed symbol set, per-gate pass/fail/warn/no-data (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement horizontal bar chart renderer for violation frequency (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement complexity heatmap ASCII table with CC/cognitive/length/nesting/delta columns (Rule: no function may exceed the cyclomatic complexity threshold)
- [ ] Implement compliance ranking bar ASCII table with mini-bar per project (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement model comparison side-by-side ASCII table (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement assumption invalidation board ASCII table (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement Mermaid `xychart-beta` renderer for gate pass rates, complexity, and mutation trends (Rule: cross-project metrics must be queryable by glob)
- [ ] Implement Mermaid `pie` chart renderer for assumption categories (Rule: LLM-authored artifacts must declare all assumptions explicitly)
- [ ] Implement Mermaid `graph LR` traceability renderer: Story → Requirement → Task → Test (Rule: code changes must trace to a story or RCA)
- [ ] Enforce 120-char max width in all ASCII tables with `…` truncation (Rule: cross-project metrics must be queryable by glob)
- [ ] Return `FORMAT_NOT_SUPPORTED` error for unsupported format/tool combinations (Rule: cross-project metrics must be queryable by glob)

## Story 021 — Configuration

- [ ] Implement global config loader from `~/.spec-check/config.json` using `os.homedir()` (Rule: project config overrides global config without replacing it)
- [ ] Implement project config loader from `<path>/spec-check.config.json` (Rule: project config overrides global config without replacing it)
- [ ] Implement key-by-key merge with source tracking (`default`/`global`/`project`) (Rule: project config overrides global config without replacing it)
- [ ] Implement `CONFIG_PARSE_ERROR` with file path on JSON parse failure (Rule: invalid config returns a structured error without crashing)
- [ ] Include line number in `CONFIG_PARSE_ERROR` when available from the parse exception (Rule: invalid config returns a structured error without crashing)
- [ ] Implement `CONFIG_VALIDATION_ERROR` for threshold range violations, weight sum ≠ 1.0, invalid mutation trigger, invalid cron expression (Rule: invalid config returns a structured error without crashing)
- [ ] Implement `resolve(key)` function returning value and source for use by Gate Engine and Protocol Builder (Rule: project config overrides global config without replacing it)
- [ ] Add config re-read per tool call (no startup cache) (Rule: project config overrides global config without replacing it)

## Story 022 — Monorepo Detection

- [ ] Implement four-step auto-detection algorithm: workspaces → subdirectory manifests → conventional dirs → root fallback (Rule: services are detected automatically for known monorepo structures)
- [ ] Exclude `node_modules`, `vendor`, `dist`, `build`, hidden directories from manifest scan (Rule: services are detected automatically for known monorepo structures)
- [ ] Implement explicit service config reader: validate `name` and `path` required fields; normalise service names (Rule: services are detected automatically for known monorepo structures)
- [ ] Implement `root_checks` routing: always write diff/deps/gate-adr/gate-rca Parquet to `root/` service path (Rule: whole-repo checks always run at root level)
- [ ] Detect the aggregated-mode trigger when path = project root and multiple services are detected (Rule: services are detected automatically for known monorepo structures)
- [ ] Run checks per service once aggregated mode is triggered (Rule: services are detected automatically for known monorepo structures)
- [ ] Aggregate per-service results into one response envelope in aggregated mode (Rule: services are detected automatically for known monorepo structures)
- [ ] Implement `ServiceMap` object: expose to all components for spec artifact path and Parquet path resolution (Rule: services are detected automatically for known monorepo structures)

## Story 023 — Rust and WASM Language Support

- [ ] Add cargo to the dependency registry: probe `cargo --version`, install guidance pointing to rustup.rs (Rule: the dependency check discovers Rust toolchain components)
- [ ] Add rustc to the dependency registry: probe `rustc --version`, install guidance pointing to rustup.rs (Rule: the dependency check discovers Rust toolchain components)
- [ ] Add wasm-pack to the dependency registry: probe `wasm-pack --version`, install via `cargo install wasm-pack` (Rule: the dependency check discovers Rust toolchain components)
- [ ] Add cargo runtime probe to `detectRuntimes()` using the existing `probeBinary` mechanism (Rule: the dependency check discovers Rust toolchain components)
- [ ] Add rustc runtime probe to `detectRuntimes()` using the existing `probeBinary` mechanism (Rule: the dependency check discovers Rust toolchain components)
- [ ] Add wasm-pack runtime probe to `detectRuntimes()` using the existing `probeBinary` mechanism (Rule: the dependency check discovers Rust toolchain components)
- [ ] Add `"rust"` to the `MutationLanguage` union type in `mutation.ts` (Rule: Rust source files are eligible for mutation testing via cargo-mutants)
- [ ] Add `.rs` extension mapping to `LANGUAGE_BY_EXT` in `mutation.ts` targeting `"rust"` (Rule: Rust source files are eligible for mutation testing via cargo-mutants)
- [ ] Add cargo-mutants to the dependency registry: probe `cargo mutants --version`, install via `cargo install cargo-mutants` (Rule: Rust source files are eligible for mutation testing via cargo-mutants)
- [ ] Implement cargo-mutants invocation by running `cargo mutants --json` in the project root (Rule: Rust source files are eligible for mutation testing via cargo-mutants)
- [ ] Implement cargo-mutants JSON output parser mapping mutants_generated, mutants_killed, score to the standard mutation schema (Rule: Rust source files are eligible for mutation testing via cargo-mutants)
- [ ] Apply MT-1 through MT-2 threshold checks to cargo-mutants results using the existing threshold evaluation path (Rule: Rust source files are eligible for mutation testing via cargo-mutants)
- [ ] Add Cargo.toml presence check to G5 to activate the Rust test runner path (Rule: G5 executability check executes cargo test for Rust projects)
- [ ] Implement `cargo test` subprocess execution in G5 with exit code capture (Rule: G5 executability check executes cargo test for Rust projects)
- [ ] Capture cargo test stderr output for inclusion in the E-1 criterion result on non-zero exit (Rule: G5 executability check executes cargo test for Rust projects)
- [ ] Implement wasm-bindgen dependency detection by scanning the Cargo.toml `[dependencies]` section for the wasm-bindgen key (Rule: G5 detects wasm-pack test as the test command for WASM-targeted Rust projects)
- [ ] Use `wasm-pack test --headless` as the G5 test command for projects where Cargo.toml contains wasm-bindgen (Rule: G5 detects wasm-pack test as the test command for WASM-targeted Rust projects)
- [ ] Return a WARNING noting wasm-pack absence for WASM projects where wasm-pack is not on the system path (Rule: G5 detects wasm-pack test as the test command for WASM-targeted Rust projects)
- [ ] Set `cargo test` as the G5 fallback test command for WASM projects where wasm-pack is absent (Rule: G5 detects wasm-pack test as the test command for WASM-targeted Rust projects)

## Story 024 — Story-First Enforcement

- [ ] Add story artifact discovery to check_tasks: scan the stories/ directory for .md files at gate entry (Rule: story artifact must exist before implementation tasks proceed)
- [ ] Implement S-5 criterion: return BLOCK in check_tasks output when no story file is found in the stories/ directory (Rule: story artifact must exist before implementation tasks proceed)
- [ ] List the identifiers with no matching story in the S-5 BLOCK evidence field (Rule: story artifact must exist before implementation tasks proceed)
- [ ] Wire story validation into the gate prerequisite chain so a story with missing required sections emits a prerequisite note in gate results (Rule: story must pass artifact validation before gate checks proceed)
- [ ] Expose a prerequisite note in the gate check result payload referencing the story validation failure when S-2 returns VIOLATION (Rule: story must pass artifact validation before gate checks proceed)

## Story 025 — ADR Blocking on Structural Diff Triggers

- [ ] Implement D-ADR-1 criterion: detect new dependency entries in manifest files from the diff payload (Rule: new dependency in a diff blocks until a corresponding ADR is present)
- [ ] Scan the adr/ directory for ADR files whose content references the detected dependency name (Rule: new dependency in a diff blocks until a corresponding ADR is present)
- [ ] Return BLOCK from D-ADR-1 with the dependency name in the evidence field when no matching ADR is found (Rule: new dependency in a diff blocks until a corresponding ADR is present)
- [ ] Implement D-ADR-2 criterion: detect security-related file changes in the diff by matching file names against a security signal keyword list (Rule: security constraint change in a diff blocks until a corresponding ADR is present)
- [ ] Scan the adr/ directory for ADR files referencing the changed security file or security domain (Rule: security constraint change in a diff blocks until a corresponding ADR is present)
- [ ] Return BLOCK from D-ADR-2 with the changed file name in the evidence field when no matching security ADR is found (Rule: security constraint change in a diff blocks until a corresponding ADR is present)
- [ ] Implement D-ADR-3 criterion: detect deployment manifest changes in the diff by file extension patterns (Rule: deployment topology change in a diff blocks until a corresponding ADR is present)
- [ ] Scan the adr/ directory for ADR files referencing the changed deployment file (Rule: deployment topology change in a diff blocks until a corresponding ADR is present)
- [ ] Return BLOCK from D-ADR-3 with the changed file name in the evidence field when no matching deployment ADR is found (Rule: deployment topology change in a diff blocks until a corresponding ADR is present)

## Story 026 — Reconciliation Gate

- [ ] Implement README claim extractor: parse README for feature claim phrases using a signal word list (Rule: README claims are consistent with actual repository artifacts)
- [ ] Implement artifact presence check for each extracted README claim against source file paths in the repository (Rule: README claims are consistent with actual repository artifacts)
- [ ] Return RC-1 VIOLATION listing the claimed feature name when no matching source file is found (Rule: README claims are consistent with actual repository artifacts)
- [ ] Expose reconciliation results via a check_reconciliation MCP tool (Rule: README claims are consistent with actual repository artifacts)
- [ ] Implement checked-checkbox scanner for tasks.md: extract artifact paths from completed task text (Rule: task completion claims are consistent with artifact content)
- [ ] Implement file presence check for each artifact path extracted from checked tasks (Rule: task completion claims are consistent with artifact content)
- [ ] Return RC-2 VIOLATION listing the task text when no file at the referenced artifact path is present (Rule: task completion claims are consistent with artifact content)

## Story 027 — Evidence Artifacts

- [ ] Implement release artifact scanner: detect files present in the release/ directory (Rule: verification evidence must be present when a release artifact exists)
- [ ] Implement verification evidence matcher: for each release artifact file find a corresponding file in the verification/ directory (Rule: verification evidence must be present when a release artifact exists)
- [ ] Return EV-1 VIOLATION listing the release artifact name when no matching verification file is found (Rule: verification evidence must be present when a release artifact exists)
- [ ] Expose evidence artifact results via a check_evidence MCP tool (Rule: verification evidence must be present when a release artifact exists)
- [ ] Implement benchmark annotation scanner: detect benchmark annotations in source files (Rule: benchmark results must be present for performance-sensitive components)
- [ ] Implement benchmark result matcher: for each annotated component find a corresponding file in the benchmarks/ directory (Rule: benchmark results must be present for performance-sensitive components)
- [ ] Return EV-2 WARNING listing the component name when no benchmark result file is found (Rule: benchmark results must be present for performance-sensitive components)

## Story 028 — Workflow Governance

- [ ] Extend protocol output with machine-readable workflow policy: `must_call_next`, `should_call_metrics`, `must_report_state`, `blocked`, and `blocked_by` (Rule: the MCP returns machine-readable next-action guidance after workflow-relevant tool calls)
- [ ] Add a workflow block to gate, diff, metrics, reconciliation, and evidence responses (Rule: the MCP returns machine-readable next-action guidance after workflow-relevant tool calls)
- [ ] Implement policy logic for metrics timing based on workflow phase (Rule: the MCP indicates when metrics should be run)
- [ ] Implement changed-file evaluation for metrics timing decisions (Rule: the MCP indicates when metrics should be run)
- [ ] Add `get_next_action` tool to compute next required checks for an agent (Rule: the MCP indicates when metrics should be run)
- [ ] Add `get_next_action` tool output for blocking prerequisites (Rule: the MCP indicates when metrics should be run)
- [ ] Add `get_next_action` tool output for metric obligations (Rule: the MCP indicates when metrics should be run)
- [ ] Ensure workflow logic requests explicit state reports rather than inferring hidden model state (Rule: the MCP can request explicit agent state instead of assuming hidden model state)

## Story 029 — Agent Identity and Session Tracking

- [ ] Extend common tool input schema with `agent_id`, `agent_kind`, `parent_agent_id`, `session_id`, and `run_id` (Rule: the MCP distinguishes agents of the same or different kinds)
- [ ] Replace `LLMIdentity`-only attribution with a richer actor identity object in server metadata and persistence paths (Rule: agent and session identity are attached to persisted records)
- [ ] Add `begin_session` tool: register an agent/session and return initial workflow obligations (Rule: the MCP exposes agent-session workflow tools)
- [ ] Add `report_agent_state` tool: persist goal, phase, working set, changed paths, open violations, and summary (Rule: the MCP can request explicit agent state instead of assuming hidden model state)
- [ ] Add `list_agent_state` tool: return latest known state for agents in a project or session (Rule: the MCP exposes agent-session workflow tools)
- [ ] Add `close_session` tool: mark an agent complete and persist final state (Rule: the MCP exposes agent-session workflow tools)
- [ ] Persist `agent_id`, `agent_kind`, `parent_agent_id`, `session_id`, and `run_id` on all workflow-relevant Parquet records (Rule: agent and session identity are attached to persisted records)

## Story 030 — Agent-Aware Metrics and Attribution

- [ ] Extend metrics schemas and queries to group by `agent_kind`, `agent_id`, and `session_id` in addition to `llm_model` (Rule: agent and session identity are attached to persisted records)
- [ ] Add rollup views for planner vs implementer vs reviewer behavior and compliance outcomes (Rule: the MCP distinguishes agents of the same or different kinds)
- [ ] Surface missing agent metadata explicitly in metrics outputs rather than silently dropping unattributed records (Rule: missing agent metadata remains visible)
- [ ] Add agent-session state history record storage and retrieval using Parquet + DuckDB globs (Rule: the MCP exposes agent-session workflow tools)
- [ ] Include agent-aware workflow notes in `get_protocol` so different agent kinds receive differentiated guidance (Rule: the MCP distinguishes agents of the same or different kinds)

## Story 031 — Local Daemon Runtime

- [x] Add a real CLI entrypoint that starts MCP stdio mode by default (Rule: stdio MCP mode remains supported alongside daemon mode)
- [x] Add `spec-check server` CLI mode that starts the local daemon runtime (Rule: spec-check can run as a long-lived local daemon independent of one MCP client)
- [x] Bind the daemon to loopback by default and expose host/port through `GET /health` (Rule: the daemon remains local-only by default)
- [x] Move MCP and daemon execution through the same shared tool executor (Rule: stdio MCP mode remains supported alongside daemon mode)
- [x] Verify MCP stdio and daemon mode both execute the same tool contract for the same project path (Rule: stdio MCP mode remains supported alongside daemon mode)

## Story 032 — HTTP JSON Tool API

- [x] Expose `GET /api/tools` using the shared MCP tool definitions (Rule: the daemon exposes a machine-readable tool catalog over HTTP)
- [x] Expose `POST /api/tools/call` using the shared tool executor and MCP-style response envelope (Rule: HTTP tool execution uses the same contract as MCP tool execution)
- [x] Return structured request errors for missing or unknown tools over HTTP (Rule: HTTP tool execution uses the same contract as MCP tool execution)
- [x] Merge actor metadata into HTTP tool calls without overriding explicit arguments (Rule: actor metadata can be supplied consistently over HTTP)
- [x] Add runtime interoperability coverage proving MCP and HTTP stay aligned (Rule: HTTP tool execution uses the same contract as MCP tool execution)

## Story 033 — Project Registry and Routing

- [x] Add a persistent project registry with canonical path resolution (Rule: projects can be registered with stable identifiers)
- [x] Expose `GET /api/projects` and `POST /api/projects` for project discovery and registration (Rule: projects can be registered with stable identifiers)
- [x] Resolve HTTP tool calls by `project_id` before falling back to `path` (Rule: daemon-mode tool calls resolve a target project explicitly)
- [x] Reject ambiguous daemon requests when multiple projects are registered and no project target is supplied (Rule: daemon-mode tool calls resolve a target project explicitly)
- [x] Preserve project-scoped metrics and workflow behavior by routing each request to its resolved canonical path (Rule: project state and metrics remain isolated across registered projects)

## Story 034 — Storage and Rollup Integrity Hardening

- [x] Add regression tests for collision-safe storage paths (Rule: every check run must be persisted)
- [x] Add regression tests for rollup supersession rate, unresolved RCA count, model assumption accuracy, and adoption trend (Rule: cross-project metrics must be queryable by glob)
- [x] Harden parquet event filenames against concurrent collisions (Rule: every check run must be persisted)
- [x] Make registry persistence atomic (Rule: projects can be registered with stable identifiers)
- [x] Correct rollup semantics to use project rates, current RCA state, artifact-derived assumption metrics, and historical compliance buckets (Rule: cross-project metrics must be queryable by glob)

## Story 035 — Init Script and Brew Tap

- [ ] Define `ToolAdapter` interface with `id`, `name`, `detect()`, `files(options)`, `install()` in `src/init.ts` (Rule: R-69 init writes tool-specific integration files)
- [ ] Implement `ClaudeAdapter`: writes `CLAUDE.md` fragment to project root (Rule: R-69 init writes tool-specific integration files)
- [ ] Implement `ClaudeAdapter` MCP server JSON merge into `~/.config/claude/claude_desktop_config.json` (Rule: R-69 init writes tool-specific integration files)
- [ ] Implement `CursorAdapter`: writes `.cursor/rules/spec-check.mdc` to project directory (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `GeminiAdapter`: writes `.gemini/GEMINI.md` to project directory (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `CodexAdapter`: writes `codex.md` to project root (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `OllamaAdapter`: writes `.ollama/spec-check.md` to project directory (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement adapter registry map keyed by tool id for O(1) lookup (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `runInit(options)` orchestrator: resolve adapter, check existing files, write with skip-on-exists logic (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `--force` flag support: overwrite existing files when present (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `--all` flag: call `detect()` on each adapter, configure those that return true (Rule: R-70 init supports all named tools without cross-adapter interference)
- [ ] Implement `runInstall(toolId, options)`: call adapter `install()`, report success or failure per dependency (Rule: R-71 install flag installs additional support dependencies)
- [ ] Reject `--install` when neither `--tool` nor `--all` is present with a structured error (Rule: R-71 install flag installs additional support dependencies)
- [ ] Wire `init` subcommand into `src/cli.ts` with `--tool`, `--all`, `--install`, `--force`, `--path` flags (Rule: R-69 init writes tool-specific integration files)
- [ ] Write `Formula/spec-check.rb` homebrew formula using npm install scoped to brew prefix (Rule: R-72 spec-check installable via homebrew tap)
- [ ] Add shell shim to formula so `spec-check` resolves on the system path after install (Rule: R-73 formula registers CLI entrypoint correctly)
- [ ] Add `caveats` block to formula referencing `spec-check init` with MCP registration instructions (Rule: R-73 formula registers CLI entrypoint correctly)
- [ ] Write `tests/init.test.ts` covering all adapters, skip-on-exists, --force, --all, unknown tool error (Rule: R-69, R-70, R-71)

## Assumptions

- The task list remains intentionally implementation-oriented and may reference concrete modules or tools because it is an execution artifact rather than a gate-validated requirements artifact.
- Stories may be implemented out of strict numerical order when hard dependencies require a different sequence, as defined by the implementation order in the PRD.
- Some later tasks refer to Parquet even though v1 storage currently writes JSONL, because those tasks describe the target architecture that subsequent stories will close toward.
