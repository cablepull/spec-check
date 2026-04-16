# PRD: Feature F-1: Mcp Server Foundation

## Feature F-1: MCP Server Foundation

### Rule R-1: Validate The server starts and responds to protocol messages reliably
Example: Server starts with no arguments
  Given the server is invoked with `node dist/index.js`
  When the process starts
  Then it remains running and accepts MCP messages on stdio

Example: Unknown tool name returns structured error
  Given the server is running
  When a `tools/call` request names a tool that does not exist
  Then a structured error is returned with the unknown tool name
  And no unhandled exception is thrown

### Rule R-2: Validate LLM identity is resolved from available context
Example: Identity from tool argument
  Given a tool call includes `"llm": "claude-sonnet-4-5"`
  When the tool executes
  Then `claude-sonnet-4-5` is attached to the response metadata

Example: Identity falls back to unknown
  Given no `llm` argument, no `SPEC_CHECK_LLM` env var, and no global config value
  When any tool executes
  Then `unknown` is attached to the response metadata and stored in Parquet

---
