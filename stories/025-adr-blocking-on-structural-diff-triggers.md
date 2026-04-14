# Story 025: ADR Blocking on Structural Diff Triggers

**Status:** Draft
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

Architectural changes are often introduced in small diffs that look operational rather
than strategic. This story makes that drift explicit in order to ensure every structural decision is recorded before it becomes invisible in production. This enables the diff analyser to
block merges when dependency, security, or deployment-topology changes appear without a
corresponding ADR. The intent is not to classify every code change as architectural; it
is to catch the specific structural triggers that the PRD calls out as decision records.

## Acceptance Criteria

- [ ] Diff analysis detects new dependency additions in supported manifest files and enforces `D-ADR-1`
- [ ] Diff analysis detects security-sensitive file changes and enforces `D-ADR-2`
- [ ] Diff analysis detects deployment-manifest and topology changes and enforces `D-ADR-3`
- [ ] Each ADR-trigger criterion scans `adr/` for matching coverage before returning PASS
- [ ] Missing ADR coverage returns BLOCK with the triggering dependency or file in evidence

## ADR Required

No — the story implements ADR enforcement, not a new architectural dependency.

## Requirements

- PRD Rule R-47
- PRD Rule R-48
- PRD Rule R-49

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Filename and content heuristics are sufficient to classify dependency, security, and deployment triggers in v1 | The PRD defines trigger classes but does not require semantic code analysis | `assumed` |
| A-002 | ADR presence can be treated as coverage when the relevant dependency name, file path, or domain is referenced in ADR content | The current repository keeps ADRs as markdown artifacts rather than structured records | `assumed` |
