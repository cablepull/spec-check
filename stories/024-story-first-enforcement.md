# Story 024: Story-First Enforcement

**Status:** Draft
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

The methodology says implementation must be story-driven, but that rule only matters if
the system actively blocks task execution when no story artifact exists or when the
linked story is structurally invalid. This story makes `stories/` a hard prerequisite
for task execution and propagates story-validation failures into downstream gate output
so missing narrative context is caught before implementation proceeds.

## Acceptance Criteria

- [ ] Gate 4 scans `stories/` for `.md` files before task evaluation
- [ ] Gate 4 returns an `S-5` BLOCK when no story artifacts exist for implementation work
- [ ] The `S-5` evidence field lists the identifiers or tasks that have no matching story artifact
- [ ] Story validation failures are surfaced as prerequisite notes in downstream gate results
- [ ] A failing story acceptance-criteria check is referenced explicitly in gate payloads when it blocks progress

## ADR Required

No — this is a gate-enforcement rule on top of existing artifact validation.

## Requirements

- PRD Rule R-45
- PRD Rule R-46

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Presence of one or more valid files under `stories/` is the minimum activation signal for story-first enforcement | The PRD defines `stories/` as the entry point for feature and change work | `assumed` |
| A-002 | Gate output may carry prerequisite notes without changing the underlying gate status contract | The existing result envelope already supports evidence and notes alongside criteria | `assumed` |
