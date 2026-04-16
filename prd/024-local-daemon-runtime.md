# PRD: Feature F-24: Local Daemon Runtime

## Feature F-24: Local Daemon Runtime

### Rule R-60: Validate spec-check can run as a long-lived local daemon independent of one MCP client
Example: Daemon starts and exposes local health
  Given `spec-check server` is the configured daemon command
  When the process binds its local control port
  Then the process remains running until stopped explicitly
  And `GET /health` returns `ok: true`
  And the response includes the bound host and port

Example: Dashboard and tool API share one runtime
  Given the daemon is running
  When a browser loads the dashboard
  And a separate client calls the JSON tool API
  Then both requests succeed without requiring ownership of stdio
  And neither request interrupts the other

Example: Daemon startup fails to bind the requested port
  Given the daemon configuration specifies a port that cannot be bound
  When startup is attempted
  Then a structured startup error is reported
  And no partial daemon state is left running

### Rule R-61: Validate the daemon remains local-only by default
Example: Default bind is loopback only
  Given the daemon configuration has no host override
  When it begins listening
  Then it binds only to `127.0.0.1` or another loopback address
  And no remote interface is exposed by default

Example: Explicit non-local bind is surfaced as configuration
  Given the daemon configuration specifies a non-loopback host
  When the daemon reports startup state
  Then the active host is shown explicitly
  And the response indicates that the runtime is no longer local-only

Example: Remote-by-default bind is rejected
  Given the daemon configuration has no host override
  When startup completes
  Then the daemon does not bind to `0.0.0.0`
  And remote interfaces remain disabled by default

### Rule R-62: Validate stdio MCP mode remains supported alongside daemon mode
Example: MCP stdio mode remains available
  Given `node dist/index.js` is the configured MCP entrypoint
  When it sends MCP `initialize` and `tools/list`
  Then the server responds over stdio as before
  And no daemon process is required for MCP compatibility

Example: Shared core behavior across runtimes
  Given `run_all` is invoked once through MCP stdio and once through the daemon API
  When both calls use the same project path and arguments
  Then both responses use the same result envelope shape
  And both persist equivalent metrics records

Example: Daemon mode does not replace MCP stdio mode
  Given the daemon is already running for dashboard access
  When another caller invokes `spec-check` with no subcommand for MCP
  Then the MCP server still starts over stdio
  And the daemon does not become a required prerequisite

---
