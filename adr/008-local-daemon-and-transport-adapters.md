# ADR-008: Local Daemon and Transport Adapters

## Status

Accepted

## Context

Intent artifact: [intent.md](../intent.md)

Features [F-24](../requirements.md), [F-25](../requirements.md), and [F-26](../requirements.md)
introduce three related requirements:

- `R-60`, `R-61`, `R-62`: support a long-lived local daemon without breaking stdio MCP mode
- `R-63`, `R-64`, `R-65`: expose the same tool contract through a local HTTP JSON API
- `R-66`, `R-67`, `R-68`: route daemon requests across multiple registered projects safely

The existing system already has a working MCP stdio server and a separate dashboard HTTP process,
but those entrypoints are not unified. Without an explicit decision, the codebase would drift
toward duplicated tool logic, ambiguous current-working-directory behavior in daemon mode, and
transport-specific result formats.

## Decision

Spec-check adopts one shared tool execution layer with multiple local transport adapters.

- `stdio` remains the default MCP compatibility mode
- a local daemon serves dashboard, health, project registry, and HTTP JSON tool endpoints
- both transports delegate to the same tool execution function and return the same envelope shape
- daemon-mode project targeting is explicit through canonical `path` resolution or registered `project_id`
- project registration is stored locally and treated as a routing concern, not as a remote service

## Consequences

- `npx spec-check` and MCP client command wiring now work through a real package binary
- non-MCP local callers can execute tools without JSON-RPC framing
- project identity becomes explicit in daemon mode, which avoids accidental cwd-dependent behavior
- the daemon remains local-only by default because it binds to loopback unless the user overrides it

## Alternatives Considered

### Keep stdio as the only supported transport

Rejected because it prevents generic local tooling, scripts, and non-MCP LLM runtimes from
interoperating with spec-check without an MCP host.

### Expose only the dashboard metrics over HTTP

Rejected because read-only HTTP does not solve tool execution for non-MCP clients and still
forces duplicated orchestration behavior elsewhere.

### Make daemon mode replace stdio mode

Rejected because MCP hosts expect a process they can own over stdio, and requiring a daemon
would make local MCP integration more brittle rather than simpler.

