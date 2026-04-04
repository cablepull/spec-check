# Story 006: Gate 4 — Tasks Validation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Tasks are the bridge between design and implementation. A task list that contains compound
steps cannot be verified as done. A task list that doesn't trace back to requirements could
be implementing anything. Gate 4 enforces atomicity and traceability before an LLM writes
a single line of production code — ensuring the implementation plan is both verifiable and
connected to what was actually specified.

## Acceptance Criteria

- [ ] **T-1** (BLOCK): Returns `BLOCK` if no tasks document found or document exists but contains zero checkbox items (`- [ ]` or `- [x]`); reports count found
- [ ] **T-2** (VIOLATION, tunable): Returns `VIOLATION` for each task whose text contains `and` joining two distinct actions; reports the offending task and the compound junction
- [ ] **T-3** (VIOLATION, tunable): Returns `VIOLATION` for each task with no traceable link to a Rule or Requirement; first pass is exact keyword match, second pass is configurable NLP similarity; reports the task and match score
- [ ] **T-4** (WARNING, tunable): Returns `WARNING` listing each Rule in requirements with no corresponding task; does not block gate
- [ ] T-2 does not flag `and` used as a conjunction within a noun phrase (e.g. "update header and footer styles" — one action); it flags `and` joining two verb phrases (e.g. "create the service and write the tests")
- [ ] T-3 reports coverage percentage: tasks traced / total tasks
- [ ] T-4 reports coverage percentage: rules covered / total rules
- [ ] Checked (`- [x]`) and unchecked (`- [ ]`) items are both counted and both validated

## ADR Required

No — task atomicity and traceability are deterministic checks; NLP similarity for T-3
second pass is addressed by ADR-002 which covers all semantic matching in the tool.

## Requirements

- PRD Section 5, Gate 4 criteria: T-1 through T-4

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Task text is the full line content after the checkbox marker, trimmed | Standard markdown task list format | `assumed` |
| A-002 | T-2 verb-phrase `and` detection uses POS-inspired heuristic: `and` preceded by a verb or verb phrase (ends in `-s`, `-ed`, `-ing`, or is a base verb) is flagged; `and` following a noun is not | Full POS tagging is out of scope; this pattern catches the majority of compound tasks | `assumed` |
| A-003 | T-3 exact match looks for Rule text excerpts (first 4 significant words, stop words excluded) anywhere in the task text | Sufficient for tasks that paraphrase the rule they implement | `assumed` |
