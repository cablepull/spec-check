# RCA-010: Storage and Rollup Integrity Gaps

## Summary

The original DuckDB/parquet rollout assumed effectively single-writer behavior and
treated several rollup aggregates as approximations. That was acceptable while the
system behaved like a local, stdio-owned MCP server. It became incorrect once the
runtime expanded to a shared daemon and explicit multi-project operation.

## Root Cause

Two different design shortcuts accumulated:

1. Storage identity was derived from timestamp and check metadata alone, which is
   not enough to guarantee uniqueness under concurrent agents.
2. Rollup metrics were implemented from whichever parquet rows were already
   available, even when the intended metric actually described present filesystem
   state or a time-based trend.

That caused five concrete failures:

- concurrent writes could target the same parquet path
- supersession rate was emitted as a raw count
- unresolved RCA count stayed at zero because it was never populated
- model assumption accuracy could not become correct because `made` was never
  counted in the rollup
- adoption trend reflected current project ordering rather than historical change

## Violated Requirements

- R-16 — storage artifacts must be written safely and query correctly
- R-18 — cross-project rollups must reflect actual project-level quality signals
- R-65 — shared runtime outputs must remain trustworthy across transports
- R-68 — project-scoped state must remain isolated and correct under multi-project
  operation

## Resolution

- add unique suffixes to parquet event filenames
- make registry writes atomic
- compute rollup supersession as a project rate, not a count
- derive unresolved RCA counts from the project `rca/` directories
- aggregate model assumption accuracy from artifact-level assumption data
- compute adoption trend from historical compliance buckets over time

## Spec Update Required

No

## ADR Required

Yes — see [ADR-009](../adr/009-storage-integrity-and-rollup-semantics.md)

## Assumptions

- Existing parquet rows remain readable after the filename hardening because the
  file schema is unchanged.
- Rollup scans may consult filesystem state in addition to parquet rows when the
  metric semantics describe current artifact state.

