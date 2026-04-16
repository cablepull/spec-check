# ADR 010: Init Adapter Architecture and Homebrew Distribution

## Status

Accepted

## Context

Story 035 requires spec-check to configure multiple LLM-driven tools from a single
command. Each tool (Claude, Cursor, Gemini, Codex, Ollama) uses a different config
file format, file location, and detection mechanism. Without a shared adapter
contract, adding a new tool would require changes to core routing logic.

Separately, distribution via a homebrew tap was chosen so that developers on macOS
can install spec-check with a single `brew install` command without requiring Node.js
to be installed globally as a prerequisite by the user.

References: Feature F-27, Feature F-28

## Decision

**Adapter contract (R-69, R-70):** Each tool is represented by a module that exports
a single `ToolAdapter` interface: `{ id, name, detect(), files(options), install() }`.
The core `runInit` orchestrator loads adapters from a registry map and never calls
tool-specific code directly — it only calls the interface methods. Adding a new tool
requires only adding a new entry to the registry; no changes to orchestration logic.

**File writes (R-70):** Each adapter declares the paths it owns. The orchestrator
checks for existing files before writing and skips with a warning unless `--force` is
set. Directories are created recursively.

**--install (R-71):** Each adapter declares optional dependency specs in the same
format as the existing `DependencySpec` registry. The `--install` path reuses
`checkDependencies` and shells out only when a dep is absent.

**Homebrew (R-72, R-73):** A Ruby formula at `Formula/spec-check.rb` wraps the npm
package. It uses `node` as a prerequisite, installs via `npm install -g` scoped to
the brew prefix, and writes a shell shim so `spec-check` is on the path. A `caveats`
block prints `spec-check init --tool claude` instructions after install.

## Requirement Traceability

| Rule | Criterion | Satisfied By |
|------|-----------|--------------|
| R-69 | Init writes tool-specific files | `runInit` orchestrator + per-adapter `files()` |
| R-70 | Adapters operate independently | Registry map; no cross-adapter calls |
| R-71 | --install executes dependency installs | `runInstall` reuses dependency module |
| R-72 | Brew tap installs binary | `Formula/spec-check.rb` npm-based formula |
| R-73 | Binary on path, caveats shown | Shell shim + `caveats` block in formula |

## Consequences

Positive: any new tool adapter requires only one file and one registry entry.
Negative: adapters that write to global config files (e.g. Claude MCP JSON) must read
and merge carefully to avoid clobbering user settings; this requires JSON-safe merge
logic per adapter.

## Alternatives Considered

**Plugin system via dynamic `require`:** rejected — too complex for the current scale
and introduces security surface. A static registry is simpler and statically typed.

**Shell script instead of TypeScript:** rejected — would not share the existing
dependency checking and error envelope infrastructure.

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-010-1 | Homebrew supports npm-install-based formulas without a separate build phase | Existing homebrew-node-based formulas (e.g. firebase-cli) | assumed |
| A-010-2 | The adapter interface is stable enough that no breaking changes will occur within F-27 scope | Inferred from the limited set of five initial adapters | assumed |
