# Story 029: Agent Identity and Session Tracking

**Status:** Implemented
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

LLM identity alone is insufficient once multiple cooperating agents participate in a workflow.
Spec-check must distinguish planner, implementer, reviewer, human, and CI actors in order to provide meaningful attribution, auditability, and tailored workflow guidance — it must preserve
session boundaries and attribute state and persisted results to the right caller instance.
Without this, workflow guidance, auditing, and metrics attribution collapse into a single
undifferentiated model label.

## Acceptance Criteria

- [x] Common tool inputs accept `agent_id`, `agent_kind`, `parent_agent_id`, `session_id`, and `run_id`
- [x] The server exposes `begin_session`, `report_agent_state`, `list_agent_state`, and `close_session`
- [x] The server preserves distinct state for multiple agents using the same model in the same session
- [x] Parent-child delegation is captured when `parent_agent_id` is supplied
- [x] Persisted workflow-relevant records include agent and session identity fields
- [x] Missing agent identity remains visible as `unknown` or `null`, never silently omitted

## ADR Required

Yes — see [ADR-006](../adr/006-workflow-governance-and-agent-state.md) for the agent/session identity decision.

## Requirements

- PRD Section 10.4.1
- PRD Section 10.4.2
- Requirement R-57
- Requirement R-58
- Requirement R-59

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Agent identity is primarily caller-supplied; the server should not attempt to infer planner vs implementer roles heuristically | The caller is the only reliable source of the execution role in a multi-agent session | `assumed` |
| A-002 | `session_id` spans cooperating agents working toward one user-visible goal, while `run_id` identifies a narrower subtask or attempt | This separation keeps attribution useful for both long sessions and fine-grained retries | `assumed` |
