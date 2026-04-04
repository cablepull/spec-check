# Requirements

## Feature F-1: MCP Server Foundation

### Rule R-1: Validate The server starts and responds to protocol messages reliably
Example: Server starts with no arguments
  Given the server is invoked with `node dist/index.js`
  When the process starts
  Then it remains running and accepts MCP messages on stdio

Example: Unknown tool name returns structured error
  Given the server is running
  When a `tools/call` request names a tool that does not exist
  Then a structured error is returned with the unknown tool name
  And no unhandled exception is thrown

### Rule R-2: Validate LLM identity is resolved from available context
Example: Identity from tool argument
  Given a tool call includes `"llm": "claude-sonnet-4-5"`
  When the tool executes
  Then `claude-sonnet-4-5` is attached to the response metadata

Example: Identity falls back to unknown
  Given no `llm` argument, no `SPEC_CHECK_LLM` env var, and no global config value
  When any tool executes
  Then `unknown` is attached to the response metadata and stored in Parquet

---

## Feature F-2: Self-Description (get_protocol)

### Rule R-3: Validate The tool is always the source of truth for its own enforcement protocol
Example: LLM retrieves the full protocol at session start
  Given the server is running
  When `get_protocol` is called with no arguments
  Then the response contains all five gates with criteria IDs, severities, and tunable flags
  And all artifact contracts with required sections are listed
  And the assumption table format with an example is included
  And the supersession flow is described as a numbered sequence
  And tool-call guidance is provided for each workflow stage

Example: Protocol includes version and timestamp
  Given the server is running
  When `get_protocol` is called
  Then the response includes a `protocol_version` integer
  And a `generated_at` UTC timestamp

Example: Protocol returns active thresholds for the current project
  Given a project at `path` with `spec-check.config.json` overriding `R-3: 0.9`
  When `get_protocol` is called with `path`
  Then the response shows `R-3: 0.9` labelled as `project` override
  And all other thresholds are shown with their source (`default` or `global`)

Example: Unsupported protocol format is rejected
  Given the server is running
  When `get_protocol` is called with `format: "yaml"`
  Then a structured format error is returned
  And no partial protocol response is emitted

---

## Feature F-3: Gate 1 — Intent Validation

### Rule R-4: Validate An intent document must exist before the workflow proceeds
Example: No intent document found
  Given a project root with no `intent.md`, `INTENT.md`, `proposal.md`, or `WHY.md`
  When `check_intent` is called
  Then the result status is `BLOCK`
  And the response lists the exact filenames it searched for

Example: Intent document exists and passes all checks
  Given an `intent.md` with causal language, a constraint, problem before solution, and ≥50 words
  When `check_intent` is called
  Then the result status is `PASS`

### Rule R-5: Validate Intent must articulate why, not just what
Example: No causal language present
  Given an `intent.md` that describes features without using causal language
  When `check_intent` is called
  Then criterion `I-2` returns `VIOLATION`
  And the response lists the causal signal words that were absent

Example: Solution described before problem
  Given an `intent.md` whose first paragraph describes the solution
  When `check_intent` is called
  Then criterion `I-4` returns `VIOLATION`

### Rule R-6: Validate Implementation details must not appear in intent
Example: Concrete technology names detected
  Given an `intent.md` containing a UI framework name, an orchestration platform name, or a database engine name
  When `check_intent` is called
  Then criterion `I-5` returns `WARNING`
  And the detected terms are named in the response

---

## Feature F-4: Gate 2 — Requirements Validation

### Rule R-7: Validate Every Feature must have at least one Rule
Example: Feature with no rules
  Given a requirements file with a `Feature:` heading but no `Rule:` entries beneath it
  When `check_requirements` is called
  Then criterion `R-2` returns `VIOLATION` for that Feature

### Rule R-8: Validate Every Rule must have both a positive and a negative example
Example: Rule with only happy-path example
  Given a Rule with one Example that has no error or rejection language
  When `check_requirements` is called
  Then criterion `R-5` returns `VIOLATION` for that Rule
  And the response notes that no negative/error example was found

