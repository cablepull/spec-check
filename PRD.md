# spec-check — Product Requirements Document

**Version:** 0.4.0-draft
**Status:** Pre-execution — pending stories and implementation
**Last updated:** 2026-04-03

---

## 1. Overview

`spec-check` is a local MCP server that enforces spec-driven development methodology through
static analysis and rule-based NLP. It operates as a gating mechanism in the development
workflow: an LLM calls it at defined checkpoints, receives a deterministic verdict with
specific violations, and must resolve those violations before the workflow advances.

The tool is self-describing. Any LLM connecting to it for the first time calls `get_protocol`
to receive the complete enforcement specification — every gate, every criterion, every artifact
contract, every assumption rule — so it can follow the methodology correctly without relying
on training data or external documentation. The tool is the source of truth for its own protocol.

The tool also maintains per-project and cross-project compliance metrics — including code
complexity, mutation scores, assumption invalidation rates, and supersession frequency —
stored as Parquet files queryable with DuckDB and glob patterns.

---

## 2. Core Design Principles

1. **Local only.** No network calls during analysis. Dependency installation requires network
   but is an explicit, user-confirmed action separate from analysis.
2. **Deterministic by default.** Static checks always produce the same result for the same input.
3. **Tunable NLP.** Non-deterministic checks expose configurable thresholds so teams can tighten
   or loosen them as their process matures.
4. **Gate, don't suggest.** The tool blocks advancement. Warnings are informational; violations
   are blockers.
5. **Diff-aware.** The tool understands what changed and applies targeted reconciliation rules
   rather than re-running full validation on unchanged artifacts.
6. **Metrics as a first-class citizen.** Every check run is recorded. Trends are queryable.
7. **Transparent about capability.** When an analysis tool is missing or fails to install, the
   tool explains precisely why and what is affected — it never silently skips analysis.
8. **Self-describing.** The tool exposes its own protocol as a queryable artifact. An LLM
   always has access to the current enforcement specification by calling `get_protocol`.

---

## 3. Artifact Model

### 3.1 Required artifacts per project

```
<project-root>/
├── intent.md               — WHY this project/feature exists
├── requirements.md         — WHAT the system must do (or specs/ directory)
├── design.md               — HOW it will be built
├── tasks.md                — discrete, traceable implementation steps
├── stories/                — feature and change descriptions
│   ├── <story-id>.md
│   └── archive/            — superseded stories
│       └── <story-id>_<YYYYMMDD>_superseded.md
├── adr/                    — architectural decision records
│   ├── <adr-id>-<title>.md
│   └── archive/
├── rca/                    — root cause analyses
│   ├── <rca-id>-<title>.md
│   └── archive/
└── archive/                — superseded intent docs
    └── intent_<YYYYMMDD>_superseded.md
```

### 3.2 Artifact definitions

#### Intent (`intent.md`)
Captures WHY. Must explain the problem being solved, the constraints, and the rationale.
Must NOT describe implementation. Must include `## Assumptions` if authored by an LLM.

#### Requirements (`requirements.md` or `specs/`)
Captures WHAT. Structured as Features → Rules → Examples → Given/When/Then. Must cover
positive and negative cases per Rule.

#### Design (`design.md`)
Captures HOW. Describes components, data models, and boundaries. Must reference Requirements.
Triggers an ADR when architectural decisions are introduced or changed.

#### Tasks (`tasks.md`)
Captures DO. Atomic checkbox-formatted steps, each traceable to a Rule.

#### Stories (`stories/<story-id>.md`)
Entry point for every feature or change. Every code change traces to a story.

**Required sections:**
- `## Intent` — why this feature exists or is changing
- `## Acceptance Criteria` — what done looks like in user-visible terms
- `## ADR Required` — yes/no; if yes, links to the ADR
- `## Requirements` — link to requirements this story drives
- `## Assumptions` — all LLM-inferred decisions not specified by the user (see Section 5)

**Superseded story header (added when superseded):**
```markdown
## Status: Superseded
Superseded on <date>. Reason: assumption <ID> invalidated by user.
Replaced by: [<story-id>-v2.md](<story-id>-v2.md)
```

**Replacement story header:**
```markdown
## Supersedes
Replaces [archive/<original>_<date>_superseded.md].
Reason: assumption <ID> (<text>) was invalidated.
```

#### ADR (`adr/<id>-<title>.md`)
Documents architectural decisions. Created when diffs introduce new dependencies,
infrastructure, security/performance constraints, or scope expansion.

**Required sections:**
- `## Status` — Proposed | Accepted | Superseded | Deprecated
- `## Context`
- `## Decision`
- `## Consequences`
- `## Alternatives Considered`

**ADR trigger conditions (detected in diffs):**
- New external dependency in any manifest file
- Infrastructure keywords: `database`, `queue`, `cache`, `service`, `broker`, `cluster`,
  `region`, `replica`
- Constraint keywords: `performance`, `latency`, `throughput`, `compliance`, `regulation`,
  `security`, `encryption`, `authentication`, `authorization`
- Integration keywords: `API`, `webhook`, `integration`, `third-party`, `external`, `provider`
- Scale indicators: numeric values paired with units (`1000 users`, `10ms`, `99.9%`)

#### RCA (`rca/<id>-<title>.md`)
Created when a bug surfaces. Traces to the violated requirement and drives a spec update.

