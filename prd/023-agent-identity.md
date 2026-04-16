# PRD: Feature F-23: Agent Identity

## Feature F-23: Agent Identity and Session Attribution

### Rule R-57: Validate the MCP distinguishes agents of the same or different kinds
Example: Two implementer agents in one session
  Given two callers use the same model but different `agent_id` values
  When both report state in the same `session_id`
  Then the server stores them as distinct agents
  And their state histories do not overwrite each other

Example: Parent-child agent relationship is recorded
  Given an implementer agent is delegated work by a planner agent
  When the implementer reports state with `parent_agent_id`
  Then the stored state links the implementer to the planner

### Rule R-58: Validate agent and session identity are attached to persisted records
Example: Check record includes agent metadata
  Given a workflow-aware tool call is made with `agent_id`, `agent_kind`, and `session_id`
  When the resulting record is persisted
  Then the Parquet record includes those identity fields
  And they are queryable in metrics and rollups

Example: Missing agent metadata remains visible
  Given a tool call omits agent metadata
  When the resulting record is persisted
  Then the missing fields are stored as `unknown` or `null`
  And the omission is not silently hidden

### Rule R-59: Validate the MCP exposes agent-session workflow tools
Example: Session start
  Given a caller wants to begin governed work on a project
  When `begin_session` is called
  Then the response returns the initial workflow obligations for that agent

Example: Session state listing
  Given multiple agents have reported state for a project session
  When `list_agent_state` is called
  Then the response lists each agent with its latest known phase and summary

---
