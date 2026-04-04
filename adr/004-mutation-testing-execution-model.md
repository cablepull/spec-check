# ADR-004: Mutation Testing Execution Model

## Status

Accepted

## Context

Story [015](../stories/015-mutation-testing.md) requires a decision on how mutation testing
fits into `spec-check`. Mutation testing is valuable because it measures whether tests
constrain behavior rather than merely execute code, but it is also substantially slower than
the main gate checks.

The unresolved questions in the story are:

- whether mutation testing is a blocking gate or a tracked quality metric
- what the default trigger should be
- how `pre_merge` context is detected
- whether mutation runs happen synchronously or in the background

The PRD already leans strongly toward one model: mutation testing is outside the standard gate
flow, default trigger is `pre_merge`, and scheduled execution is managed externally.

## Decision

Mutation testing is not a blocking gate in v1. It is a tracked code-quality metric with
structured criteria and persisted historical results.

The execution model is:

- default trigger is `pre_merge`
- direct tool invocation always counts as `on_demand`
- scheduled triggers such as `nightly` and `weekly` are configured in `spec-check` but executed
  by external schedulers or CI, not by an internal background worker
- mutation runs execute synchronously within the request-response lifecycle
- `pre_merge` context is detected via CI and merge-related environment signals rather than
  requiring an internal git-hook framework
- incremental mode is used when the underlying tool supports it

## Consequences

- Standard gate checks stay fast and predictable.
- Mutation results still contribute meaningful quality signals and trends over time.
- The MCP tool surface remains simple because it does not need internal job scheduling,
  polling, or background process management.
- CI and merge pipelines become the natural operational home for the default mutation trigger.
- Large projects may still experience long mutation runs, but that cost is isolated from the
  core gate-enforcement loop.

## Alternatives Considered

### Make mutation testing a blocking gate

Rejected because the PRD explicitly treats it as too expensive for the standard gate flow and
because it would harm the latency expectations of the main workflow.

### Background execution managed by spec-check

Rejected because the MCP request-response model does not provide a clean polling or job-control
story in v1, and internal job management would add substantial architectural complexity.

### Pre-commit as the default trigger

Rejected because it is too expensive for many codebases and would create unnecessary local
developer friction.
