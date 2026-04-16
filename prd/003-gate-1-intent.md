# PRD: Feature F-3: Gate 1 Intent

## Feature F-3: Gate 1 — Intent Validation

### Rule R-4: Validate An intent document must exist before the workflow proceeds
Example: No intent document found
  Given a project root with no `intent.md`, `INTENT.md`, `proposal.md`, or `WHY.md`
  When `check_intent` is called
  Then the result status is `BLOCK`
  And the response lists the exact filenames it searched for

Example: Intent document exists and passes all checks
  Given an `intent.md` with causal language, a constraint, problem before solution, and ≥50 words
  When `check_intent` is called
  Then the result status is `PASS`

### Rule R-5: Validate Intent must articulate why, not just what
Example: No causal language present
  Given an `intent.md` that describes features without using causal language
  When `check_intent` is called
  Then criterion `I-2` returns `VIOLATION`
  And the response lists the causal signal words that were absent

Example: Solution described before problem
  Given an `intent.md` whose first paragraph describes the solution
  When `check_intent` is called
  Then criterion `I-4` returns `VIOLATION`

### Rule R-6: Validate Implementation details must not appear in intent
Example: Concrete technology names detected
  Given an `intent.md` containing a UI framework name, an orchestration platform name, or a database engine name
  When `check_intent` is called
  Then criterion `I-5` returns `WARNING`
  And the detected terms are named in the response

---