Example: Rule with both positive and negative examples
  Given a Rule with one Example showing successful outcome and one showing rejection
  When `check_requirements` is called
  Then criteria `R-4` and `R-5` both pass for that Rule

### Rule R-9: Validate Each Example must have exactly one WHEN step
Example: Example with two WHEN steps
  Given an Example containing `When Jane submits the form` and `When the system validates`
  When `check_requirements` is called
  Then criterion `R-6` returns `BLOCK` for that Example

### Rule R-10: Validate GIVEN steps must describe state, not actions
Example: Action verb in GIVEN
  Given a GIVEN step reading `Given the user clicks the login button`
  When `check_requirements` is called
  Then criterion `R-7` returns `VIOLATION`
  And `clicks` is identified as the offending action verb

### Rule R-11: Validate WHEN must describe one actor performing one action
Example: Compound WHEN
  Given a WHEN step reading `When Jane submits the form and the system sends an email`
  When `check_requirements` is called
  Then criterion `R-8` returns `VIOLATION`
  And the compound junction is identified

### Rule R-12: Validate THEN steps must be externally observable
Example: Internal state in THEN
  Given a THEN step reading `Then the database contains a new user record`
  When `check_requirements` is called
  Then criterion `R-9` returns `VIOLATION`

---

## Feature F-5: Gate 3 — Design Validation

### Rule R-13: Validate A design document must exist before tasks are written
Example: No design document found
  Given a project with no `design.md`, `architecture.md`, or `adr/` directory
  When `check_design` is called
  Then the result status is `BLOCK`

### Rule R-14: Validate The design must reference requirements it addresses
Example: Design with no requirement references
  Given a `design.md` that describes components but mentions no Feature names or Rule IDs
  When `check_design` is called
  Then criterion `D-2` returns `VIOLATION`

### Rule R-15: Validate The design must not contradict requirements
Example: Probable contradiction detected
  Given a Rule stating `Valid emails are accepted` and a design statement containing `email validation is not performed`
  When `check_design` is called
  Then criterion `D-4` returns `WARNING` with the two conflicting texts shown side by side
  And the result notes that contradiction detection is probabilistic and requires human review

---

## Feature F-6: Gate 4 — Tasks Validation

### Rule R-16: Validate Tasks must be atomic
Example: Compound task
  Given a `tasks.md` containing `- [ ] Create the service and write the tests`
  When `check_tasks` is called
  Then criterion `T-2` returns `VIOLATION`
  And `and write the tests` is identified as the compound junction

### Rule R-17: Validate Each task must trace to a requirement
Example: Task with no traceable link
  Given a task `- [ ] Refactor the login module` with no keyword matching any Rule or Feature name
  When `check_tasks` is called
  Then criterion `T-3` returns `VIOLATION` for that task
  And the traceability coverage percentage is reported

---

## Feature F-7: Gate 5 — Executability

### Rule R-18: Validate Test files must exist
Example: No test files found
  Given a project with no files matching test file patterns
  When `check_executability` is called
  Then criterion `E-1` returns `BLOCK`

### Rule R-19: Validate Each Rule must have a corresponding test
Example: Rule with no matching test
  Given a Rule named `Valid sign-ups create a new membership` with no test description matching those keywords
  When `check_executability` is called
  Then criterion `E-2` returns `VIOLATION` for that Rule
  And the overall Rule coverage percentage is reported

---

## Feature F-8: Artifact Validation (Stories, ADRs, RCAs)

### Rule R-20: Validate Stories must have all required sections
Example: Story missing Acceptance Criteria section
  Given a story file with `## Intent` but no `## Acceptance Criteria`
  When `check_story` is called
  Then criterion `S-2` returns `VIOLATION`

### Rule R-21: Validate ADR status must be a valid value
Example: Invalid ADR status
  Given an ADR with `## Status: In Progress`
  When `check_adr` is called
  Then criterion `A-2` returns `VIOLATION`
  And the valid values are listed in the response

