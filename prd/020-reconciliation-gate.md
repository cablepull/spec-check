# PRD: Feature F-20: Reconciliation Gate

## Feature F-20: Reconciliation Gate

### Rule R-50: Validate README claims are consistent with actual repository artifacts
Example: README claim has no matching artifact
  Given a README file contains a claim that a feature is implemented
  And no source file with a name matching that feature is present in the repository
  When check_reconciliation is called
  Then criterion RC-1 returns VIOLATION
  And the claimed feature and the missing artifact path are listed in the response

Example: README claim is consistent with a present artifact
  Given a README file contains a claim that a feature is implemented
  And a source file with a name matching that feature is present in the repository
  When check_reconciliation is called
  Then criterion RC-1 passes for that claim

### Rule R-51: Validate task completion claims are consistent with artifact content
Example: A completed task references a missing artifact path
  Given a tasks file has a checked checkbox for a task that references an artifact path
  And no file at that artifact path is present in the repository
  When check_reconciliation is called
  Then criterion RC-2 returns VIOLATION
  And the task text and the missing artifact path are listed in the response

Example: A completed task references an artifact that is present in the repository
  Given a tasks file has a checked checkbox for a task that references an artifact path
  And a file at that artifact path is present in the repository
  When check_reconciliation is called
  Then criterion RC-2 passes for that task

---
