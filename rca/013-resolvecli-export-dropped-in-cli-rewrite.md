# RCA-013: `resolveCliCommand` Export Was Dropped During the CLI Rewrite

## Summary

The runtime-interoperability tests import `resolveCliCommand` from `src/cli.ts`
to verify that the default CLI mode routes to the MCP server and that the
`server` subcommand routes to the dashboard daemon. When the CLI was rewritten
in this session to expand from three subcommands to more than twenty — and to
route every MCP-backed subcommand through `executeToolRequest` — the
`resolveCliCommand` export was removed along with the old routing logic. One
test (`R-60 and R-62 route the default CLI command to MCP mode and the server
subcommand to daemon mode`) immediately failed with
`TypeError: resolveCliCommand is not a function`.

## Root Cause

The CLI rewrite focused on user-visible commands and did not treat the test
surface as load-bearing public API. Because the old `resolveCliCommand` helper
was a small pure function with no observable runtime dependency from the CLI
itself (the CLI's `main()` function inlines routing), it was assumed to be
internal plumbing and was deleted. The rewrite was not run against the full
test suite until after the new command set was complete, so the gap was caught
late rather than during the rewrite.

## Violated Requirement

- [R-60](../requirements.md) — default CLI invocation routes to MCP mode
- [R-62](../requirements.md) — `server` subcommand routes to daemon mode
- [R-63](../requirements.md) — shared runtime exposes the same tool catalog regardless of transport
  (the test file that imports `resolveCliCommand` also exercises R-63)

## Resolution

- Reintroduced `resolveCliCommand(argv)` as a typed export returning
  `{ mode: "mcp" | "server", rest: string[] }` with explicit cases for the
  empty argv, `server`/`dashboard`, and the fallback that treats every other
  subcommand as `mcp` routing for external callers that only care about the
  top-level split.
- Kept the full subcommand dispatch inside `main()` so the CLI rewrite's
  simplification is preserved; `resolveCliCommand` is now a thin adapter for
  external consumers.
- Added five additional test cases around the `query` tool and CLI routing
  (`tests/runtime-interoperability.test.ts`) to harden the public test surface
  against similar regressions.

## Spec Update Required

No — R-60/R-62/R-63 already encoded the intended contract.

## ADR Required

No — the decision to have a public `resolveCliCommand` helper predates this
session and was reaffirmed rather than changed. The existing ADR for the
runtime split (ADR-008) remains the reference.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-013-1 | Any symbol imported from `src/*.ts` by a file under `tests/` is part of the library's effective public API and must survive refactors | Established test-driven refactor discipline in this project | `assumed` |
| A-013-2 | Running `npm test` after every non-trivial refactor is sufficient to catch dropped exports, since TypeScript compilation alone does not fail on missing test imports at production build time | Observed behaviour: `tsc` builds without tests in the compile graph succeed even when tests would fail | `assumed` |
