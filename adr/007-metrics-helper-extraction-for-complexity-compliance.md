# ADR-007: Extract Private Helpers in metrics.ts to Meet CC-1 Threshold

## Status

Accepted

## Context

Relates to: [intent.md](../intent.md)

`getProjectMetrics` (CC=58) and `getRollupMetrics` (CC=39) in `src/metrics.ts` exceeded
the CC-1 threshold of 10 by a large margin, generating the majority of the 38 CC
violations reported by the `complexity` tool. The functions continued to reference the
existing `ServiceInfo` / `buildStoragePaths` / `globPattern` service-layer patterns
already established throughout the codebase.

This refactoring was triggered by the CC-1 violations documented in
[RCA-007](../rca/007-metrics-cyclomatic-complexity-violations.md).

## Decision

Extract private (non-exported) helper functions from both large functions so that each
named function stays below CC=10. The extracted helpers follow the established pattern
of single-responsibility computation: one helper per logical section (row
categorization, gate pass rates, complexity aggregation, etc.).

No new external dependencies, storage paths, or service interfaces are introduced. The
`ServiceInfo` parameter and `buildStoragePaths` call remain in `getProjectMetrics`
exactly as before — the refactoring only reshapes the internal structure, not the
public API or any architectural boundary.

## Alternatives Considered

1. **Inline suppression / threshold increase** — Raise CC-1 to 60. Rejected: this
   would hide genuine complexity risk and set a bad precedent.

2. **Split into separate files** — Move rollup logic to `rollupMetrics.ts`. Rejected
   for now: the shared private helpers (`average`, `trend`, `slope`, etc.) would need
   to be exported or duplicated. The intra-file extraction achieves CC compliance
   without the coupling risk.

3. **No change** — Accept violations. Rejected: CC-1 is a hard gate criterion.

## Consequences

- `getProjectMetrics` and `getRollupMetrics` delegate to named helpers, making the
  orchestration logic readable at a glance.
- All 168 tests continue to pass; no public API change.
- The new helper functions themselves are well below CC=10 and can be tested
  independently if needed in the future.
