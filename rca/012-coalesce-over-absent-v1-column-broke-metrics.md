# RCA-012: `COALESCE(project_path, path)` Threw DuckDB Binder Error When v1 Column Was Absent

## Summary

`getProjectMetrics` in `src/metrics.ts` filtered Parquet rows with a
`WHERE COALESCE(project_path, path) = ?` clause that was intended to tolerate
both the legacy v1 record schema (which stored the field as `path`) and the
current v2 schema (which renamed it to `project_path`). When the project's
storage directory contained only v2 records — as is the case for any project
that never wrote records under the old schema — DuckDB's binder threw
`Binder Error: Referenced column "path" not found in FROM clause`. The
`readParquetRows` helper logged the error to stderr and returned `[]`, which
caused the metrics layer to emit `NO_DATA` notes and leave every
`gate_pass_rates[gate].value` as `null`. Twelve tests in `tests/metrics.test.ts`
failed in this session before the fix.

## Root Cause

`union_by_name=true` on `read_parquet` only adds `NULL` columns for fields that
are present in **at least one** file in the scanned set. If every file uses v2
(no `path` column), the resulting virtual table has no `path` column at all,
and any SQL expression that references `path` fails at bind time — not at
evaluation time. `COALESCE` does not short-circuit column resolution; DuckDB
binds every argument before the COALESCE evaluator runs.

The cross-version compatibility intent was correct, but the tactic of expressing
the fallback in SQL was incorrect for a schema where the fallback column may be
entirely absent from the scanned files.

## Violated Requirement

- [R-17](../requirements.md) — gate pass-rate metrics must be computable from stored gate records
- [R-18](../requirements.md) — compliance score must aggregate gate pass rates when records exist
- [R-19](../requirements.md) — latest mutation score must be readable from stored mutation records
- [R-65](../requirements.md) — shared runtime outputs must remain trustworthy across transports

## Resolution

- Removed the SQL `WHERE COALESCE(project_path, path) = ?` clause.
- Read every row scoped by the storage glob (`org/repo/service/**/*.parquet`),
  which already uniquely identifies a project in the storage layout.
- Filter by project path in application code with
  `row.project_path ?? row.path === projectPath`, which handles both schemas
  regardless of whether the v1 column exists in the Parquet files.
- Verified via the twelve metrics tests that were failing before the change and
  now pass.

## Spec Update Required

No — R-17/R-18/R-19 already described the intended behaviour. Only the
implementation SQL was wrong.

## ADR Required

No — this is a tactical fix inside an existing architectural decision (DuckDB
over Parquet, ADR-001 and ADR-009). The decision to read all rows for a service
and filter in application code is a minor refinement, not a new architecture.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-012-1 | The `{storageRoot}/{org}/{repo}/{service}/**/*.parquet` glob uniquely scopes a project's records, so application-level filtering by `project_path` is a defence-in-depth check rather than the primary isolation mechanism | `buildStoragePaths` sanitises and namespaces the storage subtree per-project | `assumed` |
| A-012-2 | Reading all rows for a service and filtering in memory is acceptable performance because each project's record volume grows linearly and is bounded by developer usage, not machine-generated traffic | Observed ~300 records for this project over ~3 weeks of dogfooding | `assumed` |