**Required sections:**
- `## Summary`
- `## Root Cause`
- `## Violated Requirement` — link to the requirement that was wrong or missing
- `## Resolution`
- `## Spec Update Required` — yes/no
- `## ADR Required` — yes/no
- `## Assumptions` — if authored by an LLM

---

## 4. Gate Model

```
INTENT ──[G1]── REQUIREMENTS ──[G2]── DESIGN ──[G3]── TASKS ──[G4]── IMPLEMENT ──[G5]── DONE
```

All VIOLATION-level criteria must pass before the workflow advances. WARNING-level criteria
pass the gate but are recorded in metrics.

Code quality metrics (CC, mutation) are tracked continuously and surface as WARNINGs.
They do not block gates. See Section 6.

| Gate | Name | Checks |
|------|------|--------|
| G1 | Intent Valid | I-1 through I-6 |
| G2 | Requirements Valid | R-1 through R-10 |
| G3 | Design Valid | D-1 through D-4 |
| G4 | Tasks Valid | T-1 through T-4 |
| G5 | Executability | E-1 through E-3 |

---

## 5. Enforcement Criteria

### Severity levels

| Level | Meaning |
|-------|---------|
| BLOCK | Hard failure — gate cannot pass regardless of other results |
| VIOLATION | Gate fails — specific fix required |
| WARNING | Gate passes — recorded in metrics, flagged for review |

All NLP-based criteria expose a `threshold` configuration value (0.0–1.0).

---

### Gate 1 — Intent

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| I-1 | Intent document exists | Static | BLOCK | No |
| I-2 | Contains a problem statement (causal language present) | NLP | VIOLATION | Yes |
| I-3 | Contains at least one constraint or boundary | NLP | VIOLATION | Yes |
| I-4 | Solution not described before problem | NLP | VIOLATION | Yes |
| I-5 | No implementation details | Static + NLP | WARNING | Yes |
| I-6 | Minimum 50 words | Static | VIOLATION | No |

**NLP signals — I-2:** `because`, `in order to`, `so that`, `the problem is`, `currently`,
`without this`, `this prevents`, `the reason`, `we need`, `this enables`

**NLP signals — I-5:** PascalCase identifiers, `snake_case` patterns, framework names,
DB column patterns, technology-specific terms

---

### Gate 2 — Requirements

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| R-1 | At least one Feature defined | Static | BLOCK | No |
| R-2 | Each Feature has ≥1 Rule | Static | VIOLATION | No |
| R-3 | Each Rule is declarative, not imperative | NLP | VIOLATION | Yes |
| R-4 | Each Rule has ≥1 positive Example | Static | VIOLATION | No |
| R-5 | Each Rule has ≥1 negative/error Example | Static + NLP | VIOLATION | Yes |
| R-6 | Each Example has exactly one WHEN | Static | BLOCK | No |
| R-7 | GIVEN steps describe state, not actions | NLP | VIOLATION | Yes |
| R-8 | WHEN is a single actor performing a single action | NLP | VIOLATION | Yes |
| R-9 | THEN steps are externally observable, not internal state | NLP | VIOLATION | Yes |
| R-10 | No implementation leakage in any step | Static + NLP | WARNING | Yes |

**NLP signals — R-3 (imperative):** `Accept`, `Reject`, `Show`, `Hide`, `Send`, `Create`,
`Delete`, `Validate`, `Check`, `Return` at sentence start

**NLP signals — R-7 (action in GIVEN):** `click`, `submit`, `enter`, `type`, `call`,
`send`, `navigate`, `request`, `trigger`, `invoke`

**NLP signals — R-8 (compound WHEN):** `and` joining two independent clauses, multiple
subjects, `and then`

**NLP signals — R-9 (internal THEN):** `the database contains`, `the function returns`,
`the variable is`, `the object has`, `the cache`, `the log`, `the internal`

---

### Gate 3 — Design

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| D-1 | Design document exists | Static | BLOCK | No |
| D-2 | References ≥1 Requirement by name or ID | Static | VIOLATION | No |
| D-3 | Describes ≥1 component or architectural boundary | NLP | VIOLATION | Yes |
| D-4 | Does not contradict any Rule in Requirements | NLP | WARNING | Yes |

**Note on D-4:** Probabilistic. Cannot be promoted to VIOLATION. Surfaced for human review.

---

### Gate 4 — Tasks

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| T-1 | Tasks document exists with ≥1 checkbox item | Static | BLOCK | No |
| T-2 | Each task is atomic (no `and` joining two actions) | NLP | VIOLATION | Yes |
| T-3 | Each task traces to ≥1 Rule or Requirement | Static + NLP | VIOLATION | Yes |
| T-4 | Tasks collectively cover all Rules | NLP | WARNING | Yes |

---

### Gate 5 — Executability

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| E-1 | Test files exist | Static | BLOCK | No |
| E-2 | Each Rule has a corresponding test | Static + NLP | VIOLATION | Yes |
| E-3 | Tests use spec-style language | Static | WARNING | No |

---

