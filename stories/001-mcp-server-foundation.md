# Story 001: MCP Server Foundation

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Every other capability in spec-check depends on a running MCP server that correctly
implements the MCP protocol, handles errors gracefully, records the calling LLM's identity
on every request, and starts reliably across platforms. Without a solid foundation, every
subsequent story is unstable. This story delivers the skeleton everything else is bolted to, in order to ensure every subsequent capability rests on a reliable, tested base. This enables stable, predictable gate enforcement for all downstream stories.

## Acceptance Criteria

- [ ] Server starts via `node dist/index.js` with no arguments and remains running
- [ ] `tools/list` returns the full tool inventory with names and descriptions
- [ ] Any unrecognised tool name returns a structured error, never an unhandled exception
- [ ] Any tool call missing required arguments returns a structured error with the missing field named
- [ ] LLM identity is resolved in priority order: tool argument → `SPEC_CHECK_LLM` env var → global config → `unknown`
- [ ] Resolved LLM identity is attached to every tool response as metadata
- [ ] Server version is included in every response envelope
- [ ] `path` argument defaults to `process.cwd()` when omitted on any tool
- [ ] If the resolved path does not exist, the tool returns a structured `PATH_NOT_FOUND` error
- [ ] All errors are structured objects — no raw stack traces returned to the caller

## ADR Required

No — standard MCP stdio server using the established SDK. No architectural decision required.

## Requirements

Implements the infrastructure prerequisite for all criteria in PRD Sections 5, 6, 7, 8,
9, 10, and 13. Directly enables:
- LLM identity resolution (PRD Section 10.4)
- Common input schema for all tools (PRD Section 13.7)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | TypeScript with ESM modules is the implementation language | PRD specifies Node.js ≥ 18; TypeScript already present in `package.json`; no explicit language choice stated | `assumed` |
| A-002 | stdio transport is the only transport needed for v1 | MCP stdio is universal for local LLM clients; HTTP transport not mentioned in PRD | `assumed` |
| A-003 | Server version is taken from `package.json` `version` field | Standard Node.js convention; not specified in PRD | `assumed` |