### Rule R-22: Validate RCAs must link to a violated requirement
Example: RCA with no requirement link
  Given an RCA whose `## Violated Requirement` section contains only prose with no link or ID reference
  When `check_rca` is called
  Then criterion `RC-2` returns `VIOLATION`

---

## Feature F-9: Assumption Tracking

### Rule R-23: Validate LLM-authored artifacts must declare all assumptions explicitly
Example: Story with no Assumptions section
  Given a story file that has no `## Assumptions` section
  When `check_assumptions` is called
  Then criterion `AS-1` returns `VIOLATION`

Example: Story with a valid empty Assumptions declaration
  Given a story file with `## Assumptions` containing "None — all decisions explicitly specified by the user."
  When `check_assumptions` is called
  Then criterion `AS-1` passes

### Rule R-24: Validate Assumptions must not be stated as facts
Example: Assumption phrased as certainty
  Given an assumption row with text `The system will use OAuth2 for authentication`
  When `check_assumptions` is called
  Then criterion `AS-3` returns `VIOLATION`
  And `will` is identified as the certainty signal

### Rule R-25: Validate An invalidated assumption must produce a superseding artifact
Example: Assumption marked invalid with no replacement artifact
  Given an assumption with status `invalidated` in a story file
  And no corresponding new version of that story exists
  When `check_assumptions` is called
  Then criterion `AS-4` returns `BLOCK`

---

## Feature F-10: Diff-Based Change Detection

### Rule R-26: Validate Code changes must trace to a story or RCA
Example: Code changed with no story in diff
  Given a git diff showing changes to `src/auth.ts`
  And no changes to any file in `stories/` in the same diff
  And the commit message contains no hotfix marker
  When `check_diff` is called
  Then a `VIOLATION` is returned listing the untraceable code files

### Rule R-27: Validate New dependencies must have a corresponding ADR
Example: Dependency added with no ADR in diff
  Given a git diff showing a new entry in `package.json` dependencies
  And no changes to any file in `adr/` in the same diff
  When `check_diff` is called
  Then a `VIOLATION` is returned naming the new dependency and the missing ADR

---

## Feature F-11: Code Complexity Analysis

### Rule R-28: Validate No function may exceed the cyclomatic complexity threshold
Example: Function exceeds CC threshold
  Given a TypeScript function `processPayment` with a cyclomatic complexity of 14
  And the CC-1 threshold is configured at 10
  When `check_complexity` is called
  Then criterion `CC-1` returns `VIOLATION` for `processPayment`
  And the file, line number, and CC value are reported

### Rule R-29: Validate High-complexity functions must have sufficient spec scenario coverage
Example: High-CC function with insufficient scenarios
  Given a function with CC of 12 and only 3 spec scenarios referencing it
  When `check_complexity` is called
  Then criterion `CC-2` returns `WARNING`
  And the gap (9 missing scenarios) is reported

### Rule R-30: Validate Increasing complexity trends must be surfaced
Example: Function CC increasing across three consecutive runs
  Given `processPayment` had CC of 8, then 10, then 12 across three prior runs
  When `check_complexity` is called on the fourth run
  Then criterion `CC-6` returns `WARNING` with the trend values shown

---

## Feature F-12: Mutation Testing

### Rule R-31: Validate Project mutation score must meet the configured threshold
Example: Mutation score below threshold
  Given a mutation run produces a score of 71%
  And the MT-1 threshold is 80%
  When the mutation-score tool is called
  Then criterion `MT-1` returns `WARNING`
  And the score, threshold, and gap are reported

### Rule R-32: Validate Spec-critical functions must meet a higher mutation threshold
Example: Spec-critical function with surviving mutants
  Given a function named `validateMembership` that matches a Rule keyword
  And its mutation score is 83%
  And the MT-2 threshold is 90%
  When the mutation-score tool is called
  Then criterion `MT-2` returns `VIOLATION` for `validateMembership`
  And the surviving mutants are listed