### Stories, ADR, RCA

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| S-1 | Story has `## Intent` section | Static | VIOLATION | No |
| S-2 | Story has `## Acceptance Criteria` section | Static | VIOLATION | No |
| S-3 | Story references ≥1 Requirement | Static | VIOLATION | No |
| S-4 | Story declares `## ADR Required` | Static | VIOLATION | No |
| S-5 | Story has `## Assumptions` section | Static | VIOLATION | No |
| A-1 | ADR has all required sections | Static | VIOLATION | No |
| A-2 | ADR Status is a valid value | Static | VIOLATION | No |
| A-3 | ADR links to triggering Story or Intent | Static | WARNING | No |
| RC-1 | RCA has all required sections | Static | VIOLATION | No |
| RC-2 | RCA links to a Requirement | Static | VIOLATION | No |
| RC-3 | RCA declares whether spec update is required | Static | VIOLATION | No |
| RC-4 | RCA declares whether ADR is required | Static | VIOLATION | No |
| RC-5 | RCA has `## Assumptions` section | Static | VIOLATION | No |

---

### Assumption Tracking

| ID | Criterion | Method | Severity | Tunable |
|----|-----------|--------|----------|---------|
| AS-1 | Every LLM-authored story, intent, and RCA has `## Assumptions` section | Static | VIOLATION | No |
| AS-2 | Each assumption has ID, text, basis, and status | Static | VIOLATION | No |
| AS-3 | Assumption text is phrased as uncertain, not stated as fact | NLP | VIOLATION | Yes |
| AS-4 | Invalidated assumption triggers supersession — replacement artifact must exist | Static | BLOCK | No |
| AS-5 | Superseded artifact references its replacement | Static | VIOLATION | No |
| AS-6 | Replacement artifact references what it supersedes and the reason | Static | VIOLATION | No |

**Assumption table format (required in every LLM-authored artifact):**

```markdown
## Assumptions

Decisions made that were not explicitly specified by the user.
To invalidate, change status to `invalidated` and note the reason.

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | OAuth2 used for authentication | Not specified; industry default | `assumed` |
```

If no assumptions: `None — all decisions explicitly specified by the user.`

**NLP signals — AS-3 (assumption stated as fact):**
`will`, `is`, `always`, `the system uses`, `users expect` — without hedging language
such as `assumed`, `not specified`, `defaulted to`, `chosen because not stated`

**Supersession flow:**
```
User marks assumption invalid
  → Original artifact: status = Superseded, moved to archive/
  → New version created with ## Supersedes header
  → Supersession event written to Parquet (check-type: supersession)
  → Downstream artifacts (design, tasks) flagged as potentially stale
```

---

## 6. Code Quality Metrics

Not blocking gates. Tracked continuously, surfaced as WARNINGs with deltas.

### 6.1 Per-function metrics

| Metric | Description |
|--------|-------------|
| Cyclomatic Complexity (CC) | Independent paths — minimum scenarios needed for full coverage |
| Cognitive Complexity | SonarSource algorithm — reflects human readability |
| Function length | Lines of code excluding blanks and comments |
| Nesting depth | Maximum nesting depth within the function |
| Parameter count | Number of formal parameters |
| Spec-complexity ratio | CC vs spec scenario count — surfaces the coverage gap |

### 6.2 Deltas

All metrics stored per function per run with git commit hash. Deltas computed by the
metrics layer on every run:

`cc_delta`, `cognitive_delta`, `length_delta`, `nesting_delta`

A sustained positive trend across ≥3 consecutive runs surfaces as a WARNING.

### 6.3 Code quality criteria

| ID | Criterion | Severity | Tunable | Default |
|----|-----------|----------|---------|---------|
| CC-1 | No function exceeds CC threshold | VIOLATION | Yes | 10 |
| CC-2 | Functions with CC > threshold have scenario count ≥ CC | WARNING | Yes | 10 |
| CC-3 | Average CC per file ≤ threshold | WARNING | Yes | 5 |
| CC-4 | Nesting depth ≤ threshold | WARNING | Yes | 4 |
| CC-5 | Parameter count ≤ threshold | WARNING | Yes | 5 |
| CC-6 | CC delta not increasing across ≥3 consecutive runs | WARNING | No | — |
| CC-7 | Cognitive complexity delta not increasing | WARNING | No | — |
| CC-8 | Function length delta not increasing | WARNING | No | — |
| CC-9 | Nesting depth delta not increasing | WARNING | No | — |

**CC threshold guidance:**
1–10 simple | 11–20 complex | 21–50 very complex (VIOLATION) | >50 BLOCK

### 6.4 Mutation testing

Mutation testing seeds small faults and measures whether the test suite kills them.
Mutation score is the strongest available signal for whether tests constrain behavior,
not just execute code. Critical for LLM-generated tests which can achieve high coverage
while asserting nothing meaningful.

**Execution model — not a blocking gate:**
Mutation testing is computationally expensive and runs outside the standard gate flow.

**Default trigger:** `pre_merge` — after tests are written, before a branch merges to main.
This is where surviving mutants can still be fixed with full context.

**Configurable triggers:**

| Trigger | When | Use case |
|---------|------|----------|
| `pre_merge` | Before merge to main **(default)** | Real gate without blocking local dev |
| `nightly` | Scheduled overnight | Trend data without merge friction |
| `weekly` | Scheduled weekly | Lightweight baseline tracking |
| `on_demand` | Only via `check_mutation_score` | Not yet automated |
| `pre_commit` | Every commit | Small projects with fast suites only |

**Incremental mode** (`--incremental` in Stryker): only mutates changed files. Enabled
by default where supported.

| ID | Criterion | Severity | Tunable | Default |
|----|-----------|----------|---------|---------|
| MT-1 | Project mutation score meets threshold | WARNING | Yes | 80% |
| MT-2 | Spec-critical function mutation score meets higher threshold | VIOLATION | Yes | 90% |
| MT-3 | Mutation score trend not declining across runs | WARNING | No | — |
| MT-4 | No surviving mutants in functions with CC > threshold | VIOLATION | Yes | 10 |

