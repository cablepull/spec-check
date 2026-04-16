# PRD: Feature F-5: Gate 3 Design

## Feature F-5: Gate 3 — Design Validation

### Rule R-13: Validate A design document must exist before tasks are written
Example: No design document found
  Given a project with no `design.md`, `architecture.md`, or `adr/` directory
  When `check_design` is called
  Then the result status is `BLOCK`

### Rule R-14: Validate The design must reference requirements it addresses
Example: Design with no requirement references
  Given a `design.md` that describes components but mentions no Feature names or Rule IDs
  When `check_design` is called
  Then criterion `D-2` returns `VIOLATION`

### Rule R-15: Validate The design must not contradict requirements
Example: Probable contradiction detected
  Given a Rule stating `Valid emails are accepted` and a design statement containing `email validation is not performed`
  When `check_design` is called
  Then criterion `D-4` returns `WARNING` with the two conflicting texts shown side by side
  And the result notes that contradiction detection is probabilistic and requires human review

---
