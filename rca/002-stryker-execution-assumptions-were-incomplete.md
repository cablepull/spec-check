# RCA-002: Stryker Execution Assumptions Were Incomplete

## Summary

The initial `check_mutation_score` implementation for TypeScript/JavaScript assumed that a
repo-local Stryker install plus a generated command-runner config would be sufficient to
produce a usable mutation score. Live verification against this repository showed that the
assumption was incomplete. The real Stryker CLI uses a positional config-file argument rather
than the assumed flag shape, requires a valid test command, and in the current sandboxed
environment attempts to open a local listening socket that is denied. The result was a false
PASS with no score instead of an honest blocked execution result.

## Root Cause

The story and implementation focused on dependency routing and incremental-mode support, but
did not fully verify the operational contract of the real Stryker runtime before treating a
null-score run as a successful mutation pass.

Specifically:

- the CLI integration assumed a config-file flag shape that does not match the real interface
- the generated default command runner assumed `npm test` exists, but this repository has no
  `test` script
- the implementation treated "tool ran but produced no usable score" as a pass condition rather
  than an execution failure that should block or warn explicitly
- the current execution environment adds a socket/listen restriction that Stryker surfaces as
  `listen EPERM`, which also needs structured handling

## Violated Requirement

Story [015](../stories/015-mutation-testing.md), acceptance criteria:

- "When the mutation tool is not installed, returns a structured `DEPENDENCY_MISSING` result with install guidance"
- "Returns: total mutants, killed, survived, timeout, score percentage, incremental flag, tool used, and duration"
- "Duration is always reported; warns if run took > 5 minutes"

The implementation met the missing-dependency contract, but did not yet meet the stronger
honesty requirement for execution failures after the tool was installed.

## Resolution

- Verified the real Stryker CLI help and corrected the config-file invocation model.
- Added detection for missing test-command configuration in `package.json`.
- Changed mutation execution handling so a run that exits without a valid report is treated as
  a blocked execution result instead of a silent pass.
- Added explicit handling for environment-level execution restrictions such as socket/listen
  denial.
- Kept the dependency model unchanged: Stryker remains the correct Tier 1 mutation tool for
  TypeScript/JavaScript, but `spec-check` must own the adapter and failure-classification layer.

## Spec Update Required

Yes

## ADR Required

No

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Story 015 should explicitly distinguish dependency absence from post-install execution failure | The live run showed those are materially different operator states with different fixes | `assumed` |
| A-002 | A project without a working test command cannot produce a meaningful mutation score and should return a blocked result | Mutation testing without runnable tests is operationally invalid, not merely low quality | `assumed` |
| A-003 | Environment restrictions such as socket/listen denial should be surfaced as execution-environment failures, not misattributed to project quality | The Stryker `listen EPERM` failure comes from the runtime environment rather than source/test behavior | `assumed` |
