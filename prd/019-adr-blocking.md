# PRD: Feature F-19: Adr Blocking

## Feature F-19: ADR Blocking on Structural Diff Triggers

### Rule R-47: Validate a new dependency in a diff blocks until a corresponding ADR is present
Example: New dependency is present in the diff with no matching ADR
  Given a new dependency entry is present in a manifest file within the staged diff
  And no ADR file in the adr/ directory references that dependency name
  When check_diff is called
  Then criterion D-ADR-1 returns BLOCK
  And the dependency name and the expected ADR path are listed in the response

Example: New dependency is present in the diff with a matching ADR
  Given a new dependency entry is present in a manifest file within the staged diff
  And an ADR file in the adr/ directory references that dependency name
  When check_diff is called
  Then criterion D-ADR-1 passes for that dependency

### Rule R-48: Validate a security constraint change in a diff blocks until a corresponding ADR is present
Example: Security-related file change is present in the diff with no matching ADR
  Given a security-related file change is present in the staged diff
  And no ADR file in the adr/ directory references that change
  When check_diff is called
  Then criterion D-ADR-2 returns BLOCK
  And the changed file name and the expected ADR path are listed in the response

Example: Security-related file change is present in the diff with a matching ADR
  Given a security-related file change is present in the staged diff
  And an ADR file in the adr/ directory references the changed file or security domain
  When check_diff is called
  Then criterion D-ADR-2 passes for that change

### Rule R-49: Validate a deployment topology change in a diff blocks until a corresponding ADR is present
Example: Deployment manifest change is present in the diff with no matching ADR
  Given a deployment manifest change is present in the staged diff
  And no ADR file in the adr/ directory references that change
  When check_diff is called
  Then criterion D-ADR-3 returns BLOCK
  And the changed file name and the expected ADR path are listed in the response

Example: Deployment manifest change is present in the diff with a matching ADR
  Given a deployment manifest change is present in the staged diff
  And an ADR file in the adr/ directory references the changed file
  When check_diff is called
  Then criterion D-ADR-3 passes for that change

---
