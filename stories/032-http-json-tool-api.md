# Story 032: HTTP JSON Tool API

**Status:** Implemented
**Created:** 2026-04-15
**Author:** GPT-5

## Intent

Not every caller can speak MCP, and local automation should not need to emulate an MCP host just to invoke `spec-check`. The problem is that non-MCP clients need a stable machine-readable interface for tool discovery and execution. This enables any local LLM agent, script, CI helper, or editor integration to call the same tools through a local JSON contract without forking core behavior from MCP.

## Acceptance Criteria

- [x] The daemon exposes a machine-readable tool catalog at `GET /api/tools`
- [x] `POST /api/tools/call` executes tools with the same `data`, `meta`, and `workflow` envelope used by MCP
- [x] Unknown tools and malformed requests return structured errors rather than partial execution
- [x] Actor metadata supplied over HTTP is merged consistently with explicit tool arguments
- [x] The HTTP API and MCP adapter stay aligned because both use the same tool definitions and executor

## ADR Required

Yes — see [ADR-008](../adr/008-local-daemon-and-transport-adapters.md) for the transport-neutral runtime decision.

## Requirements

- Requirement R-63
- Requirement R-64
- Requirement R-65

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | A local JSON API is enough for non-MCP interoperability before any remote transport is added | Scripts and local agent frameworks can consume HTTP JSON directly | `assumed` |
| A-002 | Explicit tool arguments should win over actor metadata when both identify the model | This avoids hidden metadata overriding caller intent | `assumed` |
