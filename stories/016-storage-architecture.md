# Story 016: Storage Architecture — DuckDB and Parquet

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Every check run produces data that should be queryable — not just retrievable — because flat-file retrieval cannot support the cross-project rollups, per-model comparisons, and trend analysis the metrics layer requires. This enables all metrics tools to share one fast, local query engine rather than bespoke per-check readers. The storage
layer must support the full range of queries described in the PRD: cross-project rollups,
per-model comparisons, per-branch comparisons, date-range filtering, check-type filtering,
and service-level isolation in monorepos — all via glob patterns that prune at the filesystem
level before DuckDB touches a single row. Parquet provides columnar compression, schema
enforcement, and native DuckDB support. The naming convention encodes the dimensions that
benefit from filesystem pruning directly into the path, so queries are fast regardless of
how many projects or how many months of history exist.

## Acceptance Criteria

- [ ] Every completed tool call that produces a result writes one Parquet file using the naming convention: `{root}/{org}/{repo}/{service}/{YYYY}/{MM}/{DD}/{commit8}_{branch}_{llm}_{check-type}_{HHMMSSmmm}.parquet`
- [ ] All path components are sanitised: `/` → `__` in branch names, spaces → `-`, length truncated to 40 chars
- [ ] `org` and `repo` are derived from git remote URL; if no remote, `local` is used for org and the directory name for repo
- [ ] `service` is `root` for flat repos and for whole-repo checks; named service for monorepo per-service checks (see Story 022)
- [ ] `commit8` is the short git SHA; `no-commit` if no git repo present
- [ ] LLM identity is resolved in priority order per PRD Section 10.4; `unknown` stored when not identifiable
- [ ] Each Parquet file contains all columns defined in PRD Section 11.1 for its check type; columns not applicable to a check type are stored as NULL
- [ ] Gate check files include the `results` array serialised as a JSON string column (DuckDB can query with `json_extract`)
- [ ] Complexity files include one row per function with all metric columns
- [ ] Mutation files include aggregate and per-function score columns
- [ ] Supersession files include all fields from PRD Section 11.1 supersession schema
- [ ] Storage root directory is created automatically if it does not exist
- [ ] Writes are atomic: Parquet file is written to a temp path first, then renamed; a failed write does not produce a partial file
- [ ] Write failures are logged to stderr but never cause the tool call to return an error — analysis results are always returned even if persistence fails
- [ ] DuckDB is invoked via its Node.js binding (`duckdb` npm package) for query execution in metrics tools
- [ ] A smoke-test query runs at server startup to verify DuckDB can read Parquet from the configured storage root; failure is logged as WARNING, server still starts

## ADR Required

Yes — **ADR-001**: DuckDB + Parquet vs alternative storage options. This is the primary
storage decision for the entire metrics system.

## Requirements

- PRD Section 10 (Storage Architecture — all subsections)
- PRD Section 11.1 (record schemas for all check types)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | `duckdb` npm package is added as a runtime dependency; it bundles its own DuckDB binary and requires no system-level install | The `duckdb` npm package is self-contained; this is its documented use case | `assumed` |
| A-002 | Parquet files are written using the `parquetjs` or `parquet-wasm` npm package; DuckDB is used only for reading/querying | DuckDB can write Parquet but its Node.js API for writes is less ergonomic than dedicated write libraries; separation of concerns | `assumed` |
| A-003 | Each tool call writes exactly one Parquet file regardless of how many results it produces; all results for a run are in a single file | One file per run keeps the directory structure manageable; glob queries still work at the run level | `assumed` |
| A-004 | Timestamps in filenames are UTC millisecond precision; all timestamps in Parquet column values are ISO8601 UTC strings | Consistency with the rest of the system; avoids timezone ambiguity | `assumed` |
| A-005 | The `results` array (per-criterion outcomes) is stored as a JSON string column rather than as repeated Parquet rows | Avoids schema complexity from variable-length nested arrays; DuckDB's `json_extract` makes it queryable | `assumed` |
