# Story 019: Assumption and Supersession Metrics

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

The assumption tracking system in Story 010 generates events — but events without
aggregation are just a log. This story builds the metrics layer on top of those events:
how often does each model make wrong assumptions, what categories of assumptions get
invalidated most, how long does it take for a wrong assumption to surface, and which
projects have the highest rates of rework driven by assumption failures. These are the
signals that make LLM assumption accuracy a measurable, improvable property over time
rather than an anecdote.

## Acceptance Criteria

**`get_assumption_metrics`:**
- [ ] Accepts `path` (defaults to cwd) and optional `since`
- [ ] Returns per-project:
  - Total assumptions made across all LLM-authored artifacts
  - Total assumptions invalidated
  - Invalidation rate (invalidated / total) as percentage
  - Breakdown by artifact type (story / intent / RCA): count made, count invalidated, rate
  - Top 5 assumption categories invalidated most (NLP-classified from assumption text)
  - Average days from artifact creation to assumption invalidation
  - Model breakdown: for each model that authored artifacts, invalidation rate and assumption count
  - Trend: is invalidation rate improving (declining) or worsening (rising) over the time window
- [ ] Returns `insufficient_data` for any metric requiring more events than are available rather than a misleading number
- [ ] `format: text` renders an ASCII table per section
- [ ] `format: json` returns structured object with all values
- [ ] `format: mermaid` produces a `pie` chart for assumption categories and a `xychart-beta` for invalidation rate over time

**`get_supersession_history`:**
- [ ] Returns all supersession events for the project ordered by date descending
- [ ] Each event: original artifact path, replacement path, artifact type, assumption ID, assumption text, invalidation reason, model that authored the original, days between creation and invalidation
- [ ] Supports `since` date filter
- [ ] Supports `artifact_type` filter (`story` | `intent` | `rca`)
- [ ] `format: text` renders as an ASCII table
- [ ] `format: json` returns array of event objects

## ADR Required

No — reads from supersession Parquet files written by Story 010.

## Requirements

- PRD Section 11.2 (assumption invalidation rate and supersession rate in per-project metrics)
- PRD Section 11.3 (model ranking by assumption accuracy in rollup)
- PRD Section 13.3 (`get_supersession_history` tool)
- PRD Section 13.6 (`get_assumption_metrics` tool)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Assumption category classification uses keyword matching against the assumption text and basis fields; categories: `auth`, `pagination`, `async`, `data-format`, `error-handling`, `infrastructure`, `ux`, `performance`, `security`, `other` | Consistent with Story 018; fixed taxonomy is deterministic and auditable | `assumed` |
| A-002 | "Days to invalidation" is measured from the git creation date of the original artifact file to the timestamp of the supersession event in Parquet | Git log provides creation date; Parquet timestamp provides invalidation date | `assumed` |
| A-003 | The "model that authored the original artifact" is read from the `llm_id` column in the supersession Parquet record, which was captured at invalidation time from the original artifact's `## Assumptions` table header | The original artifact must have a recognisable LLM author; `unknown` is stored when it cannot be determined | `assumed` |
