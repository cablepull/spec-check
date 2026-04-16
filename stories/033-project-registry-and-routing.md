# Story 033: Project Registry and Routing

**Status:** Implemented
**Created:** 2026-04-15
**Author:** GPT-5

## Intent

A shared local daemon becomes ambiguous as soon as it needs to serve more than one repository. The problem is that implicit current-working-directory resolution does not scale to multiple registered projects or multiple callers. Project routing must stay explicit, and daemon requests should only infer a target path when exactly one registered project is available. This enables stable project registration, explicit routing by `project_id`, and project-scoped state so one repository does not overwrite or confuse another.

## Acceptance Criteria

- [x] Local repositories can be registered by canonical path and stable name
- [x] The daemon can list registered projects and resolve tool calls by `project_id`
- [x] Ambiguous requests are rejected when multiple projects are registered and no target is supplied
- [x] Unknown `project_id` values return structured errors
- [x] Metrics and workflow state remain project-scoped when the same model or session IDs are reused across projects

## ADR Required

Yes — see [ADR-008](../adr/008-local-daemon-and-transport-adapters.md) for the project-routing decision.

## Requirements

- Requirement R-66
- Requirement R-67
- Requirement R-68

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Canonical path resolution is sufficient to prevent accidental duplicate registrations for the same local repository | Equivalent filesystem paths should collapse to one registry entry | `assumed` |
| A-002 | Explicit project targeting is preferable to silently inferring a project from daemon process state | Shared local runtimes need deterministic routing rules | `assumed` |
