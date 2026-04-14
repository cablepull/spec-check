# Story 030: Agent-Aware Metrics and Attribution

**Status:** Implemented
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

Once the server distinguishes agent roles and sessions, those distinctions should become
queryable in order to make process failures traceable to their origin and enable systematic improvement of multi-agent workflows. This enables metrics to answer not just which model produced a result, but which agent kind, session, and delegated worker path introduced a violation. Metrics must be able to answer not just which model produced a result, but which
agent kind, which session, and which delegated worker path produced process failures or
successful outcomes. This story extends the metrics layer from model attribution to agent-
aware workflow attribution.

## Acceptance Criteria

- [x] Persisted metrics records include agent/session identity fields required for attribution
- [x] Per-project metrics can surface missing or unknown agent attribution explicitly
- [x] Cross-project rollups can group results by `agent_kind` as well as `llm_model`
- [x] Session-aware queries can identify which agent introduced a violation or skipped required workflow steps
- [x] Protocol guidance can be differentiated by agent kind using stored and reported state

## ADR Required

Yes — see [ADR-006](../adr/006-workflow-governance-and-agent-state.md) for the workflow and attribution decision.

## Requirements

- PRD Section 11.1
- PRD Section 11.3
- Requirement R-57
- Requirement R-58
- Requirement R-59

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Agent-role rollups are useful even when some historical records lack agent metadata | The system will need to handle mixed historical data during rollout | `assumed` |
| A-002 | Unknown attribution should remain first-class in metrics outputs rather than being filtered out | Visibility of missing attribution is necessary to improve caller behavior and instrumentation coverage | `assumed` |
