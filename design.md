# Design

References: Feature F-1 (MCP Server Foundation), Feature F-2 (Self-Description),
Feature F-3 (Gate 1 Intent), Feature F-4 (Gate 2 Requirements), Feature F-5 (Gate 3 Design),
Feature F-6 (Gate 4 Tasks), Feature F-7 (Gate 5 Executability),
Feature F-8 (Artifact Validation), Feature F-9 (Assumption Tracking),
Feature F-10 (Diff-Based Change Detection), Feature F-11 (Code Complexity Analysis),
Feature F-12 (Mutation Testing), Feature F-13 (Storage and Metrics),
Feature F-14 (Dependency Management), Feature F-15 (Configuration),
Feature F-16 (Monorepo Detection and Routing)

## Requirement Traceability

This design satisfies the following requirement rules:

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
| R-1 | Server starts reliably | MCP Server + Tool Router |
| R-2 | LLM identity resolved | Identity Resolver |
| R-3 | Tool is source of truth | Protocol Builder |
| R-4 | Intent document must exist | Gate Engine → G1 (I-1) |
| R-5 | Intent must articulate why | NLP Engine (I-2, I-3, I-4) |
| R-6 | No implementation in intent | NLP Engine (I-5) |
| R-7 | Every feature has a rule | Gate Engine → G2 (R-2) |
| R-8 | Positive and negative examples | Gate Engine → G2 (R-5, R-6) |
| R-9 | One WHEN per example | Gate Engine → G2 (R-8) |
| R-10 | GIVEN is state-only | NLP Engine (R-7) |
| R-11 | WHEN one actor one action | NLP Engine (R-8) |
| R-12 | THEN observable | NLP Engine (R-9) |
| R-13 | Design must exist | Gate Engine → G3 (D-1) |
| R-14 | Design references requirements | Gate Engine → G3 (D-2) |
| R-15 | Design no contradiction | NLP Engine (D-4) — WARNING only |
| R-16 | Tasks atomic | NLP Engine (T-2) |
| R-17 | Tasks traceable | Gate Engine → G4 (T-3) |
| R-18 | Test files exist | Gate Engine → G5 (E-1) |
| R-19 | Each rule has a test | Gate Engine → G5 (E-2) |
| R-20–R-22 | Artifact validation | Artifact Validator (Story 009) |
| R-23–R-25 | Assumption tracking | Assumption Tracker (Story 010) |
| R-26–R-27 | Diff change detection | Diff Analyser (Story 011) |
| R-28–R-30 | Complexity checks | AST Tier 1 + Tier 2 (Stories 012–013) |
| R-31–R-32 | Mutation testing | Mutation Runner (Story 015) |
| R-33–R-34 | Storage and metrics | Parquet Writer + DuckDB (Stories 016–018) |
| R-35–R-36 | Dependency management | Dependency Registry (Story 014) |
| R-37–R-38 | Configuration | Config Loader (Story 021) |
| R-39–R-40 | Monorepo detection | Monorepo Detector (Story 022) |

## Components

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Server (stdio)                     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Tool Router │  │   Identity   │  │  Config Loader   │  │
│  │              │  │  Resolver    │  │  (global+project)│  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Gate Engine                        │   │
│  │  G1:Intent  G2:Reqs  G3:Design  G4:Tasks  G5:Exec  │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                          │                                  │
│  ┌───────────────────────┼──────────────────────────────┐  │
│  │    Analyser Layer     │                              │  │
│  │  ┌──────────┐  ┌──────┴──────┐  ┌────────────────┐  │  │
│  │  │ NLP      │  │  AST Tier 1 │  │  Tier 2/lizard │  │  │
│  │  │ Engine   │  │  (TS/Py/Go) │  │  (other langs) │  │  │
│  │  └──────────┘  └─────────────┘  └────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Metrics and Storage Layer                 │  │
│  │   Parquet Writer │ DuckDB Query Engine │ Glob Router  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Component Descriptions

### MCP Server (stdio transport)
Entry point. Implements the MCP protocol over stdio using `@modelcontextprotocol/sdk`.
Handles tool listing and tool dispatch. Wraps all tool execution in a try/catch boundary
that returns structured errors — never raw stack traces. Attaches resolved LLM identity
and server version to every response envelope.

### Tool Router
Maps incoming tool names to handler functions. Returns a structured `UNKNOWN_TOOL` error
for unrecognised names. Validates that required arguments are present before dispatching;
returns `MISSING_ARGUMENT` errors naming the missing field.

