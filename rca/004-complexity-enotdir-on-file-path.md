# RCA-004: Complexity Tool ENOTDIR Crash When Given a File Path

## Summary

Calling the `complexity` MCP tool with a path argument that pointed to a single source
file (rather than a directory) caused an unhandled ENOTDIR error and returned a generic
`INTERNAL_ERROR` structured error instead of analyzing the file. The server did not crash,
but the response was opaque and offered no actionable fix guidance.

Concrete reproduction: `complexity({ path: "/…/src/nlp.ts" })` → `INTERNAL_ERROR: ENOTDIR:
not a directory, scandir '/…/src/nlp.ts'`.

## Root Cause

`walkFiles(root)` in `src/complexity.ts` unconditionally called `readdirSync(root)` without
first checking whether `root` was a file or a directory:

```ts
function walkFiles(root: string): string[] {
  const files: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir)) { // ← throws ENOTDIR if root is a file
```

`readdirSync` throws `ENOTDIR` when given a file path. Because `walkFiles` is called from
`runComplexity` (which is not wrapped in a try/catch at that level), the error propagated
to the top-level tool handler and was returned as `INTERNAL_ERROR`.

## Violated Requirement

R-1 — The server starts and responds to protocol messages reliably.

The rule includes: "Wrap all tool handlers in try/catch returning structured errors, never
raw stack traces." Although the outer handler did catch the error and return a structured
envelope, the error code `INTERNAL_ERROR` with no fix suggestion is non-actionable and
violates the spirit of reliable structured responses.

## Resolution

Added a stat check at the top of `walkFiles` before any directory scanning:

```ts
let rootStat;
try { rootStat = statSync(root); } catch { return files; }
if (rootStat.isFile()) {
  if (EXTENSIONS[extname(root).toLowerCase()]) files.push(root);
  return files;
}
// proceed with directory scan
```

When `path` is a single supported-extension file, it is now analyzed directly. Unsupported
extensions return an empty file list, which the caller handles gracefully.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- It is intentional and useful to allow `complexity` to accept a single file path; the
  description says "project root path" but the common case of pointing at one file for
  quick inspection should work without error.
- Files with unsupported extensions silently return no results rather than emitting a
  `FORMAT_NOT_SUPPORTED` error, consistent with how the directory walker already skips them.
