# ADR-013: Targeted Bottle Install Contents and Formula Test Hardening

## Status

Accepted

## Context

Triggering artifact: [intent.md](../intent.md); refines the Homebrew distribution decisions in ADR-010 based on observations from [RCA-011](../rca/011-duckdb-require-fails-outside-source-tree.md).

The Homebrew formula at `Formula/spec-check.rb` previously installed the
entire repository contents into `libexec` with `libexec.install Dir["*"]`.
That pattern ships the `.github/` directory, the `Formula/` directory itself,
the `tests/`, `src/`, `prd/`, `stories/`, `rca/`, and `adr/` directories, the
archive, and every configuration file — none of which is read at runtime.
The bottle archive was correspondingly larger than necessary and the bottle
contents conflated source with runtime artefacts in a way that made auditing
what the binary actually needs harder than it should be.

Separately, the formula's `test do` block only asserted `--version` and
`--help`. Both succeed even when the DuckDB native binding fails to load —
the CLI prints its version without touching storage. The regression in
RCA-011 (subprocess `require("duckdb")` failing in production) could in
principle have been caught by the bottle's own test block, but the existing
assertions were too shallow to exercise the broken code path.

References: R-72, R-73, and
[RCA-011](../rca/011-duckdb-require-fails-outside-source-tree.md)

## Decision

**Limit the bottle contents to the runtime surface.** The formula now
installs only three entries into `libexec`:

```ruby
libexec.install "dist", "node_modules", "package.json"
```

- `dist/` — compiled TypeScript (the CLI entry point and every handler).
- `node_modules/` — pruned with `npm prune --omit=dev`, retaining only the
  runtime deps and their transitive graph, including the `duckdb` package
  and its prebuilt `.node` binary.
- `package.json` — retained because `@mapbox/node-pre-gyp` (which duckdb uses
  internally to locate its `.node` binary) reads package metadata at runtime,
  and because future tooling may want to read the installed version.

**Add a DuckDB smoke assertion to `test do`.** The formula test now runs
`spec-check query "SELECT 42 AS answer"` and asserts the output contains
`"42"`. This exercises the full subprocess pipeline: spawning a node
subprocess, loading the duckdb native binding, running DuckDB, and returning
JSON.

**Only update the formula bottle block when every matrix build succeeded.**
The `update-formula` job's trigger is changed from
`if: always() && !cancelled() && needs.build.result != 'skipped'` to
`if: needs.build.result == 'success'`. A partial matrix failure (one platform
built but another did not) would otherwise commit a formula with incomplete
`sha256` entries, causing `brew install` to fall back to source builds for
users on the missing platform.

## Requirement Traceability

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
| R-72 | Brew tap installs binary | `Formula/spec-check.rb` install block (targeted) |
| R-72 | Binary functions end-to-end post-install | `test do` now exercises DuckDB |
| R-73 | Binary on path, caveats shown | Unchanged — shim and `caveats` preserved |

## Consequences

**Positive.** The bottle archive is smaller and clearly described: the
install block enumerates every path that ships, and everything else is
excluded by omission rather than by implicit filtering. The DuckDB smoke
test in the formula fails loudly if the native binding ever breaks, which
short-circuits the class of silent distribution bugs in RCA-011. The
bottle-update job cannot publish a partially populated formula.

**Negative.** Anyone who added a new runtime file under the repo root would
need to remember to add it to the `libexec.install` list. For a package
whose runtime surface is "compiled JS plus `node_modules`", this is a small
ongoing tax. The restricted `update-formula` condition also means a failed
bottle on one platform blocks the formula update for all platforms until the
failure is resolved, which is the intended trade-off.

## Alternatives Considered

### Continue installing everything with `Dir["*"]`

Rejected. Ships irrelevant files, makes the runtime surface unclear, and
makes auditing what the bottle contains harder.

### Use a `.bottle-ignore` file or post-install cleanup

Rejected. Homebrew does not have a first-class ignore mechanism for
formula installs, and a post-install cleanup step would be fragile.

### Run `spec-check run-all` in the test block

Rejected. `run-all` requires a project with spec files; the formula test
runs inside a sandboxed temp directory that does not have one. A single
synthetic SQL query exercises the same subprocess path without needing
fixtures.

### Allow partial formula updates on matrix failure

Rejected. A formula with missing `sha256` entries silently degrades user
experience by triggering source builds — the opposite of the bottle's
purpose.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-013-1 | `dist`, `node_modules`, and `package.json` are sufficient for the CLI to run end-to-end | Verified by the Homebrew-install simulation (copy only those three into a fake libexec, run from `/tmp`) | `verified` |
| A-013-2 | `npm prune --omit=dev` retains `@mapbox/node-pre-gyp`, `node-addon-api`, and `node-gyp` because they are in `duckdb`'s `dependencies` not `devDependencies` | Inspection of `node_modules/duckdb/package.json` | `verified` |
| A-013-3 | `SELECT 42 AS answer` is a representative DuckDB smoke test — if duckdb loads at all, this query will succeed | DuckDB executes the same subprocess path used by real queries | `assumed` |
