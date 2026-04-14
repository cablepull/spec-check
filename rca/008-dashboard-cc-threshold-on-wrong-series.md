# RCA-008: Dashboard CC Trend Chart Applied Threshold to Average Instead of Max

## Summary

The complexity trend chart in `src/dashboard.ts` plotted `avg_cc` (the mean cyclomatic
complexity across all functions in a run, typically 2–3 for this codebase) against a
threshold line labelled "CC≥10 threshold". The CC-1 threshold of 10 applies to
individual functions, not to the average. As a result, the chart always appeared healthy
even when dozens of individual functions violated CC-1, giving a false signal of
compliance.

## Root Cause

`ProjectMetrics.complexity.history` stored only `{ timestamp, avg_cc }` per run —
`max_cc` (the worst function in that run) and `violations` (count of functions above
threshold) were computed inside `computeComplexityMetrics` for the top-level scalar
fields but never carried into the history array. The dashboard chart was therefore
forced to use `avg_cc` as the only available time-series value.

Without per-run `max_cc` in the history, there was no data to correctly pair against
the threshold line. The developer wired the threshold to the only available series
(`avg_cc`), which is a category error: a population average cannot be compared directly
to a per-item threshold.

## Violated Requirement

R-28 — No function may exceed the cyclomatic complexity threshold (CC-1 = 10).

The dashboard is the primary means by which this requirement is monitored over time.
Presenting a misleading chart undermined the observability of R-28 without triggering
any gate failure.

## Resolution

1. Extended `ProjectMetrics.complexity.history` element type to include
   `max_cc: number` and `violations: number`.
2. Added a `CC1_THRESHOLD = 10` constant to `src/metrics.ts`.
3. Updated `computeComplexityMetrics` to populate `max_cc` (already computed, was
   dropped before building the history array) and `violations` (functions with
   `cc > CC1_THRESHOLD`) per run.
4. Added `violation_count: number | null` to the top-level `ProjectMetrics.complexity`
   object for direct access in the dashboard card.
5. Updated the dashboard CC trend chart (`src/dashboard.ts`) to use `max_cc` as the
   primary (amber) series — the only value directly comparable to the threshold — and
   `avg_cc` as a secondary (grey) context series.
6. Updated the CC summary card headline to show `cc_max` (the gate-relevant value)
   with violation count and `cc_average` as context.

No logic changes to how CC is measured or stored in Parquet. All 168 tests pass.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- `avg_cc` is retained in the chart as a secondary series because it provides useful
  context (e.g. understanding whether complexity is concentrated in a few outliers vs.
  broadly distributed), but it must not be compared to the threshold line.
- The `violations` count uses strict `>` against `CC1_THRESHOLD` (i.e. cc ≥ 11) to
  match the spec-check complexity tool's own threshold semantics.
