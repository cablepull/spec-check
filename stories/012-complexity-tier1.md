# Story 012: Code Complexity — Tier 1 (Native AST)

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Complexity analysis should work out of the box for the most common languages in this
project stack without requiring any installation, in order to lower the adoption barrier for teams that just want to know which functions are too complex. This enables immediate complexity visibility with no additional tooling required. Tier 1 bundles AST-based analysis for
TypeScript/JavaScript, Python, and Go — the three languages present in the xcape-inc
repositories. All four metrics (cyclomatic complexity, cognitive complexity, function
length, nesting depth) are computed from the AST using published algorithms. Deltas
are computed by the metrics layer against the previous run for the same function signature.
The spec-complexity ratio surfaces the gap between structural complexity and spec coverage.

## Acceptance Criteria

- [ ] TypeScript and JavaScript files are analysed using `@typescript-eslint/parser` AST walking; no external process required
- [ ] Python files are analysed by invoking a bundled Python AST script via subprocess; requires Python present but no pip install
- [ ] Go files are analysed using `go/parser` via a bundled Go helper; requires Go present but no `go install`
- [ ] When Python is not present, Python files are skipped with a structured `RUNTIME_NOT_FOUND` note (not an error)
- [ ] When Go is not present, Go files are skipped with a structured `RUNTIME_NOT_FOUND` note
- [ ] All four metrics collected per function: CC, cognitive complexity, function length (non-blank lines), nesting depth
- [ ] Parameter count collected per function
- [ ] **CC-1** (VIOLATION, tunable): Returns `VIOLATION` for each function exceeding CC threshold; reports function name, file, line, and CC value
- [ ] **CC-2** (WARNING, tunable): Returns `WARNING` for each function where CC > threshold but spec scenario count < CC; reports the gap
- [ ] **CC-3** (WARNING, tunable): Returns `WARNING` for each file where average CC exceeds file-level threshold
- [ ] **CC-4** (WARNING, tunable): Returns `WARNING` for each function where nesting depth exceeds threshold
- [ ] **CC-5** (WARNING, tunable): Returns `WARNING` for each function with parameter count exceeding threshold
- [ ] **CC-6 through CC-9** (WARNING): Delta trends computed when ≥3 prior runs exist for the same function; reports trend direction and magnitude
- [ ] `check_complexity` returns results grouped by file → function, sorted by CC descending
- [ ] Cognitive complexity uses the SonarSource algorithm (nesting penalty + structural increment)
- [ ] Spec scenario count for CC-2 is derived by counting Given/When/Then `Example:` blocks referencing the function name (exact and NLP match)
- [ ] Run completes in < 5 seconds for projects up to 500 source files

## ADR Required

Yes — **ADR-003**: Bundled AST walkers vs lizard-first approach. Decision needed on
whether Tier 1 should be the primary analysis path or whether lizard should be evaluated
as a universal fallback first.

## Requirements

- PRD Section 6, Code Quality Metrics (CC-1 through CC-9)
- PRD Section 6.1 (per-function metrics definition)
- PRD Section 6.2 (delta computation)
- PRD Section 7.1 (Tier 1 language/parser table)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | `@typescript-eslint/parser` is added as a dependency to `package.json`; it is not bundled inline | It is a published npm package with stable API; already present in many TS projects | `assumed` |
| A-002 | Cognitive complexity uses nesting increment of +1 per level and structural increment of +1 per control flow node, matching the published SonarSource specification | SonarSource published the algorithm; no deviation needed | `assumed` |
| A-003 | Python AST analysis is implemented as a small Python script embedded as a string in the MCP server and written to a temp file at runtime; not a standalone `.py` file in the repo | Keeps the tool self-contained; avoids requiring users to manage a Python file alongside the Node.js server | `assumed` |
| A-004 | Go analysis uses `go run` with a small embedded Go program; same pattern as Python | Consistent approach across Tier 1 language helpers | `assumed` |
| A-005 | Anonymous functions and arrow functions are included in the analysis and named by their assignment target or parent context (e.g., `const handleClick = () => {}` → `handleClick`) | Anonymous functions can have high CC; excluding them would miss real complexity | `assumed` |
