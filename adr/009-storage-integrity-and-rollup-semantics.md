# ADR-009: Storage Integrity and Rollup Semantics

## Status

Accepted

## Context

Triggering story: [Story 034](../stories/034-storage-and-rollup-integrity-hardening.md)

The multi-project daemon and shared MCP runtime increase concurrent access to local
storage and make cross-project metrics more important. The existing DuckDB/parquet
implementation is workable, but several correctness gaps became visible once we
reviewed it as a shared runtime:

- parquet filenames can collide when multiple agents write the same check type in
  the same millisecond
- project registry persistence is vulnerable to partial writes because it writes
  the registry file in place
- rollup metrics currently mix counts and rates for supersession
- rollup unresolved RCA counts are never populated from the actual `rca/` files
- model assumption accuracy is derived from invalidations only, so the numerator
  exists but the denominator does not
- adoption trend is derived from current project ranking rather than historical
  compliance movement over time

These are correctness problems, not dashboard polish.

## Decision

Spec-check will harden local persistence and make rollup metrics reflect real
artifact state.

- storage filenames must include a unique event suffix so concurrent writes do not
  overwrite one another
- registry writes must be atomic via temp-file write and rename
- rollup supersession values must be rates derived from project artifact counts,
  not raw invalidation event counts
- rollup unresolved RCA counts must be computed from the current `rca/` directory
  contents for each project
- rollup model assumption accuracy must aggregate assumptions made and invalidated
  from the project artifacts themselves
- rollup adoption trend must be computed over historical compliance buckets by time

## Consequences

- parquet artifact names become nondeterministic beyond their timestamp prefix, so
  tests and tooling must treat the suffix as an opaque identifier
- rollup metrics become more expensive because they incorporate some filesystem
  scans, but they become materially more trustworthy
- the dashboard and HTTP API can compare projects without conflating size-driven
  counts with actual rates

## Alternatives Considered

### Keep the current filename scheme and rely on millisecond resolution

Rejected because concurrent daemon usage makes collisions plausible and silent
overwrites are unacceptable for metrics storage.

### Derive all rollups only from parquet rows

Rejected for the current implementation because several metrics are about the
current artifact state, not only the invalidation events already recorded.
