# PRD: Feature F-10: Diff Detection

## Feature F-10: Diff-Based Change Detection

### Rule R-26: Validate Code changes must trace to a story or RCA
Example: Code changed with no story in diff
  Given a git diff showing changes to `src/auth.ts`
  And no changes to any file in `stories/` in the same diff
  And the commit message contains no hotfix marker
  When `check_diff` is called
  Then a `VIOLATION` is returned listing the untraceable code files

### Rule R-27: Validate New dependencies must have a corresponding ADR
Example: Dependency added with no ADR in diff
  Given a git diff showing a new entry in `package.json` dependencies
  And no changes to any file in `adr/` in the same diff
  When `check_diff` is called
  Then a `VIOLATION` is returned naming the new dependency and the missing ADR

---
