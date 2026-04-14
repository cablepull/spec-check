# Story 017: Per-Project Metrics

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Knowing the current state of a project is useful. Knowing how it has trended over the
last month is actionable — but only because the underlying data is aggregated and presented as a coherent picture rather than raw snapshots. This enables teams to act on trends rather than respond to isolated pass/fail results. `get_project_metrics` aggregates everything stored in Parquet
for a single project and presents it as a coherent picture: gate pass rates over time,
violation frequency, complexity trends with deltas, mutation score trajectory, assumption
invalidation rate, story cycle times, and a weighted compliance score. The output must
be consumable by both an LLM (text or JSON) and a human reading a terminal.

## Acceptance Criteria

- [ ] `get_project_metrics` accepts `path` (defaults to cwd) and optional `since` (ISO8601 date string)
- [ ] Identifies the project's org, repo, and service(s) from the path and git remote; queries all matching Parquet files via glob
- [ ] Returns all metrics listed in PRD Section 10.2:
  - Gate pass rates per gate (G1–G5) as percentage and trend direction (improving/declining/stable)
  - Top 5 most frequent violations by criterion ID with occurrence counts
  - Spec coverage: percentage of Features with complete passing specs
  - Drift rate: percentage of code-change runs that had no corresponding spec change
  - CC average and max with delta vs prior period
  - Cognitive complexity average with delta
  - Function length average with delta
  - Nesting depth average with delta
  - Mutation score (latest and trend if ≥2 runs)
  - Spec-complexity ratio: average CC gap (CC minus scenario count) across all functions
  - Assumption invalidation rate (invalidated / total assumptions across all artifacts)
  - Supersession rate (superseded artifacts / total artifacts created)
  - Average days from story creation to all tasks done
  - Average days from RCA creation to resolution (Spec Update = done and ADR = done if required)
  - Weighted compliance score (formula from PRD Section 10.4)
- [ ] When fewer than 2 runs exist for a metric, trend direction is reported as `insufficient_data` rather than a spurious direction
- [ ] `format: text` produces an ASCII report with section headings and inline delta indicators (`↑`, `↓`, `→`)
- [ ] `format: json` produces a machine-parseable object with all metric values and trend directions
- [ ] `format: mermaid` produces a Mermaid `xychart-beta` for gate pass rates over time and a separate `xychart-beta` for complexity trend
- [ ] `since` filter applies to all Parquet glob queries; absence of `since` returns all-time history
- [ ] When no Parquet data exists for the project, returns an informational message — not an error

## ADR Required

No — metrics aggregation queries existing Parquet storage established in Story 016.

## Requirements

- PRD Section 10.2 (per-project metrics list)
- PRD Section 10.4 (compliance score formula)
- PRD Section 12.2 (visualization views)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Gate pass rate is computed as: runs where `gate_status = 'pass'` / total runs for that gate within the time window | Simplest meaningful definition; per-run granularity is already in Parquet | `assumed` |
| A-002 | Trend direction (improving/declining/stable) uses a linear regression slope over the time window; positive slope = improving, negative = declining, slope within ±0.02 = stable | Simple and deterministic; no ML required | `assumed` |
| A-003 | Story cycle time is measured from the file creation timestamp (git log of the story file) to the date all `- [x]` checkboxes in the linked tasks.md are checked | Requires git log for creation date; checkbox state is read from the current file | `assumed` |
| A-004 | RCA resolution is defined as: `## Spec Update Required` = `no`, OR the linked requirement file has been modified after the RCA was created; AND `## ADR Required` = `no` OR the linked ADR exists with status `Accepted` | Resolution criteria not formally defined in PRD; this is the most complete definition | `assumed` |
