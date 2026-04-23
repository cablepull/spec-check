# RCA-011: DuckDB `require("duckdb")` Fails Outside the spec-check Source Tree

## Summary

`runDuckQuery`, `writeRecord`, and `convertJsonlToParquet` in `src/storage.ts` each
spawn a Node.js subprocess with `node -e "<inline code>"`. That inline code used a
bare `require("duckdb")` to load the native DuckDB binding. When spec-check was
invoked from any directory outside its own source tree — which is the normal case
for a user running `spec-check` against their own project, and the only case for a
Homebrew-installed binary — the subprocess failed immediately with
`Cannot find module 'duckdb'`. Every metrics write, every legacy migration, and
every `runDuckQuery` call silently swallowed the error and returned empty results.

## Root Cause

Bare `require("duckdb")` is resolved by Node.js relative to the subprocess's
current working directory (plus any ancestor `node_modules` directories), not
relative to the source file that spawned the subprocess. In development, cwd was
the spec-check repo and `node_modules/duckdb` was adjacent, so the require
resolved. In production:

- Homebrew installs spec-check into `libexec/` and runs the CLI as a shell shim;
  cwd is wherever the user invoked `spec-check` from.
- The subprocess is spawned via `-e` with no script file, so
  `module.paths` does not include the parent process's module search path.
- `node_modules/duckdb` is at `libexec/node_modules/duckdb/`, which is not
  discoverable from `process.cwd()` in the subprocess.

The defect was invisible during local development because the error paths inside
`runDuckQuery` return `[]` on failure and inside `writeRecord` only write a
stderr line. Tests exercised the functions from within the repo, so the bug was
not observable from vitest runs either.

## Violated Requirement

- [R-16](../requirements.md) — storage artifacts must be written safely and query correctly
- [R-65](../requirements.md) — shared runtime outputs must remain trustworthy across transports
- [R-72](../requirements.md) — the Homebrew-installed binary must function end-to-end on a clean system

## Resolution

- Compute the absolute path to the `duckdb` module once at `storage.ts` module
  load time via `createRequire(import.meta.url).resolve("duckdb")`. The
  resolution is relative to the compiled `dist/storage.js` location, which sits
  adjacent to `node_modules/duckdb` in every deployment layout (dev, npm global,
  Homebrew libexec).
- Inline every subprocess's `require("duckdb")` call as
  `require(${JSON.stringify(DUCKDB_REQUIRE_PATH)})` so the subprocess loads the
  binding by absolute path regardless of its cwd.
- Fall back to the bare `"duckdb"` string if `createRequire.resolve` throws, so
  the in-tree vitest runs keep working if the module tree is unusual.
- Added a Homebrew-install simulation (dist + node_modules + package.json only,
  run from `/tmp`) that exercises `spec-check query` end-to-end; this caught
  the bug and now serves as the regression guard.
- Added a `spec-check query "SELECT 42 AS answer"` assertion to the Homebrew
  formula `test do` block so the bottle test fails loudly if duckdb cannot load
  in the installed environment.

## Spec Update Required

No — the intended behaviour (DuckDB must work in every deployment) was already
required by R-16 and R-72. Only the implementation was wrong.

## ADR Required

Yes — see [ADR-011](../adr/011-duckdb-subprocess-path-resolution.md) for the
decision to embed an absolute module path rather than set `NODE_PATH` in the
subprocess environment or move all DuckDB work into the parent process.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-011-1 | The compiled `dist/storage.js` will always be co-located with a `node_modules/duckdb/` reachable by Node's resolver | True for dev, `npm install -g`, pnpm hoisted, and Homebrew `libexec` layouts | `assumed` |
| A-011-2 | `createRequire(import.meta.url).resolve("duckdb")` produces a path that is stable across Node minor versions within the supported Node 24.x range | N-API guarantees and Node's documented `createRequire` contract | `assumed` |
| A-011-3 | The prebuilt `duckdb.node` downloaded by node-pre-gyp during `brew install --build-bottle` is ABI-compatible with every Node 24.x minor/patch the user might have via `node@24` | N-API stability promise | `assumed` |
