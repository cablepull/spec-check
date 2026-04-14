# RCA-009: runMutation Cyclomatic Complexity Violation

## Summary

`runMutation` in `src/mutation.ts` had cyclomatic complexity CC=22, far exceeding
the CC-1 threshold of 10. It was the second-largest CC offender after
`getProjectMetrics` (resolved in RCA-007).

## Root Cause

`runMutation` was a monolithic orchestrator handling all mutation criteria inline:
project score (MT-1), critical function coverage (MT-2), decline trend (MT-3),
high-CC survivor detection (MT-4), and duration (MT-DUR). Each criterion check
contained its own `if/else` branches, boolean operators (`&&`, `||`), and ternary
expressions that accumulated in a single function scope.

Same root cause as RCA-007: no intermediate abstraction boundary, so complexity
compounded until the function crossed the threshold by a factor of two.

## Violated Requirement

R-28 — No function may exceed the cyclomatic complexity threshold (CC-1 = 10).

## Resolution

Extracted six private helper functions from `runMutation`:

- `languageBlockDetail(language)` — ternary for mixed/unknown detail message
- `checkMT1ProjectScore(raw, config)` — project score vs threshold
- `checkMT2CriticalFunctions(functions, config)` — spec-critical function coverage
- `checkMT3Trend(raw, service, config)` — consecutive decline detection
- `checkMT4HighCcSurvivors(functions, config)` — high-CC survivor detection
- `checkMTDuration(start)` — duration threshold (returns null if within limit)

`runMutation` now delegates to these helpers; its CC dropped from 22 to 10.
No logic was changed. All 176 tests pass.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- Each criterion helper returns a `CriterionResult` value (MT-1 through MT-4) or
  `CriterionResult | null` (MT-DUR). Callers push only non-null results.
- The helpers are private — they are implementation details of the mutation
  orchestration, not part of the public API.
