# PRD: Feature F-8: Artifact Validation

## Feature F-8: Artifact Validation (Stories, ADRs, RCAs)

### Rule R-20: Validate Stories must have all required sections
Example: Story missing Acceptance Criteria section
  Given a story file with `## Intent` but no `## Acceptance Criteria`
  When `check_story` is called
  Then criterion `S-2` returns `VIOLATION`

### Rule R-21: Validate ADR status must be a valid value
Example: Invalid ADR status
  Given an ADR with `## Status: In Progress`
  When `check_adr` is called
  Then criterion `A-2` returns `VIOLATION`
  And the valid values are listed in the response

### Rule R-22: Validate RCAs must link to a violated requirement
Example: RCA with no requirement link
  Given an RCA whose `## Violated Requirement` section contains only prose with no link or ID reference
  When `check_rca` is called
  Then criterion `RC-2` returns `VIOLATION`

---
