# RCA-005: Identity Fallback to "unknown" Was Silent

## Summary

When an agent called any spec-check tool without providing a model identifier — and no
`SPEC_CHECK_LLM` environment variable or `default_llm` project config was present — the
server silently stored and returned `llm_id: "unknown"` with no signal to the caller that
identity attribution was missing. The agent had no way to know it needed to supply its
model name, so records accumulated under "unknown" in metrics and Parquet storage with no
corrective path.

## Root Cause

`resolveIdentity` in `src/identity.ts` correctly implements the four-level priority chain
but returns a silent fallback object on failure:

```ts
return { provider: "unknown", model: "unknown", id: "unknown", source: "fallback" };
```

The `source: "fallback"` field was set but never used downstream. The `envelope` function
in `src/index.ts` did not inspect `llm_source` and therefore never communicated the
unresolved state back to the caller. Every tool response looked identical whether identity
was known or not.

## Violated Requirement

R-2 — LLM identity is resolved from available context.

"Identity is attached to every stored result and response envelope." A silent "unknown"
satisfies the letter of the rule but not its intent: the agent must be informed when its
identity cannot be resolved so it can correct the call.

## Resolution

Added a `request_identity` block to the response envelope whenever `llm_source` is
`"fallback"`. The block includes:

- A plain-language message explaining the problem
- The exact argument name (`llm`) the agent must add
- An example value (`claude-sonnet-4-5`)
- The three priority sources for identity resolution

`llm_source` is now also surfaced in `meta` so callers can programmatically detect the
fallback condition without parsing the message string.

The check is in `envelope()` so it covers every tool response without requiring per-tool
changes.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- The `request_identity` block is informational only; the current tool call still completes
  and returns its result. Blocking on unknown identity would break CI pipelines and
  scripted use where the env var or config is the intended source of truth.
- Returning `request_identity` on every response with unknown identity (not just the first)
  is intentional — each response is independently consumable by an agent that may not have
  seen a prior response.
