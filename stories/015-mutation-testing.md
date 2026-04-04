# Story 015: Mutation Testing

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Code coverage tells you what ran. Mutation score tells you whether the tests would
catch a regression. For LLM-generated tests specifically, this distinction is critical —
an LLM can produce tests that execute every line while asserting nothing meaningful,
achieving 100% coverage with 0% behavioral constraint. Mutation testing seeds small
faults in the source and measures whether the test suite kills them. This story integrates
mutation testing into spec-check: not as a blocking gate (it is too slow for that), but
as a tracked metric that trends over time and surfaces as a WARNING when the score falls
below threshold or declines across runs. Spec-critical functions — those matching a Rule
or Example by name — are held to a higher threshold than the project average.

## Acceptance Criteria

**`check_mutation_score`:**
- [ ] Detects the project language(s) and routes to the appropriate mutation tool (Stryker for TS/JS, mutmut for Python, go-mutesting for Go, Pitest for Java)
- [ ] When the mutation tool is not installed, returns a structured `DEPENDENCY_MISSING` result with install guidance (via Story 014 flow)
- [ ] Runs in incremental mode when the tool supports it (`--incremental` for Stryker) to limit run time
- [ ] When `path` is a specific file or directory, runs mutation only on that scope
- [ ] **MT-1** (WARNING, tunable): Returns `WARNING` when project-level mutation score is below threshold (default 80%); reports score, threshold, and gap
- [ ] **MT-2** (VIOLATION, tunable): Returns `VIOLATION` when mutation score for spec-critical functions is below threshold (default 90%); lists each spec-critical function, its score, and the surviving mutants
- [ ] **MT-3** (WARNING): Returns `WARNING` when mutation score has declined across ≥2 consecutive prior runs; reports score trend with values
- [ ] **MT-4** (VIOLATION, tunable): Returns `VIOLATION` when any surviving mutants exist in functions with CC > threshold; names the function, its CC, and the surviving mutant descriptions
- [ ] Spec-critical functions identified by: exact name match to a Rule or Example keyword sequence, then NLP similarity above threshold
- [ ] Returns: total mutants, killed, survived, timeout, score percentage, incremental flag, tool used, and duration
- [ ] Duration is always reported; warns if run took > 5 minutes
- [ ] Metrics written to Parquet after every run (check-type: `mutation`)

**Trigger configuration:**
- [ ] Respects `mutation.triggers.default` from config (`pre_merge` by default)
- [ ] `on_demand` trigger always runs when `check_mutation_score` is called directly
- [ ] `pre_merge` trigger: tool returns a note if called outside a merge context rather than refusing to run
- [ ] `pre_commit` trigger: tool returns a WARNING that this trigger is not recommended for large codebases
- [ ] Scheduled triggers (`nightly`, `weekly`) are managed by Story 021 (configuration) and executed externally; this story only handles on-demand and context-aware invocation

## ADR Required

Yes — **ADR-004**: Mutation testing execution model. Decisions needed on blocking vs
background vs scheduled, and how `pre_merge` context is detected (git hooks, CI env
vars, or explicit flag).

## Requirements

- PRD Section 6.4 (mutation testing criteria MT-1 through MT-4)
- PRD Section 7.3 (mutation testing tools per language)
- PRD Section 13.4 (`check_mutation_score` tool)
- PRD Section 11.1 (mutation Parquet record schema)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | `pre_merge` context is detected by checking for the presence of a CI environment variable (`CI=true`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.) or a git hook context (`GIT_MERGE_HEAD`) | No universal "pre-merge" signal exists; env var detection covers the most common cases | `assumed` |
| A-002 | Stryker requires a `stryker.config.js` or `stryker.config.json` at the project root; if absent, `check_mutation_score` generates a minimal default config and notes it was auto-generated | Stryker requires config; auto-generation avoids blocking the first run | `assumed` |
| A-003 | Mutation testing runs synchronously; the MCP client is expected to wait; the tool does not fork a background process | MCP protocol is request-response; background processes would require polling which is not in scope for v1 | `assumed` |
| A-004 | `go-mutesting` does not support incremental mode; the entire package is mutated on every run; this is noted in the result | go-mutesting documentation confirms no incremental support as of current version | `assumed` |
| A-005 | Pitest (Java) integration is deferred to a post-v1 story; the dependency registry entry exists but `check_mutation_score` returns `UNSUPPORTED_LANGUAGE` for Java in v1 | Pitest requires Maven or Gradle integration; this is a significant additional scope | `assumed` |
