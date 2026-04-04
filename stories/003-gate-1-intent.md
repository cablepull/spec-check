# Story 003: Gate 1 — Intent Validation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

The intent document is the WHY behind everything that follows. If it is missing, empty,
or describes a solution without a problem, all downstream artifacts are built on an
unstated foundation. Gate 1 enforces that an LLM has genuinely captured intent before
it is allowed to proceed to requirements. The checks must be deterministic where possible
and tunable where NLP is involved — so teams can calibrate strictness as their process matures.

## Acceptance Criteria

- [ ] **I-1** (BLOCK): Returns `BLOCK` if no intent document found; lists the exact filenames it looked for
- [ ] **I-2** (VIOLATION, tunable): Returns `VIOLATION` if no causal language detected; names the missing signal words; passes if any of the defined causal signals are present above threshold
- [ ] **I-3** (VIOLATION, tunable): Returns `VIOLATION` if no constraint or boundary language found; passes if constraint signals present above threshold
- [ ] **I-4** (VIOLATION, tunable): Returns `VIOLATION` if solution language appears before problem language; detection uses sentence-order scoring
- [ ] **I-5** (WARNING, tunable): Returns `WARNING` if implementation details detected (PascalCase identifiers, framework names, DB column patterns, snake_case); does not block gate
- [ ] **I-6** (VIOLATION): Returns `VIOLATION` if word count is below 50; reports actual count
- [ ] Gate passes (overall `PASS`) only when no BLOCK or VIOLATION results remain
- [ ] Each result includes: criterion ID, status, plain-language detail, evidence (matched text), and a `fix` suggestion
- [ ] NLP thresholds are read from config; defaults used when config absent
- [ ] Check runs in < 500ms on documents up to 10,000 words

## ADR Required

No — NLP approach (rule-based signal matching) confirmed in PRD. ADR-002 covers semantic
matching for later stories; Gate 1 uses simpler keyword/pattern matching only.

## Requirements

- PRD Section 5, Gate 1 criteria: I-1 through I-6
- PRD Section 5, NLP signals for I-2 and I-5
- PRD Section 14, Configuration (threshold keys)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Intent document is searched at the project root only, not recursively | Intent is a root-level artifact by convention; recursive search would produce false positives | `assumed` |
| A-002 | Causal language detection uses word/phrase presence (not sentence parse trees) | Parse trees require a grammar library not yet in scope; phrase matching is deterministic and fast | `assumed` |
| A-003 | I-4 sentence-order detection splits on sentence boundaries using periods and newlines, not a full NLP sentence tokeniser | Full tokeniser is out of scope for v1; period-and-newline splitting is sufficient for markdown prose | `assumed` |
| A-004 | I-5 snake_case detection uses regex `\b[a-z]+(_[a-z]+){2,}\b` to avoid false positives on common words | Single underscores (e.g. "log_in") are too common; requiring 2+ segments reduces noise | `assumed` |