---

## 7. Analysis Tiers

### Tier 1 — Native AST walkers (bundled)

| Language | Parser | CC | Cognitive | Length | Nesting |
|----------|--------|----|-----------|--------|---------|
| TypeScript / JavaScript | `@typescript-eslint/parser` | ✅ | ✅ | ✅ | ✅ |
| Python | `ast` stdlib | ✅ | ✅ | ✅ | ✅ |
| Go | `go/parser` (if Go present) | ✅ | ✅ | ✅ | ✅ |

Cognitive complexity uses the published SonarSource algorithm — no dependency.

### Tier 2 — lizard and companions (installed on demand)

| Language group | CC | Cognitive | Length | Nesting |
|---------------|----|-----------|--------|---------|
| Java, C, C++, C#, Ruby, Swift, Rust, Scala, Kotlin | ✅ | ❌ unsupported | ✅ | ❌ unsupported |

### Mutation testing tools

| Language | Tool | Install | Incremental |
|----------|------|---------|-------------|
| TypeScript / JavaScript | Stryker Mutator | `npm install --save-dev @stryker-mutator/core` | ✅ |
| Python | mutmut | `pipx install mutmut` | ❌ |
| Go | go-mutesting | `go install github.com/zimmski/go-mutesting/...@latest` | ❌ |
| Java | PIT (Pitest) | Maven/Gradle plugin | ✅ |

---

## 8. Dependency Management

### 8.1 Dependency registry

```json
{
  "dependencies": {
    "lizard": {
      "check": "lizard --version",
      "install": { "pipx": "pipx install lizard", "pip": "pip install lizard" },
      "requires_runtime": "python",
      "covers": ["cc", "length"],
      "languages": ["java", "c", "cpp", "csharp", "ruby", "swift", "rust"]
    },
    "gocognit": {
      "check": "gocognit -help",
      "install": { "go": "go install github.com/uudashr/gocognit/cmd/gocognit@latest" },
      "requires_runtime": "go",
      "covers": ["cognitive_complexity"],
      "languages": ["go"]
    },
    "radon": {
      "check": "radon --version",
      "install": { "pipx": "pipx install radon", "pip": "pip install radon" },
      "requires_runtime": "python",
      "covers": ["cc", "cognitive_complexity", "length"],
      "languages": ["python"]
    },
    "stryker": {
      "check": "npx stryker --version",
      "install": {
        "npm": "npm install --save-dev @stryker-mutator/core @stryker-mutator/typescript-checker",
        "yarn": "yarn add --dev @stryker-mutator/core @stryker-mutator/typescript-checker"
      },
      "requires_runtime": "node",
      "covers": ["mutation_score"],
      "languages": ["typescript", "javascript"]
    },
    "mutmut": {
      "check": "mutmut --version",
      "install": { "pipx": "pipx install mutmut", "pip": "pip install mutmut" },
      "requires_runtime": "python",
      "covers": ["mutation_score"],
      "languages": ["python"]
    },
    "go-mutesting": {
      "check": "go-mutesting --help",
      "install": { "go": "go install github.com/zimmski/go-mutesting/...@latest" },
      "requires_runtime": "go",
      "covers": ["mutation_score"],
      "languages": ["go"]
    }
  }
}
```

### 8.2 Installation failure analysis

All install failures return a structured `InstallFailure` object — never a raw exit code.

```typescript
interface InstallFailure {
  dependency: string;
  reason: FailureReason;
  human_explanation: string;  // plain language: what went wrong
  suggestion: string;         // specific next step
  affects_metrics: string[];  // which metrics are unavailable
  affects_languages: string[];
  raw_output: string;         // full stderr for debugging
}

type FailureReason =
  | "RUNTIME_NOT_FOUND"       // python/go/node not installed or not in PATH
  | "PACKAGE_MANAGER_MISSING" // pip/pipx/npm/go not available
  | "PERMISSION_DENIED"       // needs sudo or elevated permissions
  | "PACKAGE_NOT_FOUND"       // wrong name, yanked, or registry unreachable
  | "VERSION_CONFLICT"        // conflicts with existing packages
  | "PATH_NOT_UPDATED"        // installed but binary not in PATH
  | "DISK_SPACE"              // insufficient disk space
  | "ENV_CONFLICT"            // virtualenv, conda, or nvm conflict
  | "RUNTIME_VERSION"         // runtime present but version too old
  | "UNKNOWN";
```

**Failure pattern matching:**

| Pattern in stderr | Reason | Explanation template |
|-------------------|--------|---------------------|
| `command not found: python\|pip\|pipx` | `RUNTIME_NOT_FOUND` | "Python is not installed or not in PATH. Install Python 3.8+ then retry." |
| `Permission denied` | `PERMISSION_DENIED` | "Needs elevated permissions. Try pipx (user-space) or sudo pip." |
| `No matching distribution found` | `PACKAGE_NOT_FOUND` | "Package not found on PyPI. Verify name and network access." |
| `pip's dependency resolver` | `VERSION_CONFLICT` | "Dependency conflict detected. Use a virtual environment." |
| `installed in ... not on PATH` | `PATH_NOT_UPDATED` | "Installed successfully but binary directory not in PATH. Add ~/.local/bin to PATH." |
| `No space left on device` | `DISK_SPACE` | "Insufficient disk space. Free space and retry." |
| `externally managed` | `ENV_CONFLICT` | "System Python is OS-managed. Use pipx or a virtual environment." |
| `requires Python >=X.Y` | `RUNTIME_VERSION` | "Python X.Y+ required. Current version is too old." |
| `go: command not found` | `RUNTIME_NOT_FOUND` | "Go is not installed. Install from go.dev then retry." |
| All other non-zero exits | `UNKNOWN` | "Unrecognized failure. See raw_output." |

