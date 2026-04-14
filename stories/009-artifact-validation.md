# Story 009: Story, ADR, and RCA Validation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Stories, ADRs, and RCAs are the living record of why the system was built, why it
changed, and why it broke. The problem is that structurally incomplete artifacts — missing sections,
invalid status values, no links to requirements — fail at their core purpose of
preserving traceability. This enables post-factum auditability for every design decision and incident. This story enforces that every artifact of each type is
complete and internally consistent. Validation is on-demand per artifact and also
runs automatically in `check_diff` when these files change.

## Acceptance Criteria

**Stories (`check_story`):**
- [ ] **S-1**: Returns `VIOLATION` if `## Intent` section absent or empty
- [ ] **S-2**: Returns `VIOLATION` if `## Acceptance Criteria` section absent or has no checklist items
- [ ] **S-3**: Returns `VIOLATION` if `## Requirements` section absent or contains no link or reference to a requirement
- [ ] **S-4**: Returns `VIOLATION` if `## ADR Required` section absent or value is not `yes` or `no`
- [ ] **S-5**: Returns `VIOLATION` if `## Assumptions` section absent (even if content is "None")

**ADRs (`check_adr`):**
- [ ] **A-1**: Returns `VIOLATION` for each missing required section: Status, Context, Decision, Consequences, Alternatives Considered
- [ ] **A-2**: Returns `VIOLATION` if Status value is not one of: `Proposed`, `Accepted`, `Superseded`, `Deprecated`
- [ ] **A-3**: Returns `WARNING` if no link to a triggering Story or Intent is found in any section

**RCAs (`check_rca`):**
- [ ] **RC-1**: Returns `VIOLATION` for each missing required section: Summary, Root Cause, Violated Requirement, Resolution, Spec Update Required, ADR Required
- [ ] **RC-2**: Returns `VIOLATION` if `## Violated Requirement` section contains no link or reference
- [ ] **RC-3**: Returns `VIOLATION` if `## Spec Update Required` value is not `yes` or `no`
- [ ] **RC-4**: Returns `VIOLATION` if `## ADR Required` value is not `yes` or `no`
- [ ] **RC-5**: Returns `VIOLATION` if `## Assumptions` section absent

**All three tools:**
- [ ] Accept a specific file path or a directory; directory mode validates all matching files and returns per-file results
- [ ] Archived files (`archive/` subdirectory) are skipped by default; `include_archived: true` flag re-enables them
- [ ] Each result identifies the file, section, and the exact issue

## ADR Required

No — all checks are static structural validation.

## Requirements

- PRD Section 5, Stories/ADR/RCA criteria: S-1 through RC-5
- PRD Section 3.2 (artifact definitions and required sections)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Section detection uses `## <section-name>` heading (H2 level); H3 and deeper are not treated as top-level sections | Artifact templates use H2 for required sections; this is the most common convention | `assumed` |
| A-002 | "Empty section" means the section heading exists but has no non-whitespace content before the next heading | A section with only whitespace is functionally empty | `assumed` |
| A-003 | S-3 requirement reference detection looks for markdown links `[...](...) ` or bare text matching known requirement IDs (`R-\d+`, `Feature:`, Rule text fragments) | No formal cross-reference syntax is mandated in PRD | `assumed` |
