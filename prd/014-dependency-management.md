# PRD: Feature F-14: Dependency Management

## Feature F-14: Dependency Management

### Rule R-35: Validate Missing analysis tools must be reported with install guidance
Example: lizard not installed
  Given lizard is not present on the system
  When `check_dependencies` is called
  Then lizard is listed as missing
  And the metrics it would enable are listed
  And the install command is shown for each available package manager

### Rule R-36: Validate Installation failures must be categorised with a human explanation
Example: Install fails due to missing runtime
  Given Python is not installed on the system
  When `install_dependency` is called with `name: "lizard"`
  Then the result reason is `RUNTIME_NOT_FOUND`
  And the explanation states that Python must be installed first
  And the raw stderr output is included

---
