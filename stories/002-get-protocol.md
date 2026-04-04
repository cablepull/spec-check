# Story 002: get_protocol — Self-Description

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

An LLM connecting to spec-check for the first time has no guarantee its training data
reflects the current version of the methodology. If the protocol evolves and the LLM
operates on stale knowledge, enforcement becomes inconsistent — the very problem spec-check
exists to solve. `get_protocol` makes the tool its own source of truth. Any LLM calls it
once at the start of a session and has everything needed to follow the methodology correctly:
every gate, every criterion, every artifact contract, the assumption format, and explicit
guidance on which tool to call at each workflow stage.

## Acceptance Criteria

- [ ] `get_protocol` is the first tool in the `tools/list` response
- [ ] Returns all five gates with their criteria (ID, description, method, severity, tunable flag)
- [ ] Returns all artifact contracts (intent, requirements, design, tasks, story, ADR, RCA) with required sections listed
- [ ] Returns the assumption table format with an example
- [ ] Returns the supersession flow as a numbered sequence
- [ ] Returns tool-call guidance: which tool to call at each workflow stage and why
- [ ] Returns current active thresholds for all tunable criteria
- [ ] Supports `format: text | json | markdown` — defaults to `text`
- [ ] JSON format is schema-valid and machine-parseable without post-processing
- [ ] Protocol includes a `protocol_version` field that increments when criteria change
- [ ] Response includes `generated_at` timestamp so the LLM knows when it was retrieved
- [ ] Tool-call guidance explicitly states: "Call `get_protocol` at the start of every new session"

## ADR Required

Yes — **ADR-005**: Protocol format and versioning strategy. Decisions needed: how
`protocol_version` increments (semver vs integer), whether the protocol is embedded
in the binary or loaded from a file (impacts upgradeability), and how an LLM detects
a protocol change between sessions.

## Requirements

- PRD Section 2, Principle 8 (self-describing)
- PRD Section 13.1 (`get_protocol` tool specification)
- PRD Open Question 7 (protocol versioning)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Protocol content is embedded in the server binary, not loaded from an external file | Simplest approach; external file would require path management; not specified in PRD | `assumed` |
| A-002 | `protocol_version` is a monotonically incrementing integer, not semver | Easier for LLMs to compare (`if current > cached`) than semver string comparison | `assumed` |
| A-003 | Tool-call guidance is static prose, not dynamically computed from project state | Dynamic guidance would require a `path` argument and project scan; adds complexity not requested | `assumed` |
| A-004 | `get_protocol` does not require a `path` argument | Protocol is universal, not project-specific | `assumed` |
