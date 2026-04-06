# ADR-006: Workflow Governance and Agent State

## Status

Accepted

## Context

Stories [028](../stories/028-workflow-governance.md), [029](../stories/029-agent-identity-and-session-tracking.md),
and [030](../stories/030-agent-aware-metrics-and-attribution.md) extend spec-check beyond
artifact validation. The server now needs to:

- return machine-readable workflow obligations after workflow-relevant tool calls
- request explicit caller state rather than inferring hidden model progress
- distinguish cooperating agents that may share the same model but play different roles
- persist agent and session identity on workflow-relevant records for attribution and metrics

These changes affect the response contract, session model, and persisted analytics shape. They
should be recorded explicitly so future work does not collapse them back into model-only
metadata or prompt-only guidance.

## Decision

Spec-check adopts workflow governance and explicit agent state as first-class protocol concepts.

Response contract:

- workflow-relevant responses include a machine-readable `workflow` block
- the `workflow` block carries next-action guidance, metric obligations, and block reasons
- callers are expected to report explicit workflow state through dedicated session tools

Actor identity:

- caller attribution uses `agent_id`, `agent_kind`, `parent_agent_id`, `session_id`, and `run_id`
- these fields are persisted on workflow-relevant records when available
- missing attribution remains explicit as `unknown` or `null`

State model:

- the server stores caller-reported workflow state instead of inferring hidden model state
- session tools are the canonical mechanism for beginning, updating, listing, and closing agent state
- metrics and dashboards may group by agent and agent kind in addition to model identity

## Consequences

- autonomous callers can follow deterministic workflow guidance instead of relying on prose alone
- multi-agent sessions remain auditable even when several agents share one model family
- metrics can identify which agent or role introduced violations or skipped expected checks
- workflow policy becomes part of the public contract and must remain backward-compatible

## Alternatives Considered

### Prompt-only workflow guidance

Rejected because prose instructions are weaker than machine-readable obligations for autonomous
clients that need reliable next-step behavior.

### Model-only attribution

Rejected because it cannot distinguish planner, implementer, reviewer, CI, or delegated worker
paths within the same session.

### Infer caller progress from repository state alone

Rejected because many workflow decisions depend on intent, phase, and changed-file scope that
the server cannot derive reliably without explicit state reporting.
