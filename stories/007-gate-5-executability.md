# Story 007: Gate 5 — Executability Validation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

A spec that has no corresponding tests is documentation. It may be correct today and
wrong tomorrow. Gate 5 enforces that specs become executable — that tests exist, that
they cover the Rules that were specified, and that they use language that mirrors the
spec scenarios rather than testing implementation internals. This is the final gate
before declaring a feature complete. Passing it means the spec is not only written
but verifiable.

## Acceptance Criteria

- [ ] **E-1** (BLOCK): Returns `BLOCK` if no test files found; lists the patterns searched and directories scanned
- [ ] **E-2** (VIOLATION, tunable): Returns `VIOLATION` for each Rule in requirements with no corresponding test; matching uses exact Rule keyword match first, NLP similarity second; reports per-Rule match status and overall coverage percentage
- [ ] **E-3** (WARNING): Returns `WARNING` if no test files contain spec-style language (`describe`, `it(`, `should`, `Given`, `When`, `Then`); does not block gate
- [ ] E-1 scans for test files using the patterns defined in PRD Section 9.1 (Tests category)
- [ ] E-2 reports: rules covered / total rules, rules uncovered (listed by name), coverage percentage
- [ ] E-3 samples up to 20 test files; reports how many were sampled and how many contained spec language
- [ ] Gate passes when E-1 has no BLOCK and E-2 has no VIOLATION; E-3 WARNING does not block

## ADR Required

No — test file detection is static; E-2 NLP matching is covered by ADR-002.

## Requirements

- PRD Section 5, Gate 5 criteria: E-1 through E-3
- PRD Section 9.1, Tests change category (file patterns)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Test files in `node_modules`, `vendor`, `dist`, and `build` directories are excluded | These are dependency/output directories, not project tests | `assumed` |
| A-002 | E-2 Rule-to-test matching checks test file names and test description strings (content of `describe(`, `it(`, `test(` calls); not just file names | File names alone are insufficient; test descriptions are the meaningful signal | `assumed` |
| A-003 | E-3 "spec-style language" requires the keywords to appear in test description strings, not in comments or string literals under test | Comments and string literals are noise; the keywords must appear as test structure | `assumed` |
