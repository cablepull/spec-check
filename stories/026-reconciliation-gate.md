# Story 026: Reconciliation Gate

**Status:** Draft
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

Documentation drift is a form of spec debt. README files and completed tasks can claim
capabilities or artifacts that are no longer present, and those mismatches undermine the
credibility of the spec system itself. This story introduces a reconciliation gate because documentation drift undermines the credibility of the spec system itself — it must compare repository claims against actual files so public documentation and completion
signals remain anchored to the repository state. This enables README and task completion claims to remain verifiable at any point in the project lifecycle.

## Acceptance Criteria

- [ ] README claim extraction identifies verifiable artifact references
- [ ] README path claims are checked against repository files and missing claims return `RC-1` VIOLATION
- [ ] Completed-task artifact references are extracted from checked task items
- [ ] Completed-task artifact references are checked against repository files and missing artifacts return `RC-2` VIOLATION
- [ ] Reconciliation results are exposed through the `check_reconciliation` tool and persisted for metrics

## ADR Required

No — this is a repository-consistency check over existing artifacts.

## Requirements

- PRD Rule R-50
- PRD Rule R-51

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Backtick-quoted paths are a reliable v1 signal for README and task artifact claims worth reconciling | This keeps the parser deterministic and minimizes false positives from prose text | `assumed` |
| A-002 | Repository-file existence is the right first-pass truth source even when richer semantic reconciliation could be added later | The PRD focuses on artifacts being present and traceable, not on deep behavioral verification | `assumed` |