---

## 9. Diff-Based Change Detection

### 9.1 Change categories

| Category | File patterns |
|----------|--------------|
| Intent | `intent.md`, `INTENT.md`, `proposal.md` |
| Requirements | `requirements.md`, `specs/**`, `features/**`, `*.feature` |
| Design | `design.md`, `architecture.md`, `adr/**` |
| Tasks | `tasks.md`, `TODO.md` |
| Stories | `stories/**` (excludes `stories/archive/**`) |
| RCA | `rca/**` (excludes `rca/archive/**`) |
| Dependencies | `package.json`, `go.mod`, `requirements.txt`, `Cargo.toml`, `pom.xml` |
| Code | `src/**`, `lib/**`, `cmd/**`, `*.go`, `*.ts`, `*.py`, `*.js` |
| Tests | `*.test.*`, `*.spec.*`, `__tests__/**`, `test/**` |

### 9.2 Reconciliation rules

| Changed | Triggers | Reconciliation check |
|---------|----------|---------------------|
| Intent | → Requirements | Requirements reference updated intent; if scope expanded, stories flagged stale |
| Intent | → ADR | New architectural constraints require ADR |
| Stories | → Requirements | New/changed stories require requirement updates |
| Requirements | → Design | Design reviewed for staleness (D-2 re-validated) |
| Requirements | → Tasks | T-4 coverage re-run |
| Design | → ADR | New components or boundary changes trigger ADR detection |
| Dependencies | → ADR | New dependencies always trigger ADR check |
| Code | → Stories | Code changes must trace to open story or hotfix RCA |
| Code | → Tests | Code without test changes triggers E-1/E-2 re-check |
| Code | → CC metrics | CC and cognitive complexity re-analyzed; deltas computed |
| Assumptions invalidated | → Supersession | Replacement artifact must be created; downstream flagged stale |
| Tests fail | → RCA | Previously passing scenario failures trigger RCA requirement |
| RCA created | → Requirements | Requirement flagged stale until updated |

---

## 10. Storage Architecture

### 10.1 Engine

**DuckDB** for querying. **Parquet** for storage. All data lives on the local filesystem.
No database server. No daemon. DuckDB reads Parquet files directly via glob patterns.

### 10.2 File naming convention

```
{root}/{org}/{repo}/{service}/{YYYY}/{MM}/{DD}/{commit8}_{branch}_{llm}_{check-type}_{HHMMSSmmm}.parquet
```

| Component | Source | Rules |
|-----------|--------|-------|
| `{root}` | Config | Default: `~/.spec-check/data` |
| `{org}` | Git remote URL | Extracted from remote (e.g. `github.com/xcape-inc/repo` → `xcape-inc`). Falls back to `local` |
| `{repo}` | Git remote or directory name | Lowercased, sanitized |
| `{service}` | Monorepo config or auto-detect | `root` for flat repos and whole-repo checks. Named service for monorepo services |
| `{YYYY}/{MM}/{DD}` | Run timestamp (UTC) | Zero-padded. Enables date-range glob pruning |
| `{commit8}` | `git rev-parse --short=8 HEAD` | 8 hex chars. `no-commit` if no git repo |
| `{branch}` | `git branch --show-current` | `/` → `__`, spaces → `-`, truncated to 40 chars. `detached` in detached HEAD |
| `{llm}` | Tool argument → env var → config → `unknown` | Lowercase, `.` → `-`. See table below |
| `{check-type}` | Tool invoked | See table below |
| `{HHMMSSmmm}` | Run timestamp (UTC) | Ensures uniqueness within a day |

**LLM identifier values:**

| Caller | `{llm}` |
|--------|---------|
| Claude Sonnet 4.5 | `claude-sonnet-4-5` |
| Claude Opus 4 | `claude-opus-4` |
| Claude Haiku 3.5 | `claude-haiku-3-5` |
| GPT-4o | `gpt-4o` |
| GPT-4o mini | `gpt-4o-mini` |
| Gemini 2.0 Flash | `gemini-2-0-flash` |
| Human | `human` |
| CI pipeline | `ci` |
| Unidentified | `unknown` |

**Check type values:**

| Value | Produced by |
|-------|-------------|
| `gate-all` | `run_all` |
| `gate-G1` … `gate-G5` | Individual gate tools |
| `gate-story`, `gate-adr`, `gate-rca` | Artifact validators |
| `complexity` | `check_complexity` |
| `mutation` | `check_mutation_score` |
| `diff` | `check_diff` |
| `deps` | `check_dependencies` |
| `supersession` | Assumption invalidation events |

### 10.3 Example tree