---

## Feature F-13: Storage and Metrics

### Rule R-33: Validate Every check run must be persisted to a Parquet file
Example: Successful run produces a Parquet file
  Given `run_all` is called on a project at `path`
  When the run completes
  Then a Parquet file is written at the path derived from the naming convention
  And the file contains all columns from the gate check schema

Example: Persistence failure does not block analysis results
  Given the storage root is not writable
  When `run_all` is called
  Then the analysis results are returned to the caller
  And a write failure is logged to stderr
  And no error is returned in the tool response

### Rule R-34: Validate Cross-project metrics must be queryable by glob
Example: All Claude runs across all projects
  Given Parquet files exist for multiple projects and multiple models
  When `get_rollup` is called
  Then compliance scores are computed per project and per model
  And models are ranked by gate pass rate

---

## Feature F-14: Dependency Management

### Rule R-35: Validate Missing analysis tools must be reported with install guidance
Example: lizard not installed
  Given lizard is not present on the system
  When `check_dependencies` is called
  Then lizard is listed as missing
  And the metrics it would enable are listed
  And the install command is shown for each available package manager

### Rule R-36: Validate Installation failures must be categorised with a human explanation
Example: Install fails due to missing runtime
  Given Python is not installed on the system
  When `install_dependency` is called with `name: "lizard"`
  Then the result reason is `RUNTIME_NOT_FOUND`
  And the explanation states that Python must be installed first
  And the raw stderr output is included

---

## Feature F-15: Configuration

### Rule R-37: Validate Project config overrides global config without replacing it
Example: Project threshold overrides global default
  Given global config has `R-3: 0.7` and project config has `R-3: 0.9`
  When `check_requirements` is called on that project
  Then criterion `R-3` uses threshold `0.9`
  And all other thresholds use their global or default values

### Rule R-38: Validate Invalid config returns a structured error without crashing
Example: Invalid JSON in project config
  Given `spec-check.config.json` contains malformed JSON
  When any tool is called with that project path
  Then a `CONFIG_PARSE_ERROR` is returned with the file path and parse error
  And built-in defaults are used for the remainder of the call

---

## Feature F-16: Monorepo Detection and Routing

### Rule R-39: Validate Services are detected automatically for known monorepo structures
Example: Workspace-based monorepo detected
  Given a project root with `package.json` containing `"workspaces": ["packages/auth", "packages/api"]`
  When any tool is called with the project root as `path`
  Then two services are detected: `auth` and `api`
  And each service is analysed separately
  And results include a per-service breakdown

Example: Unknown layout falls back to root service
  Given a project root with no workspaces, no supported subdirectory manifests, and no explicit service config
  When any tool is called with the project root as `path`
  Then one service named `root` is returned
  And the response indicates fallback detection was used

### Rule R-40: Validate Whole-repo checks always run at root level
Example: Diff check runs at root regardless of service config
  Given a monorepo with services `auth` and `api` explicitly configured
  When `check_diff` is called with the project root
  Then the diff check runs once at the repo level
  And the Parquet file is written to the `root/` service path

---

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | Generic technology categories appearing in requirements are detection examples, not implementation choices | Inferred from the tool's purpose; examples are used to clarify what leakage the checker should flag | If the examples are interpreted as commitments, the requirements would incorrectly constrain implementation |
| A2 | The spec-driven hierarchy (Feature → Rule → Example → GWT) is the primary structure to validate | Chosen because specdriven.com defines this as the canonical structure | Tools using different hierarchies would need additional parsers |
| A3 | Gherkin-style Given/When/Then is the only acceptable example format | Defaulted to; user did not specify alternative formats | Free-form examples would require a different parser path |
| A4 | Rule IDs (R-N) and Feature IDs (F-N) will appear in the document text for cross-referencing | Assumed because design and task traceability depend on matching these exact patterns | Cross-reference checks would fail silently if different ID schemes are used |
