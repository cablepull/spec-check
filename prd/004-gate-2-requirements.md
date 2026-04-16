# PRD: Feature F-4: Gate 2 Requirements

## Feature F-4: Gate 2 — Requirements Validation

### Rule R-7: Validate Every Feature must have at least one Rule
Example: Feature with no rules
  Given a requirements file with a `Feature:` heading but no `Rule:` entries beneath it
  When `check_requirements` is called
  Then criterion `R-2` returns `VIOLATION` for that Feature

### Rule R-8: Validate Every Rule must have both a positive and a negative example
Example: Rule with only happy-path example
  Given a Rule with one Example that has no error or rejection language
  When `check_requirements` is called
  Then criterion `R-5` returns `VIOLATION` for that Rule
  And the response notes that no negative/error example was found

Example: Rule with both positive and negative examples
  Given a Rule with one Example showing successful outcome and one showing rejection
  When `check_requirements` is called
  Then criteria `R-4` and `R-5` both pass for that Rule

### Rule R-9: Validate Each Example must have exactly one WHEN step
Example: Example with two WHEN steps
  Given an Example containing `When Jane submits the form` and `When the system validates`
  When `check_requirements` is called
  Then criterion `R-6` returns `BLOCK` for that Example

### Rule R-10: Validate GIVEN steps must describe state, not actions
Example: Action verb in GIVEN
  Given a GIVEN step reading `Given the user clicks the login button`
  When `check_requirements` is called
  Then criterion `R-7` returns `VIOLATION`
  And `clicks` is identified as the offending action verb

### Rule R-11: Validate WHEN must describe one actor performing one action
Example: Compound WHEN
  Given a WHEN step reading `When Jane submits the form and the system sends an email`
  When `check_requirements` is called
  Then criterion `R-8` returns `VIOLATION`
  And the compound junction is identified

### Rule R-12: Validate THEN steps must be externally observable
Example: Internal state in THEN
  Given a THEN step reading `Then the database contains a new user record`
  When `check_requirements` is called
  Then criterion `R-9` returns `VIOLATION`

---