```
~/.spec-check/data/
├── xcape-inc/
│   ├── microshift-deployer/
│   │   ├── root/
│   │   │   └── 2026/04/03/
│   │   │       └── a3f9b2c1_main_claude-sonnet-4-5_diff_142300000.parquet
│   │   ├── renderer/
│   │   │   └── 2026/04/03/
│   │   │       ├── a3f9b2c1_main_claude-sonnet-4-5_gate-all_142301000.parquet
│   │   │       └── a3f9b2c1_main_claude-sonnet-4-5_complexity_142301050.parquet
│   │   └── main-process/
│   │       └── 2026/04/03/
│   │           ├── a3f9b2c1_main_claude-sonnet-4-5_gate-all_142301100.parquet
│   │           └── a3f9b2c1_main_human_gate-G1_160000000.parquet
│   └── cstirs-c2/
│       └── root/
│           └── 2026/04/03/
│               └── c9e3f5a2_main_claude-sonnet-4-5_gate-all_150000000.parquet
└── local/
    └── spec-check/
        └── root/
            └── 2026/04/03/
                └── d0f4g6b3_main_claude-sonnet-4-5_gate-all_160000000.parquet
```

### 10.4 LLM identity resolution

```
1. Tool argument:    { "llm": "claude-sonnet-4-5" }
2. Environment var:  SPEC_CHECK_LLM=claude-sonnet-4-5
3. Global config:    { "default_llm": "claude-sonnet-4-5" }
4. Fallback:         "unknown"
```

`unknown` is stored and queryable — attribution gaps are visible, never silently dropped.

Parquet columns carry full detail:
```
llm_provider:  "anthropic" | "openai" | "google" | "human" | "ci" | "unknown"
llm_model:     "claude-sonnet-4-5"
llm_id:        "claude-sonnet-4-5"
```

### 10.5 Monorepo strategy

**Global config — default behavior:**

```json
{
  "monorepo": {
    "strategy": "auto",
    "auto_detect": {
      "manifests": ["package.json", "go.mod", "requirements.txt", "Cargo.toml", "pom.xml"],
      "depth": 2,
      "workspaces": true
    },
    "fallback": "root"
  }
}
```

| Strategy | Behaviour |
|----------|-----------|
| `auto` | Scan for language manifests at depth 1–2. If found at subdirectory level, treat as monorepo and derive service names from directory names. Also reads `workspaces` from root `package.json`. Falls back to `root` if none found. |
| `flat` | Always `root`. No detection. |
| `explicit` | Require local config. Fall back to `root` silently if absent. |

**Local config — project-level override (`spec-check.config.json`):**

```json
{
  "monorepo": {
    "strategy": "services",
    "services": [
      { "name": "renderer",     "path": "src/renderer", "spec_path": "src/renderer/specs" },
      { "name": "main-process", "path": "src/main",     "spec_path": "specs" }
    ],
    "root_checks": ["diff", "deps", "gate-adr", "gate-rca"]
  }
}
```

`root_checks` declares which check types run at the repo level regardless of service
configuration. Diff, dependency, ADR, and RCA checks always span the whole repo.

**Auto-detection logic:**
```
1. root package.json has "workspaces": [...]  → use workspace paths as service names
2. package.json / go.mod / requirements.txt at depth 1–2 (not root) → use directory names
3. packages/ or apps/ or services/ at root  → use immediate subdirectory names
4. None of the above → service = "root"
```

### 10.6 Glob query examples

```sql
-- Everything for one org
read_parquet('data/xcape-inc/**/*.parquet')

-- One repo, all services, all time
read_parquet('data/xcape-inc/microshift-deployer/**/*.parquet')

-- Complexity only, across all projects
read_parquet('data/**/*_complexity_*.parquet')

-- All Claude runs, any model version
read_parquet('data/**/*_claude-*_*_*.parquet')

-- Compare Claude vs GPT-4o gate compliance, same repo
read_parquet('data/xcape-inc/microshift-deployer/**/*_main_claude-sonnet-4-5_gate-all_*.parquet')
read_parquet('data/xcape-inc/microshift-deployer/**/*_main_gpt-4o_gate-all_*.parquet')

-- All gate runs on main branch across all orgs
read_parquet('data/**/*_main_*_gate-all_*.parquet')

-- Exclude a repo from org rollup
read_parquet('data/xcape-inc/{microshift-deployer,cstirs,cstirs-c2}/**/*.parquet')

-- Supersession events across all projects
read_parquet('data/**/*_supersession_*.parquet')

-- Which models have the highest Gate 2 pass rate?
SELECT llm_model,
       AVG(CASE WHEN gate_status='pass' THEN 1.0 ELSE 0.0 END) AS pass_rate,
       COUNT(*) AS runs
FROM read_parquet('data/**/*_gate-G2_*.parquet')
GROUP BY llm_model
ORDER BY pass_rate DESC

-- Assumption invalidation rate per model
SELECT llm_model,
       COUNT(*) AS total_supersessions,
       COUNT(DISTINCT original_artifact) AS artifacts_superseded
FROM read_parquet('data/**/*_supersession_*.parquet')
GROUP BY llm_model
ORDER BY total_supersessions DESC
```

---

## 11. Metrics

### 11.1 Record schema (stored per Parquet file)

**Gate check record:**
```
project_path, project_name, org, repo, service
timestamp (ISO8601), git_commit (full), git_commit_short, branch
llm_provider, llm_model, llm_id
gate, triggered_by, gate_status, duration_ms
results: [{ criterion_id, status, detail, evidence[] }]
```

**Complexity record (one row per function):**
```
file, function, signature
cc, cc_delta, cognitive, cognitive_delta
length, length_delta, nesting, nesting_delta, param_count
spec_scenario_count, spec_coverage_gap
```

