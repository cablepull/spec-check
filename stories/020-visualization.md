# Story 020: Visualization Layer

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

The problem is that numbers in isolation are hard to act on — this enables trend, magnitude, and priority to be communicated at a glance in a format every LLM client can consume. An LLM reading a compliance score of 67% does
not know if that is good, bad, improving, or stagnant without context. The visualization
layer turns raw metrics into formats that communicate trend, magnitude, and priority at
a glance — in the terminal, in a chat interface, and in markdown-rendered environments.
All three formats (text, JSON, Mermaid) must be consumable by an LLM without additional
parsing. The ASCII renderings must be readable in a monospace terminal with no dependencies.

## Acceptance Criteria

**ASCII text output (all metric tools):**
- [ ] Gate timeline: sparkline per gate showing pass/fail symbols across the last 14 runs (e.g. `✓✓✗✓✓✓✗✓✓✓✓✓✓✓`)
- [ ] Violation frequency: horizontal bar chart with criterion IDs on the left, bar length proportional to occurrence count, count shown at the right
- [ ] Complexity heatmap: table with columns (File, Function, CC, Cognitive, Length, Nesting, Δ), sorted by CC descending, delta shown with `↑`/`↓`/`→` and magnitude
- [ ] Cross-project compliance ranking: ranked table with project name, compliance score, and a mini bar (`████░░░░░░`) for each
- [ ] Model comparison: side-by-side table, one column per model, rows for each gate, cells show pass rate %
- [ ] Mutation score trend: sparkline over last 10 runs with score shown at each point
- [ ] Assumption invalidation board: table with artifact, model, assumption text (truncated to 60 chars), category, days to invalidation
- [ ] All ASCII tables have a fixed max width of 120 characters; text is truncated with `…` not wrapped

**Mermaid output:**
- [ ] Gate pass rates over time: `xychart-beta` with one line per gate
- [ ] Complexity trend: `xychart-beta` with CC and cognitive complexity lines
- [ ] Mutation score trend: `xychart-beta` single line
- [ ] Assumption categories: `pie` chart
- [ ] Traceability graph: `graph LR` from Story → Requirement → Task → Test
- [ ] All Mermaid diagrams are valid syntax (verified against Mermaid 10.x spec)

**JSON output:**
- [ ] Every metric tool's JSON format is documented in `get_protocol` with a schema excerpt
- [ ] JSON is always pretty-printed with 2-space indentation
- [ ] Arrays are never truncated in JSON format even if they are in text format

**Cross-cutting:**
- [ ] `format` parameter on every metric tool accepts `text`, `json`, `mermaid`; default is `text`
- [ ] When `format: mermaid` is requested for a tool that has no Mermaid view defined, returns a `FORMAT_NOT_SUPPORTED` error with a suggestion to use `text` or `json`
- [ ] Delta indicators use Unicode: `↑` for increase, `↓` for decrease, `→` for stable; always followed by the magnitude (e.g. `↑3`, `↓0.5`)

## ADR Required

No — visualization is output formatting with no new architectural dependency.

## Requirements

- PRD Section 11 (Visualization — formats and available views table)
- PRD Section 13.7 (common input schema including `format` parameter)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | ASCII charts use only characters from the basic Latin and box-drawing Unicode blocks; no colour codes — colour is not reliable in all LLM client interfaces | Some MCP clients render ANSI codes; others do not; plain text is universally safe | `assumed` |
| A-002 | Sparklines use the fixed symbol set `✓` (pass), `✗` (fail/violation), `△` (warning), `·` (no data); length capped at 14 entries (2 weeks of daily runs) | Longer sparklines lose readability; 14 is sufficient to show trend | `assumed` |
| A-003 | Mermaid diagrams target Mermaid 10.x syntax; the version is noted in the output header comment so consumers know the target renderer version | Mermaid syntax has changed between major versions; explicit version prevents confusion | `assumed` |
| A-004 | The traceability Mermaid graph shows only the current state (not historical); nodes are stories, requirements, tasks, and test files; edges show the trace links | Historical traceability graphs would be very large; current state is the actionable view | `assumed` |