### Identity Resolver
Resolves the calling LLM identity in priority order: tool argument → `SPEC_CHECK_LLM`
env var → `default_llm` from config → `"unknown"`. Produces a structured identity object
(`provider`, `model`, `id`) attached to every Parquet write.

### Config Loader
Reads and merges `~/.spec-check/config.json` (global) and `<project-root>/spec-check.config.json`
(project). Re-reads on every tool call. Validates JSON and emits structured
`CONFIG_PARSE_ERROR` or `CONFIG_VALIDATION_ERROR` on problems. Exposes a `resolve(key)`
function that returns the effective value and its source (`default`, `global`, `project`).

### Gate Engine
Orchestrates gate execution. Runs G1 → G2 → G3 → G4 → G5 in sequence. Halts progression
on BLOCK within a gate; continues collecting remaining violations within the blocked gate.
Collects WARNINGs without halting. Produces the consolidated report structure consumed by
`run_all` and individual `check_*` tools.

### NLP Engine
Stateless rule-based text analyser. All checks are keyword/pattern matching against
document text. Exposes typed check functions: `detectCausalLanguage`, `detectImperativeVerb`,
`detectCompoundClause`, `detectInternalState`, `detectImplementationLeak`,
`detectCertaintyLanguage`, `detectComponentLanguage`, `detectNegationProximity`.
Each function returns a result with: `matched: boolean`, `confidence: number (0–1)`,
`evidence: string[]` (matched phrases). Thresholds applied by the Gate Engine, not the
NLP Engine — the engine is threshold-agnostic.

### AST Tier 1 — TypeScript/JavaScript
Uses `@typescript-eslint/parser` to walk the AST. Computes CC (decision node count),
cognitive complexity (SonarSource nesting+structural algorithm), function length
(non-blank lines between open and close brace), nesting depth (max depth counter during
walk), parameter count. Anonymous functions named by assignment target or parent context.

### AST Tier 1 — Python
Embeds a Python script as a string literal. At analysis time, writes the script to a
temp file and invokes `python3 -c` or `python3 <temp>`. Script uses the `ast` stdlib
module to walk the tree and compute the same four metrics. Output is JSON to stdout.

### AST Tier 1 — Go
Embeds a Go program as a string literal. At analysis time, writes to a temp file in a
temp directory and invokes `go run <temp>`. Program uses `go/parser` and `go/ast` to
walk the tree. Output is JSON to stdout. Falls back gracefully if Go is not present.

### Tier 2 — lizard and Companions
Invokes external CLI tools via subprocess. Parses lizard's supported machine-readable output.
Maps CC and
length to the standard schema; sets cognitive complexity and nesting depth to `null` with
`unsupported_reason`. Routes to `gocognit`, `radon`, or other companions for supplemental
metrics where available.

### Dependency Registry
Static JSON structure (bundled in the server) describing every external tool: check
command, install commands per package manager, runtime prerequisite, metrics covered,
and languages covered. `check_dependencies` reads this registry and probes each entry.
`install_dependency` selects the install command and executes it.

### Mutation Runner
Routes mutation testing to the appropriate tool by language. Detects tool presence,
generates default config if needed (Stryker), executes incrementally where supported,
parses output into the standard mutation schema. Identifies spec-critical functions by
name matching against requirement Rules and Examples.

### Diff Analyser
Invokes `git diff` via subprocess. Categorises changed files using extension and path
pattern matching. Applies reconciliation rules per category pair. Scans diff content
(added lines) for ADR trigger signals using the NLP Engine. Returns structured violations
and warnings per reconciliation rule.

### Monorepo Detector
Applies the four-step auto-detection algorithm (workspaces → subdirectory manifests →
conventional directories → root fallback). Reads explicit service config when
`strategy: "services"` is set. Produces a `ServiceMap` object used by all other
components to resolve spec artifact paths and Parquet service path segments.

### Parquet Writer
Writes run results to Parquet files at the naming-convention path. Uses atomic write
(temp file → rename). Failures are non-fatal: logged to stderr, tool response unaffected.
Each check type has a defined column schema; inapplicable columns are NULL.

### DuckDB Query Engine
Wraps the `duckdb` npm package. Executes SQL queries against glob-addressed Parquet files.
Used exclusively by metrics tools (`get_project_metrics`, `get_rollup`, `get_assumption_metrics`,
`get_supersession_history`, trend queries). All queries constructed with parameterised
inputs; no string interpolation of user-provided values.

