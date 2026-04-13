# RCA-006: Workflow Guidance Chained gate_check Calls Instead of run_all

## Summary

The `must_call_next` workflow guidance produced by `computeWorkflowGuidance` in
`src/workflow.ts` directed agents to call `gate_check:G1` → `gate_check:G2` →
`gate_check:G3` → `gate_check:G4` → `gate_check:G5` one at a time. Every agent that
followed the guidance ran five separate tool calls instead of one `run_all` call.

Parquet storage confirmed no `triggeredBy: "run_all"` records in the project history —
only individual `gate_check` records — despite `run_all` being the canonical entry point
documented throughout the protocol and server instructions.

## Root Cause

The `mustCallNext` chain in `computeWorkflowGuidance` was written to advance one gate at a
time after each passing result:

```ts
: state.last_completed_check === "G1" ? ["gate_check:G2"]
: state.last_completed_check === "G2" ? ["gate_check:G3"]
: state.last_completed_check === "G3" ? ["gate_check:G4"]
: state.last_completed_check === "G4" ? ["gate_check:G5"]
```

`gate_check` is intended for targeted re-checks after fixing a single gate violation, not
for initial sweeps. But because the guidance chain made each passing gate recommend the
next individual gate, agents never had a signal to switch to `run_all`. The first time an
agent called `gate_check:G1` (which the phase-based logic correctly suggests when only
intent.md is missing), it was then locked into individual checks for the rest of the run.

## Violated Requirement

R-28 — The MCP returns machine-readable next-action guidance after workflow-relevant tool
calls.

The guidance was machine-readable but semantically incorrect: it recommended a more
expensive, more fragmented workflow than necessary, causing systematic misuse of
`gate_check` in place of `run_all`.

## Resolution

Replaced the G1→G2→G3→G4 individual chain with a redirect to `run_all`:

```ts
: (state.last_completed_check === "G1" ||
   state.last_completed_check === "G2" ||
   state.last_completed_check === "G3" ||
   state.last_completed_check === "G4") ? ["run_all"]
: state.last_completed_check === "G5" ? ["metrics"]
: state.last_completed_check === "run_all" ? ["metrics"]
```

Phase-based suggestions (e.g. `phase === "intent" → gate_check:G1`) are retained because
when a specific artifact is missing, later gates would BLOCK immediately and `run_all`
would give no additional information over the targeted check.

The `run_all` handler now passes `"run_all"` as `last_completed_check` (previously `"G5"`)
so it correctly maps to `["metrics"]` in the guidance chain.

The default fallback case now returns `["run_all"]` instead of `[]` so agents with no
phase context are still directed to the correct starting point.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- `gate_check` remains useful for targeted re-checks after fixing a single violation and
  should not be removed or deprecated.
- The phase-based `gate_check:Gn` suggestions (when specific spec files are absent) remain
  correct because `run_all` would produce the same BLOCK with less focus.
