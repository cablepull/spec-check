# Story 011: Diff-Based Change Detection

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Running `run_all` on every change is wasteful and generates noise. More importantly,
full re-validation misses the relational violations that only matter when something
changes — code changing without a story, a dependency added without an ADR, requirements
changing without tasks being updated. `check_diff` understands what changed and applies
only the reconciliation rules that are relevant to that change. This makes the tool fast
enough to call on every commit and precise enough that its output is always actionable.

## Acceptance Criteria

- [ ] `check_diff` invokes `git diff HEAD` (staged + unstaged) by default; accepts optional `base` argument for comparing against a specific commit or branch
- [ ] Categorises every changed file into one of the change categories defined in PRD Section 9.1 (Intent, Requirements, Design, Tasks, Stories, RCA, Dependencies, Code, Tests)
- [ ] Files not matching any category are reported as `uncategorised` and excluded from reconciliation checks
- [ ] For each applicable reconciliation rule in PRD Section 9.2, runs the targeted check and reports pass/violation
- [ ] ADR trigger detection scans diff content (not just filenames) for infrastructure, constraint, integration, and scale signals defined in PRD Section 3.2 (ADR trigger conditions)
- [ ] When ADR trigger signals are found without a corresponding ADR file change in the same diff, returns `VIOLATION` with the specific signals detected and which files contained them
- [ ] When code changes are detected with no corresponding story or RCA file in the diff, returns `VIOLATION` listing the changed code files and noting they are untraceable
- [ ] When code changes are detected with no corresponding test changes, returns `WARNING` (not VIOLATION)
- [ ] Output groups results by change category, then by reconciliation rule
- [ ] Works on projects with no prior git history (no diff available) by returning an informational note, not an error
- [ ] Works with unstaged changes (not just staged)
- [ ] Metrics written to Parquet after each run (check-type: `diff`)

## ADR Required

No — diff analysis uses `git diff` via subprocess. No new architectural dependency.

## Requirements

- PRD Section 9, Diff-Based Change Detection (Sections 9.1, 9.2, 9.3)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | `git` is available on the system PATH; if not, `check_diff` returns a structured `GIT_NOT_FOUND` error | Git is a universal prerequisite for any project using this tool; not explicitly stated in PRD | `assumed` |
| A-002 | Hotfix commits are exempt from the "code change must trace to a story" rule if the commit message contains `hotfix`, `fix:`, or `bugfix` — these trace to an RCA instead | PRD Section 9.2 notes "or be explicitly marked as a hotfix (RCA path)"; commit message is the most accessible signal | `assumed` |
| A-003 | `check_diff` does not re-run full gate validation; it only applies the targeted reconciliation rules for changed categories | Full re-validation is `run_all`'s responsibility; diff check is for relational integrity only | `assumed` |
| A-004 | ADR trigger detection scans the full diff text (added lines only, not removed lines) | Removed lines represent deletion, not addition of new architectural concerns | `assumed` |
