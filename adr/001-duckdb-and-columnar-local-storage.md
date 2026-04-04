# ADR-001: DuckDB and Columnar Local Storage

## Status

Accepted

## Context

`spec-check` produces structured results for gate checks, artifact validation, complexity,
mutation, supersession, and metrics queries. The storage layer must support:

- local-only operation with no daemon or external service
- cross-project rollups
- per-model and per-branch comparisons
- date-range filtering
- whole-file and glob-based query pruning
- monorepo service isolation
- queryable nested result payloads

Story [016](../stories/016-storage-architecture.md) marks this as an ADR because the
storage decision affects the entire metrics system and every persisted check type.

The design and PRD already establish the intended shape:

- DuckDB for query execution
- columnar files on the local filesystem
- a git-aligned naming convention
- non-fatal persistence failures

## Decision

`spec-check` will use DuckDB for local query execution over columnar files stored on the
filesystem, with one persisted file per tool run using the git-aligned naming convention.

The intended long-term storage format is Parquet, and DuckDB is the query engine for metrics
and rollup access. In the current implementation phase, JSONL is an acceptable transitional
write format where needed, but the architectural target remains DuckDB querying columnar
run-oriented files through filesystem glob patterns.

The storage contract is:

- storage is local only
- no database server or daemon is required
- data is partitioned by org, repo, service, and UTC date path segments
- each run writes atomically to a temp path and then renames
- persistence failure never blocks analysis results
- query tools read historical data through DuckDB rather than custom file scans

## Consequences

- Query behavior stays local, fast, and operationally simple.
- The path naming convention becomes part of the public architecture because it enables
  filesystem pruning before query execution.
- Metrics and rollup tools can share one query engine instead of bespoke per-check readers.
- Storage writes must preserve a stable schema contract across check types.
- Transitional implementation shortcuts are allowed only if they preserve the same logical
  storage model and do not change the runtime contract for later DuckDB-backed queries.

## Alternatives Considered

### SQLite or another row-store

Rejected because the query workload is analytical rather than transactional, and the PRD
explicitly depends on glob-addressable historical files and cross-project scans.

### Plain JSONL only

Rejected as the architectural endpoint because it lacks the columnar efficiency, schema
discipline, and direct DuckDB/Parquet interoperability expected by the metrics layer.

### External database service

Rejected because the product is explicitly local-first and must not require a server,
network dependency, or daemon process.
