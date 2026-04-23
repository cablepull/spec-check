# ADR-011: Absolute-Path Resolution for DuckDB in Subprocess Code

## Status

Accepted

## Context

Triggering artifact: [intent.md](../intent.md); related to Story 034 (storage integrity hardening) and Story 035 (Homebrew distribution).

`src/storage.ts` performs three operations by spawning a short-lived Node.js
subprocess: writing a record as Parquet (`writeRecord`), converting legacy
JSONL files to Parquet (`convertJsonlToParquet`), and running an ad-hoc
DuckDB SQL query (`runDuckQuery`). Each subprocess is invoked via
`execFileSync(process.execPath, ["-e", "<inline code>", ...args])` and each
inline snippet begins with `const duckdb = require("duckdb")`.

During this session's Homebrew distribution audit, we discovered that the bare
`require("duckdb")` call resolves relative to the subprocess's `cwd`, not to
the source file that spawned it. In every production deployment — Homebrew
bottle, `npm install -g`, a clone run from a user's project directory — the
cwd is the user's project, not spec-check's own source tree, so the require
fails with `Cannot find module 'duckdb'`. The error paths silently return `[]`
or log to stderr, so every metrics write and storage query was failing
invisibly. This is documented in
[RCA-011](../rca/011-duckdb-require-fails-outside-source-tree.md).

References: Feature F-27, Feature F-28, R-16, R-72

## Decision

**Compute the absolute path to duckdb once, at `storage.ts` module load time**,
using `createRequire(import.meta.url).resolve("duckdb")`. Embed that path as a
JSON-escaped string literal in every subprocess code fragment:

```ts
const DUCKDB_REQUIRE_PATH = createRequire(import.meta.url).resolve("duckdb");
// ...
execFileSync(process.execPath, ["-e", `
  const duckdb = require(${JSON.stringify(DUCKDB_REQUIRE_PATH)});
  // ...
`, ...args]);
```

Fall back to the bare string `"duckdb"` if resolution throws, so unusual
module layouts (dev sandboxes, custom test harnesses) keep working.

## Requirement Traceability

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
| R-16 | Storage writes must complete successfully in every deployment | `writeRecord` subprocess uses absolute duckdb path |
| R-16 | Storage reads via `runDuckQuery` must work from any cwd | `runDuckQuery` subprocess uses absolute duckdb path |
| R-72 | The Homebrew-installed binary must function end-to-end | Homebrew `test do` block includes a DuckDB smoke test |

## Consequences

**Positive.** The subprocess is decoupled from the caller's cwd and from
`NODE_PATH`. The fix is confined to `storage.ts`; no changes to the formula,
to the subprocess argument passing, or to the rest of the pipeline are needed.
The pattern is uniform across all three subprocess call sites.

**Negative.** Each subprocess now has a hardcoded absolute path to a specific
`duckdb/lib/duckdb.js` file. If a user moves the spec-check install directory
on disk while a long-running parent process is still executing, that parent's
subprocesses will fail on the next call — but the parent itself would also
break, so this is not a new failure mode. The pattern requires every future
subprocess that needs duckdb to use the same mechanism; a developer who adds
a new `execFileSync(node, ["-e", "const duckdb = require('duckdb')..."])`
call without using `DUCKDB_REQUIRE_PATH` will reintroduce the bug.

## Alternatives Considered

### Set `NODE_PATH` in the subprocess environment

Rejected. `NODE_PATH` is a convenience that other tools can override, and
setting it adds a second resolution mechanism that can disagree with Node's
default resolver. Passing an absolute path expresses the intent directly.

### Move all DuckDB work into the parent process with an in-process singleton

Rejected for this change because `writeRecord` is called from many code paths,
some of which cannot await (synchronous callers) and some of which benefit
from subprocess isolation if DuckDB crashes. An in-process singleton already
exists in `src/metrics.ts` for read-only queries; that precedent is kept and
the subprocess pattern is kept for writes.

### Bundle duckdb with the compiled dist using a bundler

Rejected. DuckDB ships a native `.node` binary that cannot be bundled into a
single JS file. The bundling path would still leave the native binary to be
resolved at runtime, and it adds a bundler dependency (esbuild, etc.) that the
project does not otherwise need.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-011-1 | `dist/storage.js` is always co-located with a reachable `node_modules/duckdb/` in every deployment layout | Verified for dev, `npm install -g`, pnpm hoisted, and Homebrew `libexec` layouts | `assumed` |
| A-011-2 | Future subprocess code added to storage.ts will follow the same pattern | Enforced by code review and by the uniform existing call sites | `assumed` |
