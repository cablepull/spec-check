# Story 005: Gate 3 — Design Validation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

The problem is that a design document disconnected from requirements may describe a system, but not necessarily the system being built — because without explicit traceability the design and the spec can drift apart silently. Gate 3
enforces that a design exists, that it is traceable back to requirements, and that it
describes something architectural rather than just restating the requirements in prose.
D-4, the contradiction check, is deliberately the weakest criterion — it cannot be
deterministic — but surfacing probable contradictions for human review is still valuable
and prevents obvious logical conflicts from going unnoticed.

## Acceptance Criteria

- [ ] **D-1** (BLOCK): Returns `BLOCK` if no design document found; lists filenames searched
- [ ] **D-2** (VIOLATION): Returns `VIOLATION` if design document contains no reference to any Requirement, Feature name, or Rule identifier found in the requirements; reports which requirements were unmatched
- [ ] **D-3** (VIOLATION, tunable): Returns `VIOLATION` if no component or boundary language detected in design; reports detection confidence and threshold
- [ ] **D-4** (WARNING, tunable): Returns `WARNING` listing each probable contradiction between a design statement and a Rule, with the conflicting texts shown side by side and the confidence score; never promoted to VIOLATION
- [ ] D-4 result includes a clear note that contradiction detection is probabilistic and requires human review
- [ ] D-2 traceability matching is case-insensitive exact match by default; semantic match is a configurable opt-in
- [ ] Gate passes when D-1 and D-2 and D-3 have no BLOCK or VIOLATION; D-4 WARNINGs do not block

## ADR Required

No — D-4 probabilistic contradiction detection is confirmed as WARNING-only in PRD.
No new architectural decision required.

## Requirements

- PRD Section 5, Gate 3 criteria: D-1 through D-4
- PRD Section 5, NLP signals for D-3 and D-4

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | D-2 matching looks for Feature names, Rule text excerpts (first 5 words), and explicit IDs like `R-1` in the design document | No formal cross-reference syntax is specified in the PRD; text excerpt matching is the most pragmatic approach | `assumed` |
| A-002 | D-4 contradiction detection uses negation patterns: if a design statement contains `not`, `never`, `without`, `no` near a term that appears in a Rule, it is flagged as a candidate contradiction | Full semantic opposition requires an embedding model out of scope for v1; negation-proximity is a reasonable heuristic | `assumed` |
| A-003 | ADR directory (`adr/`) counts as a design artifact and satisfies D-1 | ADRs are a form of design documentation; explicitly supported in PRD Section 3.1 | `assumed` |
