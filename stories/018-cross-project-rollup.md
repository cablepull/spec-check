# Story 018: Cross-Project Rollup and Model Comparison

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Individual project metrics answer "how are we doing here." The cross-project rollup
answers "which model is most disciplined, which projects need attention, and where
does the methodology break down most often across the whole organisation." It is the
view that makes aggregate patterns visible — the recurring violation that every model
misses, the project whose mutation score is quietly degrading, the model whose
assumptions get invalidated twice as often as its peers. Without the rollup these
patterns remain invisible until they surface as bugs or rework.

## Acceptance Criteria

- [ ] `get_rollup` accepts optional `since` (ISO8601) and `format` (text/json/mermaid); requires no `path` — queries all projects in the storage root
- [ ] Returns all metrics listed in PRD Section 10.3:
  - Per-project compliance scores ranked highest to lowest with gate breakdown
  - Models ranked by Gate pass rate (per gate and overall), across all projects and time window
  - Models ranked by assumption accuracy (`1 - invalidation_rate`), min 5 runs to qualify
  - Models ranked by CC trend direction (producing simpler vs more complex code over time)
  - Projects with highest average CC (most complexity risk)
  - Projects with lowest mutation scores (most behavioral constraint risk)
  - Projects with highest supersession rates
  - Projects with most unresolved RCAs
  - Most common violations by criterion ID across all projects (top 10)
  - Most frequently invalidated assumption categories across all projects (NLP-classified, top 5)
  - Aggregate methodology adoption trend: is overall compliance score improving or declining
- [ ] Model comparison view (`format: model_comparison`) renders a side-by-side ASCII table with one column per model, one row per gate, cells showing pass rate percentage
- [ ] Minimum 2 runs required for a model to appear in rankings; models with insufficient data shown in a separate "insufficient data" section
- [ ] All queries use DuckDB glob patterns against the storage root; no per-project iteration in application code
- [ ] `get_rollup` completes in < 5 seconds for storage roots with up to 5 years of data across 50 projects

## ADR Required

No — rollup queries existing Parquet storage via DuckDB glob patterns. No new architectural
dependency.

## Requirements

- PRD Section 10.3 (cross-project rollup metrics)
- PRD Section 12.2 (model comparison visualization)
- PRD Section 10.6 (glob query examples)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Assumption category classification uses a fixed taxonomy (auth, pagination, async, data format, error handling, infrastructure, UX, performance) applied via keyword matching to assumption text | NLP-based category inference is out of scope for v1; keyword taxonomy covers the most common categories | `assumed` |
| A-002 | "Unresolved RCA" means an RCA file exists with `## Spec Update Required: yes` but no corresponding requirement file has been modified after the RCA creation date, OR `## ADR Required: yes` but no ADR file with `Accepted` status exists | Consistent with Story 017 resolution definition | `assumed` |
| A-003 | The rollup queries all Parquet files matching `{storage_root}/**/*.parquet` without filtering by org or repo; project identity is read from the `org`, `repo`, `service` columns inside each file | The path encodes these for filesystem pruning; the columns inside are authoritative | `assumed` |
| A-004 | Model ranking by CC trend uses the average slope of CC over time across all functions in all projects where that model ran `check_complexity`; positive slope = making code more complex | Consistent with per-project trend computation in Story 017 | `assumed` |
