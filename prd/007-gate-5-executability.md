# PRD: Feature F-7: Gate 5 Executability

## Feature F-7: Gate 5 — Executability

### Rule R-18: Validate Test files must exist
Example: No test files found
  Given a project with no files matching test file patterns
  When `check_executability` is called
  Then criterion `E-1` returns `BLOCK`

### Rule R-19: Validate Each Rule must have a corresponding test
Example: Rule with no matching test
  Given a Rule named `Valid sign-ups create a new membership` with no test description matching those keywords
  When `check_executability` is called
  Then criterion `E-2` returns `VIOLATION` for that Rule
  And the overall Rule coverage percentage is reported

---