### Protocol Builder
Constructs the `get_protocol` response. Reads the gate/criterion definitions from a
structured constant (the embedded protocol document), resolves current thresholds from
Config Loader for the given path, and serialises to the requested format (text/json/markdown).
Increments `protocol_version` integer when the constant changes between releases.
Also carries enumerated validation rules for artifact schemas and assumption phrasing,
including the ADR status validation in `R-21` and the assumption-certainty guard in `R-24`.

## Data Flow — Single Tool Call

```
MCP request
  → Tool Router (validate args, identify tool)
  → Identity Resolver (resolve LLM identity)
  → Config Loader (load + merge config for path)
  → Monorepo Detector (resolve service context)
  → Gate Engine / specific tool handler
      → NLP Engine (stateless checks)
      → AST walkers or Tier 2 subprocess (complexity)
      → Mutation Runner (if check_mutation_score)
      → Diff Analyser (if check_diff)
  → Parquet Writer (async, non-blocking result delivery)
  → MCP response (structured result + metadata)
```

## Data Flow — Metrics Query

```
MCP request (get_project_metrics / get_rollup)
  → Config Loader (storage root path)
  → DuckDB Query Engine
      → glob pattern constructed from org/repo/service/date
      → SQL query over read_parquet(glob)
  → Visualization renderer (text / json / mermaid)
  → MCP response
```

## Key Design Decisions

### No shared mutable state
Every tool call is stateless. Config is reloaded per call. NLP engine is pure functions.
AST walkers produce fresh output. Only the Parquet files on disk carry state between calls.
This makes behaviour deterministic and testable.

### Parquet write is always async and non-fatal
Analysis results are returned to the caller before Parquet write completes. A disk failure
never degrades the tool's primary function. This satisfies the <2s latency requirement for
gate checks.

### Complexity scenario coverage mapping
The complexity analysis path maintains a lookup between function identities and spec scenarios
so the checker can enforce `R-29`: higher-complexity functions require enough scenarios in the
requirements corpus to justify their branching behaviour.

### NLP engine is threshold-agnostic
The NLP engine returns confidence scores; the Gate Engine applies thresholds. This means
thresholds can change via config without touching analysis logic. A single NLP function
serves both strict and lenient configurations.

### Embedded runtime helpers (Python, Go)
The Python and Go AST scripts are embedded as string constants in the TypeScript server.
This keeps the tool self-contained: no external `.py` or `.go` files to manage, no path
resolution issues. The temp file is cleaned up after each invocation.

### DuckDB read-only, Parquet write via parquetjs
DuckDB is used exclusively for queries. Writes use a dedicated Parquet library. This
separation keeps the write path simple and the query path powerful without coupling them.

## ADR References

- **ADR-001**: DuckDB + Parquet storage decision
- **ADR-002**: Rule-based NLP vs local embedding model
- **ADR-003**: Bundled AST walkers vs lizard-first approach
- **ADR-004**: Mutation testing execution model
- **ADR-005**: `get_protocol` format and versioning strategy

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | stdio transport is sufficient for all LLM clients | Inferred from MCP SDK defaults and Claude Code's transport model; HTTP not requested | A second transport layer would be needed for non-stdio clients |
| A2 | @typescript-eslint/typescript-estree provides sufficient AST fidelity for CC computation | Chosen because it is the de-facto standard TS parser; not benchmarked against alternatives | CC values may differ slightly from other tools; calibrate thresholds if discrepancies arise |
| A3 | DuckDB npm package installs cleanly without system libraries | Assumed based on typical macOS/Linux npm environments; not tested on restricted CI agents | Storage falls back to JSONL-only; metrics queries would be unavailable until DuckDB installs |
| A4 | lizard's supported machine-readable output shape is stable across minor versions | Inferred from lizard's versioning history; not contractually guaranteed | Tier 2 parser would need a version check and output adapter if the CLI changes |
| A5 | Git remote URL patterns follow github.com/org/repo convention | Chosen because GitHub is the dominant host; GitLab/Bitbucket URLs are handled by the same regex | Edge-case remote URL formats may parse to fallback "local/unknown" org/repo values |
| A6 | One spec file per gate per service is the intended authoring model | Derived from the spec-driven methodology; user did not specify multi-file support | Multi-file requirements or split intent docs would need a merge pass before gate checks |