**Mutation record:**
```
score, killed, survived, timeout, total, score_delta
incremental, tool_used
```

**Supersession record:**
```
original_artifact, replacement_artifact, artifact_type
assumption_id, assumption_text, assumption_basis
invalidated_by, days_to_invalidation
llm_model (of original author)
```

### 11.2 Per-project metrics

`get_project_metrics(path, since?)`:

- Gate pass rates over time (per gate, per day/week)
- Most frequent violations by criterion ID
- Spec coverage: % of features with complete specs
- Drift rate: code changes without spec changes
- CC and cognitive complexity trends with deltas
- Mutation score trend
- Spec-complexity ratio: average CC vs scenario count gap
- Assumption invalidation rate: assumptions marked invalid / total assumptions made
- Supersession rate: artifacts superseded / artifacts created
- Supersessions by artifact type (story / intent / RCA)
- Average days from artifact creation to supersession
- Most common assumption categories invalidated (NLP-classified)
- RCA count and average resolution time
- Story cycle time

### 11.3 Cross-project rollup

`get_rollup(since?)`:

- Per-project compliance scores ranked
- Models ranked by Gate pass rate
- Models ranked by assumption accuracy (`1 - invalidation_rate`)
- Models ranked by CC trend (are they producing simpler or more complex code over time)
- Projects with highest supersession rates (signal of under-specified requirements)
- Most frequently invalidated assumption categories across all projects
- Projects with most unresolved RCAs

### 11.4 Compliance score

```
score = (G1 * 0.15) + (G2 * 0.30) + (G3 * 0.20) + (G4 * 0.15) + (G5 * 0.20)
```

Weights configurable.

---

## 12. Visualization

### 12.1 Output formats

| Format | Use case |
|--------|----------|
| Plain text (ASCII) | Terminal, chat interface, LLM consumption |
| Mermaid | Markdown-rendered environments |
| JSON | External tooling, further processing |

### 12.2 Available views

| View | Tool |
|------|------|
| Full compliance report | `run_all` |
| Gate timeline | `get_project_metrics` |
| Violation frequency chart | `get_violation_trends` |
| Cross-project ranking | `get_rollup` |
| Model comparison | `get_rollup` with `format: model_comparison` |
| CC heatmap with deltas | `check_complexity` |
| Complexity trend | `get_complexity_metrics` |
| Mutation score trend | `get_mutation_trends` |
| Spec-complexity gap | `check_spec_coverage_ratio` |
| Assumption invalidation board | `get_assumption_metrics` |
| Supersession history | `get_supersession_history` |
| Dependency status | `check_dependencies` |
| Story lifecycle | `get_story_status` |
| RCA status board | `get_rca_status` |
| ADR log | `get_adr_log` |
| Traceability graph | `get_traceability` |

---

## 13. MCP Tool Specification

### 13.1 Self-description

The first tool any LLM should call when connecting to spec-check for the first time.
Returns the complete enforcement protocol in LLM-optimized form: every gate, every
criterion with its ID and severity, every artifact contract, the assumption protocol,
the supersession flow, and guidance on which tools to call at which point in the workflow.
This ensures any LLM — regardless of training data — can follow the methodology correctly
using the tool as the single source of truth for its own protocol.

| Tool | Description |
|------|-------------|
| `get_protocol` | Returns the complete spec-driven methodology enforcement specification. Includes all gates, criteria (with IDs, severity, and tunability), artifact contracts, assumption documentation format, supersession protocol, and tool-call guidance for each workflow stage. Accepts `format: text \| json \| markdown`. |

**`get_protocol` returns (structured):**
1. Workflow overview — the 5-gate sequence with one-line descriptions
2. Gate criteria — all criteria grouped by gate, with ID, check method, severity, tunability
3. Artifact contracts — required sections for each artifact type
4. Assumption protocol — the format, the invalidation flow, what triggers supersession
5. Tool call guidance — which tool to call at each workflow stage and why
6. Current thresholds — the active configuration for all tunable checks

### 13.2 Gate enforcement

| Tool | Description |
|------|-------------|
| `run_all` | Run all gate checks and return full pass/warn/fail report |
| `check_gate(gate, path)` | Run a specific gate (G1–G5, S, A, RC) |
| `check_diff(path)` | Analyze current git diff and apply reconciliation rules |
| `check_intent` | Run Gate 1 only |
| `check_requirements` | Run Gate 2 only |
| `check_design` | Run Gate 3 only |
| `check_tasks` | Run Gate 4 only |
| `check_executability` | Run Gate 5 only |
| `check_story(story_id, path)` | Validate a specific story |
| `check_adr(adr_id, path)` | Validate a specific ADR |
| `check_rca(rca_id, path)` | Validate a specific RCA |
| `check_assumptions(artifact_path)` | Validate the `## Assumptions` section of any artifact |

### 13.3 Supersession

| Tool | Description |
|------|-------------|
| `invalidate_assumption(artifact_path, assumption_id, reason)` | Marks an assumption invalid, moves original to archive, scaffolds the replacement artifact with `## Supersedes` header pre-filled, and records the supersession event in Parquet |
| `get_supersession_history(path, since?)` | All supersession events for a project with reason, model attribution, and days-to-invalidation |

### 13.4 Code quality

