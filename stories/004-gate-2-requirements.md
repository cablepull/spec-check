# Story 004: Gate 2 — Requirements Validation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Requirements are the contract between intent and implementation. Gate 2 is the most
critical gate in the methodology — it enforces structural correctness of the
Feature → Rule → Example → Given/When/Then hierarchy, verifies that every Rule has
both a positive and a negative scenario, and prevents implementation language from
leaking into the spec. An LLM that skips any of these steps produces specs that
drift, mislead, or fail to cover edge cases. Gate 2 catches all of it before a line
of design or code is written, in order to ensure implementation is always grounded in a complete, correct specification. This enables design and code to proceed from a spec that has been structurally validated.

## Acceptance Criteria

- [ ] **R-1** (BLOCK): Returns `BLOCK` if no Feature is found; reports which files were scanned
- [ ] **R-2** (VIOLATION): Returns `VIOLATION` for each Feature with zero Rules
- [ ] **R-3** (VIOLATION, tunable): Returns `VIOLATION` for each Rule whose text opens with an imperative verb; reports the offending verb and the Rule text
- [ ] **R-4** (VIOLATION): Returns `VIOLATION` for each Rule with no positive Example
- [ ] **R-5** (VIOLATION, tunable): Returns `VIOLATION` for each Rule with no negative/error Example; NLP detects error-scenario signals in Example text to classify positive vs negative
- [ ] **R-6** (BLOCK): Returns `BLOCK` for each Example containing zero or more than one WHEN step
- [ ] **R-7** (VIOLATION, tunable): Returns `VIOLATION` for each GIVEN step containing action verbs; reports the step text and the detected verb
- [ ] **R-8** (VIOLATION, tunable): Returns `VIOLATION` for each WHEN step that is compound (multiple actors or `and` joining two clauses); reports the offending clause
- [ ] **R-9** (VIOLATION, tunable): Returns `VIOLATION` for each THEN step referencing internal state; reports the offending phrase
- [ ] **R-10** (WARNING, tunable): Returns `WARNING` for implementation leakage in any step; does not block gate
- [ ] Parser correctly handles both Gherkin `.feature` format and markdown Given/When/Then prose
- [ ] Results are grouped by Feature → Rule → Example for readability
- [ ] Each violation identifies the exact file, line range, and offending text
- [ ] Check runs in < 1s for projects with up to 50 spec files

## ADR Required

No — structural parsing and rule-based NLP confirmed approach in PRD.

## Requirements

- PRD Section 5, Gate 2 criteria: R-1 through R-10
- PRD Section 5, NLP signals for R-3, R-7, R-8, R-9, R-10

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Markdown GWT is detected by lines beginning with `Given`, `When`, `Then`, `And`, `But` (case-insensitive) | Standard Gherkin keyword convention; the most common markdown prose format | `assumed` |
| A-002 | A "Feature" in markdown is identified by a top-level `#` or `##` heading containing the word "Feature" or preceded by a `Feature:` label | Gherkin uses `Feature:` label; markdown docs vary; both patterns needed | `assumed` |
| A-003 | R-5 negative example detection uses keyword signals (`error`, `invalid`, `reject`, `fail`, `not found`, `unauthorized`, `forbidden`) rather than semantic classification | Semantic classification requires embedding model; keyword detection is sufficient and deterministic | `assumed` |
| A-004 | R-3 imperative verb detection checks only the first word of the Rule statement | Rules that begin with an actor noun (`"Users can..."`) are declarative; only first-word verbs indicate imperative | `assumed` |
| A-005 | `.feature` files and markdown specs are both valid input; the parser auto-detects by file extension | Both formats are in use across the landscape tools surveyed | `assumed` |
