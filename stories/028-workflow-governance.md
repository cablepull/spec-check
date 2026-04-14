# Story 028: Workflow Governance

**Status:** Implemented
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

Spec-check should do more than return isolated pass/fail results, because prose-only guidance is ambiguous and leads to inconsistent enforcement across LLM callers. This enables autonomous agents to follow the methodology deterministically from machine-readable obligations rather than inferred instructions. It should actively govern
the workflow by telling the caller what to do next, when the workflow is blocked, and when
metrics should be run. The server must express this guidance in machine-readable form so an
LLM can follow the process deterministically instead of inferring it from prose alone.

## Acceptance Criteria

- [x] Workflow-relevant tool responses include a machine-readable `workflow` block
- [x] The `workflow` block includes `must_call_next`, `should_call_metrics`, `must_report_state`, `blocked`, and `blocked_by`
- [x] The server computes next-action guidance from current project status plus reported agent state
- [x] The server requests explicit state reports when workflow policy depends on caller progress that cannot be derived from artifacts alone
- [x] Metric obligations are returned only when appropriate for the current phase and changed-file scope

## ADR Required

Yes — see [ADR-006](../adr/006-workflow-governance-and-agent-state.md) for the workflow-governance and agent-state contract.

## Requirements

- PRD Section 13.6.1
- Requirement R-54
- Requirement R-55
- Requirement R-56

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Machine-readable workflow guidance is more reliable than prompt prose for autonomous callers | The feature is explicitly intended to steer LLM behavior during MCP-driven sessions | `assumed` |
| A-002 | Metrics should be policy-driven and phase-aware rather than triggered after every tool call | Running complexity and mutation checks on every step would create noise and unnecessary latency | `assumed` |
