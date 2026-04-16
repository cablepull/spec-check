# PRD: Feature F-18: Story First Enforcement

## Feature F-18: Story-First Enforcement

### Rule R-45: Validate a story artifact must exist before implementation tasks proceed
Example: No story artifact is present for any task
  Given no story file is present in the stories/ directory
  When check_tasks is called
  Then criterion S-5 returns BLOCK
  And the response lists the identifiers that have no matching story

Example: A story artifact is present and linked for a task
  Given a story file is present in the stories/ directory with a matching identifier for a task
  When check_tasks is called
  Then the story is shown as linked in the S-5 result

### Rule R-46: Validate a story must pass artifact validation before gate checks proceed
Example: Story file has missing required sections
  Given a story file is present in the stories/ directory with no acceptance criteria section
  When check_story is called
  Then criterion S-2 returns VIOLATION
  And gate check results include a prerequisite note referencing the story validation failure

Example: Story file with all required sections passes validation
  Given a story file with an intent section, an acceptance criteria section, and an assumptions section all present
  When check_story is called
  Then all criteria for that story return PASS

---
