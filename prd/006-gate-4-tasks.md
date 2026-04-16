# PRD: Feature F-6: Gate 4 Tasks

## Feature F-6: Gate 4 — Tasks Validation

### Rule R-16: Validate Tasks must be atomic
Example: Compound task
  Given a `tasks.md` containing `- [ ] Create the service and write the tests`
  When `check_tasks` is called
  Then criterion `T-2` returns `VIOLATION`
  And `and write the tests` is identified as the compound junction

### Rule R-17: Validate Each task must trace to a requirement
Example: Task with no traceable link
  Given a task `- [ ] Refactor the login module` with no keyword matching any Rule or Feature name
  When `check_tasks` is called
  Then criterion `T-3` returns `VIOLATION` for that task
  And the traceability coverage percentage is reported

---
