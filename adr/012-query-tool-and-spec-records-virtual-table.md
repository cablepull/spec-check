# ADR-012: Ad-hoc SQL Query Interface and `spec_records` Virtual Table

## Status

Accepted

## Context

Triggering artifact: [intent.md](../intent.md); extends the metrics surface described in the metrics stories under `stories/`.

spec-check persists every check result as a Parquet file under
`{storageRoot}/{org}/{repo}/{service}/YYYY/MM/DD/<event>.parquet`. The existing
metrics helpers (`getProjectMetrics`, `getRollupMetrics`) expose curated
aggregates, but users and LLM agents frequently asked ad-hoc questions — "when
did G4 last fail on this branch?", "which model has the highest pass rate on
G2?", "how many reconciliation checks ran this week?" — that the curated
metrics cannot answer without shipping new code for each question.

Three shapes of query access were considered:

1. A read-only CLI that accepts arbitrary DuckDB SQL.
2. A parallel MCP tool so LLM agents can write the same ad-hoc SQL.
3. A JavaScript API.

The storage layer already exposes `runDuckQuery(sql)` as a thin wrapper over a
DuckDB subprocess. The missing pieces were (a) a safe way to expose the raw
Parquet glob as a table reference and (b) a guard against destructive SQL.

References: Feature F-23 (metrics query surface), R-16, R-17, R-65

## Decision

**Introduce a virtual table alias `spec_records` that resolves at query time to
`read_parquet('{storageRoot}/**/*.parquet', union_by_name=true)`.** The alias
is rewritten in `runSpecQuery` (`src/storage.ts`) via a case-insensitive
regex-replace before the SQL is handed to DuckDB. When a project-scoped
variant is requested, the glob is narrowed to
`{storageRoot}/{org}/{repo}/{service}/**/*.parquet` by passing path parts to
the same helper.

**Restrict queries to read-only statements.** `assertSelectOnly` rejects
anything that does not start with `SELECT` or `WITH`, and rejects any SQL
containing the keywords `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`,
`ALTER`, `TRUNCATE`, `COPY`, `EXECUTE`, or `CALL` anywhere in the statement.
This is a belt-and-braces check; DuckDB also enforces read-only semantics on
Parquet sources, but the keyword guard rejects destructive intent at parse
time and yields a clearer error message.

**Expose the same entry point through both the CLI and the MCP.** The CLI
command `spec-check query "<SQL>"` and the MCP tool `query` both route through
`executeToolRequest("query", { sql, path?, format? })`, which calls the shared
`runSpecQuery`. The CLI offers `--format json|table|csv`; the MCP tool offers
the same enum.

**Offer a pre-canned `stats` CLI command** that runs four fixed analytics
queries (total records, breakdown by type, top projects, recent records) for
users who want a summary without writing SQL.

## Requirement Traceability

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
| R-16 | Stored records must be queryable | `runSpecQuery` + `spec_records` alias |
| R-17 | Gate pass rates must be computable across models/projects | Query examples in `--schema` output and MCP tool description |
| R-65 | CLI and MCP must share the same runtime behaviour | `cmdQuery` routes through `executeToolRequest` |

## Consequences

**Positive.** Users can answer arbitrary questions without waiting for a new
MCP tool. LLM agents can run the same queries. The virtual table alias hides
the physical storage layout, so we can move files, change the hierarchy, or
switch to a single-file database without breaking existing queries. The
SELECT-only guard is centralised in `storage.ts` and cannot be bypassed by
calling `runSpecQuery` with mutating SQL.

**Negative.** A virtual table implemented by regex rewriting is fragile in
principle — a cleverly quoted literal containing the token `spec_records`
would be rewritten incorrectly. In practice the token is unambiguous in
analytics queries and the rewrite uses a `\b`-anchored pattern, but we accept
this limit. Exposing arbitrary DuckDB SQL also exposes the full schema of
stored records, including LLM model identifiers and agent IDs; this is fine
for a local developer tool but would need to be reconsidered if spec-check
ever multi-tenanted a single storage root.

## Alternatives Considered

### Curated tool per metric

Rejected. We would be adding new tools indefinitely. The curated aggregate
tools already exist (`metrics`, `get_rollup`) for the high-value cases; the
query tool covers the long tail without inflating the MCP surface.

### DuckDB HTTP API

Rejected. Standing up a DuckDB HTTP endpoint for a local developer tool is
disproportionate. The in-process and subprocess DuckDB calls are sufficient.

### Return raw Parquet file paths and let the caller query

Rejected. Pushes the physical layout to every caller; precludes future
changes to storage layout; does not provide a SELECT-only guard.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-012-1 | `\bspec_records\b` never appears inside a string literal in a user's query | Token is specific enough to spec-check that natural SQL does not collide | `assumed` |
| A-012-2 | The keyword guard is sufficient; DuckDB's Parquet read path will also reject mutations on read-only sources | Documented DuckDB behaviour | `assumed` |
| A-012-3 | Exposing the full record schema through an ad-hoc query is acceptable because spec-check storage is single-user and local | Current deployment model | `assumed` |
