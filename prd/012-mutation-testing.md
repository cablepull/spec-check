# PRD: Feature F-12: Mutation Testing

## Feature F-12: Mutation Testing

### Rule R-31: Validate Project mutation score must meet the configured threshold
Example: Mutation score below threshold
  Given a mutation run produces a score of 71%
  And the MT-1 threshold is 80%
  When the mutation-score tool is called
  Then criterion `MT-1` returns `WARNING`
  And the score, threshold, and gap are reported

### Rule R-32: Validate Spec-critical functions must meet a higher mutation threshold
Example: Spec-critical function with surviving mutants
  Given a function named `validateMembership` that matches a Rule keyword
  And its mutation score is 83%
  And the MT-2 threshold is 90%
  When the mutation-score tool is called
  Then criterion `MT-2` returns `VIOLATION` for `validateMembership`
  And the surviving mutants are listed

---
