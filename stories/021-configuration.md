# Story 021: Configuration System

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

Every team is at a different point in their spec-driven journey. Because one size does not fit all stages of spec adoption, a team adopting the
methodology for the first time should not be blocked by thresholds calibrated for a
mature team. A mature team should be able to tighten thresholds beyond the defaults.
The configuration system provides a two-level hierarchy — global defaults at
`~/.spec-check/config.json` and project-level overrides at `<project-root>/spec-check.config.json`
— so that behaviour is predictable, auditable, and adjustable without touching the
server binary. The configuration is also returned by `get_protocol` so any LLM knows
exactly which thresholds are active for the current project.

## Acceptance Criteria

**Loading:**
- [ ] At startup, global config is loaded from `~/.spec-check/config.json` if present; missing file is not an error — built-in defaults apply
- [ ] On each tool call with a `path` argument, project-level config is loaded from `<path>/spec-check.config.json` if present; missing file is not an error
- [ ] Project-level config overrides global config key-by-key; keys absent in project config inherit from global; keys absent in both use built-in defaults
- [ ] Config is re-read on each tool call (not cached at startup) so changes take effect without restarting the server
- [ ] Invalid JSON in either config file returns a structured `CONFIG_PARSE_ERROR` with the file path, line number, and parse error message; built-in defaults are used for the affected level

**Thresholds:**
- [ ] All NLP threshold keys from PRD Section 14 (`I-2` through `AS-3`) are configurable in both config files
- [ ] All CC threshold keys (`CC-1` through `CC-5`) are configurable
- [ ] All MT threshold keys (`MT-1`, `MT-2`, `MT-4`) are configurable
- [ ] Setting a threshold to `0.0` effectively disables a tunable check (returns no violation/warning)
- [ ] Setting a threshold to `1.0` makes a tunable check maximally strict
- [ ] Threshold values outside `[0.0, 1.0]` for NLP checks return `CONFIG_VALIDATION_ERROR` naming the key and the invalid value
- [ ] CC and MT thresholds accept integer or float values within documented ranges; out-of-range values return `CONFIG_VALIDATION_ERROR`

**Compliance weights:**
- [ ] Gate weights (`G1`–`G5`) must sum to `1.0`; if they do not, `CONFIG_VALIDATION_ERROR` is returned and default weights are used
- [ ] Individual weights may be set to `0.0` to exclude a gate from the compliance score

**Mutation triggers:**
- [ ] `mutation.triggers.default` must be one of the five valid values; invalid value returns `CONFIG_VALIDATION_ERROR`
- [ ] `mutation.triggers.scheduled.cron` must be a valid cron expression (5 or 6 fields); invalid expression returns `CONFIG_VALIDATION_ERROR` with the expression highlighted

**`get_protocol` integration:**
- [ ] `get_protocol` includes a `current_config` section showing the resolved configuration (merged global + project) with each key labelled as `default`, `global`, or `project` to show where it came from
- [ ] `get_protocol` accepts a `path` argument so it returns the config resolved for a specific project

## ADR Required

No — two-level JSON config is a standard pattern with no new architectural dependency.

## Requirements

- PRD Section 14 (Configuration schema)
- PRD Section 13.1 (`get_protocol` current_config section)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Config files use JSON, not YAML or TOML; `.json` extension is required | JSON is universally parseable in Node.js without a dependency; consistency with `package.json` conventions | `assumed` |
| A-002 | Config re-reads on every tool call add negligible latency (<5ms); no caching needed | Config files are small; file system reads are fast on modern hardware | `assumed` |
| A-003 | The `~` in `~/.spec-check/config.json` is resolved using `os.homedir()` from Node.js stdlib | Standard cross-platform home directory resolution | `assumed` |
| A-004 | Scheduled mutation triggers (`nightly`, `weekly`) are invoked by an external cron process or git hook that calls `check_mutation_score` directly; the config system only stores the cron expression as documentation for that external setup | Implementing a built-in cron scheduler inside the MCP server would conflict with the server's stdio transport model | `assumed` |
