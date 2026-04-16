# PRD: Feature F-11: Complexity Analysis

## Feature F-11: Code Complexity Analysis

### Rule R-28: Validate No function may exceed the cyclomatic complexity threshold
Example: Function exceeds CC threshold
  Given a TypeScript function `processPayment` with a cyclomatic complexity of 14
  And the CC-1 threshold is configured at 10
  When `check_complexity` is called
  Then criterion `CC-1` returns `VIOLATION` for `processPayment`
  And the file, line number, and CC value are reported

### Rule R-29: Validate High-complexity functions must have sufficient spec scenario coverage
Example: High-CC function with insufficient scenarios
  Given a function with CC of 12 and only 3 spec scenarios referencing it
  When `check_complexity` is called
  Then criterion `CC-2` returns `WARNING`
  And the gap (9 missing scenarios) is reported

### Rule R-30: Validate Increasing complexity trends must be surfaced
Example: Function CC increasing across three consecutive runs
  Given `processPayment` had CC of 8, then 10, then 12 across three prior runs
  When `check_complexity` is called on the fourth run
  Then criterion `CC-6` returns `WARNING` with the trend values shown

---
