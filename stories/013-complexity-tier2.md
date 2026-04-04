# Story 013: Code Complexity — Tier 2 (lizard and Companions)

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Tier 1 covers the three languages most common in this project stack. Everything else —
Java, C, C++, C#, Ruby, Swift, Rust, Scala, Kotlin — needs a different path. Lizard is
the right tool: one CLI, 27+ languages, machine-readable output, fast. Tier 2 integrates lizard and
its companion tools, handles the metrics they cannot provide (cognitive complexity and
nesting depth for non-Tier-1 languages), reports those gaps honestly, and ensures that
complexity data flows into the same metrics store regardless of which tier produced it.
The tool must never silently omit data — if a metric is unavailable for a language, it
says so explicitly and explains what would enable it.

## Acceptance Criteria

- [ ] `check_complexity` detects which languages are present in the project and routes each to Tier 1 or Tier 2 automatically
- [ ] For Tier 2 languages, lizard is invoked with a supported machine-readable output format; output is parsed into the standard per-function metrics schema
- [ ] CC and function length are populated for all lizard-supported languages
- [ ] Cognitive complexity and nesting depth are set to `null` for Tier 2 languages; each null value is accompanied by `unsupported_reason: "lizard does not provide cognitive complexity for <language>"` in the output
- [ ] When lizard is not installed, Tier 2 analysis is skipped; a structured `DEPENDENCY_MISSING` result is returned for each affected file with the install command
- [ ] CC-1 through CC-5 criteria run on all metrics that are available; criteria that depend on `null` metrics are skipped with a note
- [ ] CC-6 (CC delta trend) still runs for Tier 2 languages because CC is available; CC-7 (cognitive delta) is skipped for Tier 2 with explanation
- [ ] All Tier 2 results flow into the same Parquet schema as Tier 1 results; `null` values stored as SQL NULL
- [ ] `check_dependencies` reports lizard and companion tool status before any Tier 2 analysis runs (see Story 014)
- [ ] Run time for Tier 2 analysis does not exceed 10 seconds for projects with up to 200 non-Tier-1 source files

## ADR Required

Yes — **ADR-003** (same as Story 012): Bundled AST walkers vs lizard-first. Both stories
depend on this decision being resolved before implementation begins.

## Requirements

- PRD Section 7.2 (Tier 2 language/metric table)
- PRD Section 6.3 (CC criteria — which apply to which tiers)
- PRD Section 8.1 (dependency registry — lizard entry)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Tier routing is per-file based on extension, not per-project; a monorepo with both TypeScript and Java files uses Tier 1 for `.ts` and Tier 2 for `.java` | Monorepos are explicitly supported; mixed-language projects are the common case | `assumed` |
| A-002 | Lizard's supported machine-readable output format is stable across the versions it will be invoked against; version is checked on startup and warned if below minimum tested version | Lizard is actively maintained; output adapters can be version-gated if the CLI changes | `assumed` |
| A-003 | Nesting depth is not available from lizard for any language; it is `null` for all Tier 2 languages in v1 | Lizard does not report nesting depth natively; a custom implementation per language would be a significant scope increase | `assumed` |
