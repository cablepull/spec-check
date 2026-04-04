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

## Assumptions

- The task list remains intentionally implementation-oriented and may reference concrete modules or tools because it is an execution artifact rather than a gate-validated requirements artifact.
- Stories may be implemented out of strict numerical order when hard dependencies require a different sequence, as defined by the implementation order in the PRD.
- Some later tasks refer to Parquet even though v1 storage currently writes JSONL, because those tasks describe the target architecture that subsequent stories will close toward.
