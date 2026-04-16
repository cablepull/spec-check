# Story 031: Local Daemon Runtime

**Status:** Implemented
**Created:** 2026-04-15
**Author:** GPT-5

## Intent

The MCP stdio server is sufficient for a single client, but it is not sufficient when a dashboard, scripts, and multiple local callers need to interact with the same runtime independently. The problem is that stdio ownership belongs to one client process at a time, which makes shared local access impossible. This enables `spec-check` to stay MCP-compatible while also running as a long-lived local daemon for dashboard and API access.

## Acceptance Criteria

- [x] `spec-check server` starts a long-lived local daemon without requiring an MCP client to own stdio
- [x] The daemon exposes `GET /health` and reports the active host and port
- [x] The daemon binds to loopback by default rather than exposing a remote interface implicitly
- [x] MCP stdio mode remains available when `spec-check` runs without a subcommand
- [x] MCP and daemon modes call the same shared tool execution layer

## ADR Required

Yes — see [ADR-008](../adr/008-local-daemon-and-transport-adapters.md) for the daemon and transport decision.

## Requirements

- Requirement R-60
- Requirement R-61
- Requirement R-62

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Local callers prefer loopback HTTP over attaching to another process's stdio | This preserves MCP compatibility while enabling multiple local clients | `assumed` |
| A-002 | The daemon can share the existing dashboard process rather than introducing a second long-lived runtime | A single local server reduces drift and operational overhead | `assumed` |
