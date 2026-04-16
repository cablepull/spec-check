# PRD: Feature F-9: Assumption Tracking

## Feature F-9: Assumption Tracking

### Rule R-23: Validate LLM-authored artifacts must declare all assumptions explicitly
Example: Story with no Assumptions section
  Given a story file that has no `## Assumptions` section
  When `check_assumptions` is called
  Then criterion `AS-1` returns `VIOLATION`

Example: Story with a valid empty Assumptions declaration
  Given a story file with `## Assumptions` containing "None — all decisions explicitly specified by the user."
  When `check_assumptions` is called
  Then criterion `AS-1` passes

### Rule R-24: Validate Assumptions must not be stated as facts
Example: Assumption phrased as certainty
  Given an assumption row with text `The system will use OAuth2 for authentication`
  When `check_assumptions` is called
  Then criterion `AS-3` returns `VIOLATION`
  And `will` is identified as the certainty signal

### Rule R-25: Validate An invalidated assumption must produce a superseding artifact
Example: Assumption marked invalid with no replacement artifact
  Given an assumption with status `invalidated` in a story file
  And no corresponding new version of that story exists
  When `check_assumptions` is called
  Then criterion `AS-4` returns `BLOCK`

---
