# PRD: Feature F-22: Workflow Governance

## Feature F-22: Workflow Governance

### Rule R-54: Validate the MCP returns machine-readable next-action guidance after workflow-relevant tool calls
Example: Next action after a passing gate
  Given a gate check completes without BLOCK or VIOLATION
  When the response is returned
  Then it includes a `workflow.must_call_next` field
  And the field names the next required check or workflow action

Example: Next action when the workflow is blocked
  Given a gate check or prerequisite validator returns BLOCK
  When the response is returned
  Then `workflow.blocked` is `true`
  And `workflow.blocked_by` lists the unmet prerequisite

### Rule R-55: Validate the MCP indicates when metrics should be run
Example: Metrics due after implementation-oriented work
  Given an agent has reported changed implementation files
  When `get_next_action` is called
  Then the response includes `should_call_metrics: true`
  And the response explains why metrics are due

Example: Metrics not due during early spec authoring
  Given the workflow is still in intent or requirements drafting
  When `get_next_action` is called
  Then `should_call_metrics` is `false`

Example: Metrics guidance is absent from a workflow response
  Given a workflow-relevant tool response omits the `workflow.should_call_metrics` field
  When the caller inspects the response
  Then the response is rejected as incomplete
  And the omission is reported as a workflow contract failure

### Rule R-56: Validate the MCP can request explicit agent state instead of assuming hidden model state
Example: Agent reports current state
  Given an agent has an `agent_id`
  When `report_agent_state` is called with goal, phase, changed paths, and open violations
  Then the server persists that state
  And subsequent workflow decisions use the reported state

Example: Workflow response requires state reporting
  Given a workflow-relevant tool call completes
  When the response is returned
  Then the `workflow` block includes `must_report_state`
  And that field is `true` when the server requires an explicit state update

---
