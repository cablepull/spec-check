# PRD: Feature F-21: Evidence Artifacts

## Feature F-21: Evidence Artifacts

### Rule R-52: Validate verification evidence must be present when a release artifact exists
Example: Release artifact is present with no verification file
  Given a release artifact file is present in the release/ directory
  And no verification file in the verification/ directory references that release artifact
  When check_evidence is called
  Then criterion EV-1 returns VIOLATION
  And the release artifact name and the expected verification file path are listed in the response

Example: Release artifact is present with a matching verification file
  Given a release artifact file is present in the release/ directory
  And a verification file in the verification/ directory references that release artifact
  When check_evidence is called
  Then criterion EV-1 passes for that release artifact

### Rule R-53: Validate benchmark results must be present for performance-sensitive components
Example: Performance-sensitive component has no benchmark result file
  Given a source file contains a benchmark annotation
  And no benchmark result file in the benchmarks/ directory references that component
  When check_evidence is called
  Then criterion EV-2 returns WARNING
  And the component name and the expected benchmark file path are listed in the response

Example: Performance-sensitive component has a benchmark result file
  Given a source file contains a benchmark annotation
  And a benchmark result file in the benchmarks/ directory references that component
  When check_evidence is called
  Then criterion EV-2 passes for that component

---
