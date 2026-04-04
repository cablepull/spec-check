# Story 010: Assumption Tracking and Supersession

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

LLMs fill in unspecified details silently. When those details turn out to be wrong,
the resulting rework is invisible — nobody knows why the story changed, which model
made the wrong call, or how often it happens. This story enforces that every LLM-authored
artifact declares its assumptions explicitly, and that when a user invalidates an assumption
the supersession is atomic, traceable, and recorded. Over time, the assumption invalidation
rate becomes a measurable signal of LLM accuracy by model and by assumption category.

## Acceptance Criteria

**Validation (`check_assumptions`):**
- [ ] **AS-1**: Returns `VIOLATION` if `## Assumptions` section is absent from any LLM-authored story, intent, or RCA
- [ ] **AS-2**: Returns `VIOLATION` if any assumption row is missing ID, text, basis, or status columns
- [ ] **AS-3** (tunable): Returns `VIOLATION` if any assumption text contains certainty language without hedging; reports the offending phrase and the detected certainty signal
- [ ] If `## Assumptions` section exists and says "None — all decisions explicitly specified by the user" that is accepted as a valid empty declaration; no further checks run on it

**Supersession (`invalidate_assumption`):**
- [ ] Accepts: `artifact_path`, `assumption_id`, `reason` (plain text)
- [ ] Validates that `assumption_id` exists in the artifact's assumption table before proceeding
- [ ] Updates the assumption row status to `invalidated` and appends the reason and date
- [ ] Moves the original artifact to `<artifact-dir>/archive/<filename>_<YYYYMMDD>_superseded.md`
- [ ] Creates a new version of the artifact at the original path with:
  - `## Status: Superseded` header pointing to the new file added to the archived copy
  - `## Supersedes` header in the new file pointing to the archive copy with reason
  - `## Assumptions` section pre-populated with all previous assumptions; invalidated one marked
  - All other original content preserved
- [ ] Writes a `supersession` event to Parquet (PRD Section 11.1)
- [ ] Returns the path to the new artifact and the path to the archived copy
- [ ] Returns `VALIDATION_ERROR` without making any changes if `assumption_id` is not found

**History (`get_supersession_history`):**
- [ ] Returns all supersession events for a project, ordered by date descending
- [ ] Each event shows: original artifact, replacement, assumption text, reason, model that authored the original, days to invalidation
- [ ] Supports `since` date filter
- [ ] Supports `format: text | json`

## ADR Required

No — supersession is a file management and metrics operation; no new architectural
dependency introduced.

## Requirements

- PRD Section 5, Assumption Tracking criteria: AS-1 through AS-6
- PRD Section 3.2 (assumption table format)
- PRD Section 3.2 (supersession flow and archive convention)
- PRD Section 11.1 (supersession Parquet record schema)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | The new artifact version is created at the exact original path (replacing it), not at a versioned path like `story-001-v2.md` | Keeps the current artifact always at a stable, predictable path; archive holds history | `assumed` |
| A-002 | `invalidate_assumption` does not re-run gate checks on the new artifact automatically; the LLM is responsible for calling `check_story` after updating the replacement | Automatic re-check would add latency and complexity; the LLM should drive the correction loop explicitly | `assumed` |
| A-003 | AS-3 certainty language detection uses a fixed list of signals (`will`, `is`, `always`, `the system uses`, `users expect`) without hedging qualifiers (`assumed`, `not specified`, `defaulted to`, `chosen because`) | Sufficient for v1; the assumption format itself makes hedging easy | `assumed` |
| A-004 | Date in archive filename uses UTC date of the invalidation event, not the original artifact creation date | Consistent with all timestamps in the system (UTC); creation date may not be reliably available | `assumed` |
