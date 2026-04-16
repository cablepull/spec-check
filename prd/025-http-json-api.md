# PRD: Feature F-25: HTTP JSON Tool API

## Feature F-25: HTTP JSON Tool API for Non-MCP Clients

### Rule R-63: Validate the daemon exposes a machine-readable tool catalog over HTTP
Example: Tool list is discoverable without MCP
  Given the daemon is running
  When `GET /api/tools` is called
  Then the response lists available tool names, descriptions, and input schemas
  And the schemas are sufficient for a generic client to construct valid requests

Example: Tool catalog stays aligned with MCP definitions
  Given the MCP tool registry contains a published tool definition
  When the HTTP tool catalog is queried
  Then that tool also appears in the HTTP response
  And the published input schema matches the MCP schema

Example: Unsupported endpoint is rejected
  Given the daemon is running
  When a client requests an undefined HTTP API path
  Then the response returns `404`
  And no tool execution occurs

### Rule R-64: Validate HTTP tool execution uses the same contract as MCP tool execution
Example: HTTP client calls `run_all`
  Given the daemon is running
  When `POST /api/tools/call` is sent with tool `run_all` and valid arguments
  Then the response contains the same `data`, `meta`, and `workflow` envelope used by MCP
  And the tool result is persisted in storage

Example: Unknown tool returns structured error
  Given the daemon is running
  When `POST /api/tools/call` names a tool that does not exist
  Then the response returns a structured unknown-tool error
  And no partial tool execution occurs

Example: Missing request tool name is rejected
  Given the daemon is running
  When `POST /api/tools/call` omits the `tool` field
  Then the response returns a structured request error
  And the server does not infer a tool name implicitly

### Rule R-65: Validate actor metadata can be supplied consistently over HTTP
Example: HTTP client supplies provider and model identity
  Given a non-MCP caller payload contains `provider`, `model`, `agent_id`, and `session_id`
  When a tool is executed over HTTP
  Then those fields are attached to response metadata
  And they are persisted in the resulting metrics records

Example: Missing actor metadata remains visible
  Given an HTTP tool payload has no actor metadata
  When the tool executes
  Then the response stores missing identity as `unknown` or `null`
  And the omission is not silently hidden

Example: Actor metadata does not overwrite explicit tool arguments
  Given an HTTP tool payload contains `arguments.llm = "gpt-5"`
  And the actor block contains `model = "claude-sonnet-4-5"`
  When the tool executes
  Then the persisted identity uses `gpt-5`
  And the actor block does not override explicit arguments

---