| Tool | Description |
|------|-------------|
| `check_complexity(path, threshold?)` | CC + cognitive + nesting + length analysis with deltas |
| `check_spec_coverage_ratio(path)` | CC vs spec scenario count — surfaces the gap per function |
| `check_mutation_score(path, threshold?)` | Run mutation testing, return score. Incremental if supported |
| `get_complexity_metrics(path, since?)` | Historical complexity trends with delta series |
| `get_mutation_trends(path, since?)` | Historical mutation scores with trend direction |

### 13.5 Dependency management

| Tool | Description |
|------|-------------|
| `check_dependencies(path?)` | Report installed/missing tools, metrics they provide, install commands |
| `install_dependency(name, path?)` | Install with structured failure analysis. Returns `InstallFailure` on error |

### 13.6 Metrics

| Tool | Description |
|------|-------------|
| `get_project_metrics(path, since?)` | Per-project compliance metrics and trends |
| `get_rollup(since?)` | Cross-project rollup with model comparison |
| `get_violation_trends(path, since?)` | Violation frequency over time |
| `get_assumption_metrics(path, since?)` | Invalidation rate, assumption accuracy, categories |
| `get_story_status(path)` | Stories with gate status and open tasks |
| `get_rca_status(path)` | Open and resolved RCAs |
| `get_adr_log(path)` | ADR history and status |
| `get_traceability(path)` | Traceability graph from stories to tests |
| `get_compliance_score(path)` | Current weighted compliance score |

### 13.7 Common input schema

All tools accept:
```json
{
  "path":   "string (optional, defaults to cwd)",
  "format": "text | json | mermaid (optional, defaults to text)",
  "llm":    "string (optional, identifies the calling model)"
}
```

---

## 14. Configuration

```json
{
  "default_llm": "unknown",
  "thresholds": {
    "I-2": 0.7, "I-3": 0.6, "I-4": 0.7, "I-5": 0.5,
    "R-3": 0.8, "R-5": 0.7, "R-7": 0.8, "R-8": 0.8, "R-9": 0.7, "R-10": 0.5,
    "D-3": 0.7, "D-4": 0.6,
    "T-2": 0.8, "T-3": 0.7, "T-4": 0.6,
    "E-2": 0.7,
    "AS-3": 0.8,
    "CC-1": 10, "CC-2": 10, "CC-3": 5, "CC-4": 4, "CC-5": 5,
    "MT-1": 80, "MT-2": 90, "MT-4": 10
  },
  "compliance_weights": {
    "G1": 0.15, "G2": 0.30, "G3": 0.20, "G4": 0.15, "G5": 0.20
  },
  "metrics": {
    "db_path": "~/.spec-check/data",
    "retention_days": 365
  },
  "monorepo": {
    "strategy": "auto",
    "auto_detect": { "manifests": ["package.json","go.mod","requirements.txt","Cargo.toml","pom.xml"], "depth": 2, "workspaces": true },
    "fallback": "root"
  },
  "adr_triggers": {
    "enabled": true,
    "dependency_change": true,
    "infrastructure_keywords": true,
    "constraint_keywords": true
  },
  "mutation": {
    "enabled": true,
    "incremental": true,
    "triggers": {
      "default": "pre_merge",
      "available": ["pre_merge","nightly","weekly","on_demand","pre_commit"],
      "scheduled": { "enabled": false, "cron": "0 2 * * 1" }
    }
  }
}
```

---

## 15. Non-Functional Requirements

| Requirement | Specification |
|-------------|--------------|
| Latency | `run_all` < 2s. `check_complexity` < 5s. Mutation testing excluded |
| Storage | ≤ 50 MB for 1 year of daily runs across 20 projects |
| Portability | macOS, Linux, Windows (Node.js ≥ 18) |
| No analysis network | Zero outbound calls during analysis |
| Idempotent | Same input → identical output for static checks |
| Graceful | Missing artifacts, missing tools, and install failures produce structured output — never unhandled errors |
| Transparent | Every unavailable metric states precisely why and what would enable it |
| Self-describing | `get_protocol` always returns the current enforcement spec. No LLM needs external documentation to follow the methodology |

---

## 16. Out of Scope (v1)

- Automatic spec generation
- IDE plugin
- Full CI/CD pipeline integration (pre-commit hooks in scope)
- Web UI dashboard
- Real-time file watching
- Multi-language semantic analysis beyond rule-based NLP
- SonarQube integration

---

## 17. Open Questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Should `check_diff` require clean working tree or allow unstaged changes? | TBD |
| 2 | T-3/E-2 semantic matching: keyword TF-IDF or exact match only as default? | TBD |
| 3 | Compliance scores per-branch or per-commit? | TBD |
| 4 | Projects with no git history: how to handle diff checks? | TBD |
| 5 | Stryker: generate default config if absent, or require one? | TBD |
| 6 | Mutation testing for monorepos: score per service or aggregate? | TBD |
| 7 | `get_protocol` versioning: how does an LLM detect protocol changes between sessions? | TBD |

---

## 18. Next Steps

1. **Stories** — one story per major feature area before any implementation
2. **ADR-001** — DuckDB + Parquet vs alternative storage
3. **ADR-002** — Rule-based NLP vs local embedding model
4. **ADR-003** — Bundled AST walkers vs lizard-first
5. **ADR-004** — Mutation testing execution model
6. **ADR-005** — `get_protocol` format and versioning strategy
7. **Implementation** — gate-enforced, story-driven, tool verifying itself
