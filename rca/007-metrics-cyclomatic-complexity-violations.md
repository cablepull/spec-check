# RCA-007: Excessive Cyclomatic Complexity in getProjectMetrics and getRollupMetrics

## Summary

`getProjectMetrics` in `src/metrics.ts` had cyclomatic complexity CC=58 (cognitive=83,
314 lines) and `getRollupMetrics` had CC=39 (cognitive=66, 298 lines). Both functions
far exceeded the CC-1 threshold of 10. Complexity scanning reported 38 functions over
threshold in a single run — the majority of violations were concentrated in these two
functions.

## Root Cause

Both functions were written as monolithic orchestrators handling every computation
inline: row categorization, per-gate pass rate calculation, complexity history, mutation
history, agent activity aggregation, assumption rate computation, lifecycle measurement,
reconciliation/evidence/diff pass rates, and rollup map construction. Each conditional
branch, loop, and ternary chain incremented the cyclomatic complexity counter with no
offsetting extraction into named sub-functions.

The original design was not wrong per se — all logic is directly related — but the
absence of any intermediate abstraction boundary meant complexity compounded until both
functions crossed the threshold by a large margin.

## Violated Requirement

R-28 — No function may exceed the cyclomatic complexity threshold (CC-1 = 10).
Both `getProjectMetrics` (CC=58) and `getRollupMetrics` (CC=39) violated this rule.

## Resolution

Extracted 11 private helper functions from `getProjectMetrics`:
- `categorizeProjectRows` — row-type dispatch loop
- `computeTopViolations` — violation counting and ranking
- `computeGatePassRates` — per-gate pass rate history
- `computeComplexityMetrics` — complexity record aggregation
- `computeMutationMetrics` — mutation record aggregation
- `computeAgentActivity` — agent gate + state merge
- `computeAssumptionRates` — invalidation and supersession rates
- `computeLifecycle` — story cycle and RCA resolution days
- `computeReconciliationPassRates` — RC-1/RC-2 pass rates
- `computeEvidencePassRates` — EV-1/EV-2 pass rates
- `computeDiffAdrPassRates` — D-ADR-1/2/3 pass rates

Extracted 4 private helper functions from `getRollupMetrics`:
- `categorizeRollupRows` — row-type dispatch loop + violation/assumption counting
- `buildRollupMaps` — all 5 project/model/agent map construction loops
- `buildRollupProjectResults` — project list + 4 ranking arrays
- `buildRollupRankings` — model and agent ranking arrays

Plus 2 type aliases (`RollupProjectEntry`, `AgentGateEntry`) and 2 utility helpers
(`getOrInitProjectEntry`, `rollupProjectKey`) to eliminate repeated initialization
patterns.

No logic was changed. All 168 tests pass.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- The helper functions are private (not exported) — they are implementation details of
  the metrics computation, not part of the public API.
- Splitting the row-categorization loops into separate passes (one per check_type) was
  not chosen because it would require reading `rows` multiple times; the single-pass
  approach is retained inside each categorization helper.
