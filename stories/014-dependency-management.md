# Story 014: Dependency Management

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

The tool's analysis capabilities depend on external tools that may or may not be installed.
A tool that silently skips analysis when a dependency is missing gives false confidence.
A tool that crashes with a raw error is unusable. In order to prevent silent analysis gaps and raw crashes — this enables informed, confident dependency decisions — the dependency management system does
three things: reports exactly what is available and what is not, offers to install what
is missing with the correct command for the detected package manager, and when installation
fails, explains precisely why — not just that it failed. Every failure has a category,
a human explanation, and a suggested resolution. The LLM is never left guessing.

## Acceptance Criteria

**`check_dependencies`:**
- [ ] Detects whether each tool in the registry is installed by running its `check` command
- [ ] For each installed tool: reports name, detected version, and which metrics/languages it covers
- [ ] For each missing tool: reports name, what it would enable (metrics and languages), the install command for each available package manager, and any runtime prerequisites with their detected status
- [ ] Detects available package managers (`pipx`, `pip`, `npm`, `yarn`, `pnpm`, `go`) and only shows install commands for those that are present
- [ ] For tools with a missing runtime prerequisite, clearly states the prerequisite must be installed first and provides the prerequisite's install guidance
- [ ] Reports which metrics are currently unavailable for which languages as a consequence of missing tools
- [ ] Runs in < 1 second

**`install_dependency`:**
- [ ] Accepts `name` (tool name from registry) and optional `path` (project root for package-local installs like Stryker)
- [ ] Selects the install command based on available package managers in priority order: `pipx` > `pip` for Python tools; `npm` > `yarn` > `pnpm` for Node tools; `go` for Go tools
- [ ] Executes the install command, captures stdout and stderr
- [ ] On success: re-runs the `check` command to confirm the binary is now accessible; returns the confirmed version
- [ ] On failure: applies pattern matching to stderr and returns a structured `InstallFailure` with `reason`, `human_explanation`, `suggestion`, `affects_metrics`, `affects_languages`, and `raw_output`
- [ ] All failure categories in PRD Section 8.2 are handled; unrecognised failures return `UNKNOWN` with full `raw_output`
- [ ] Does NOT install silently — always returns what it did, what succeeded or failed, and why
- [ ] `PATH_NOT_UPDATED` detection: after install, re-runs the `check` command; if it still fails but the expected install path exists, returns `PATH_NOT_UPDATED` with the path that needs to be added
- [ ] Never installs more than the single named dependency per call; no transitive install orchestration

## ADR Required

No — dependency registry and install flow are operational tooling. No new architectural
dependency introduced by this story itself.

## Requirements

- PRD Section 8.1 (dependency registry)
- PRD Section 8.2 (installation failure schema and pattern matching)
- PRD Section 13.5 (`check_dependencies` and `install_dependency` tools)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Package manager detection checks `which <manager>` (macOS/Linux) or `where <manager>` (Windows); a non-zero exit means not available | Standard PATH-based detection; no registry or manifest inspection needed | `assumed` |
| A-002 | Stryker is installed as a project-local devDependency (`npm install --save-dev`), not globally; `path` argument points to the project root where `package.json` lives | Stryker's own documentation recommends project-local install; global install causes version conflicts | `assumed` |
| A-003 | `install_dependency` runs synchronously and blocks until the install completes or fails; no background install | LLM clients expect a result before proceeding; async install would require polling | `assumed` |
| A-004 | The `RUNTIME_VERSION` failure category requires parsing the error message for version numbers; if no version is found in stderr, it falls back to `UNKNOWN` | Not all tools report the required version in a consistent format | `assumed` |
