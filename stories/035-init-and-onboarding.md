# Story 035: LLM Tool Initialization and Onboarding

## Intent

The problem is that developers adopting spec-check must manually configure each of
their LLM-driven tools (Cursor, Claude, Gemini, Codex, Ollama, and others) to work
with the spec-check workflow. Because each tool uses a different configuration format
and file location, onboarding is error-prone, inconsistent, and must be repeated for
every new project. Without a structured onboarding path, developers either skip the
integration entirely or wire it incorrectly, producing spec-check installations that
agents ignore.

Because the configuration surface differs for every tool, developers currently cannot
get spec-check running correctly across their full AI toolchain without reading
multiple vendor-specific documentation sources and hand-crafting config files.

We need this in order to reduce adoption friction to near zero and ensure that every
supported LLM tool receives a correctly structured, spec-check-aware configuration on
first run. This enables the spec-driven workflow to be adopted by teams that use
mixed AI toolchains without manual setup.

Only the initialization and registration of spec-check integration files is addressed —
not general tool configuration, user preferences, or project-specific business logic.
Existing configuration files must not be silently overwritten without explicit consent.

## Acceptance Criteria

- [ ] `spec-check init --tool claude` writes a CLAUDE.md fragment and MCP server registration entry to the appropriate config file
- [ ] `spec-check init --tool cursor` writes a `.cursor/rules/spec-check.mdc` rules file to the project directory
- [ ] `spec-check init --tool gemini` writes a `.gemini/GEMINI.md` guidance file with spec-check workflow instructions
- [ ] `spec-check init --tool codex` writes a `codex.md` guidance file with spec-check workflow instructions
- [ ] `spec-check init --tool ollama` writes a `.ollama/spec-check.md` modelfile instructions fragment
- [ ] `spec-check init --all` detects which tools are installed and configures each automatically
- [ ] `spec-check init --install` installs additional support dependencies for the selected tool
- [ ] Each adapter is independently loadable; adding a new adapter requires no changes to core init logic
- [ ] The `brew tap` formula installs the `spec-check` binary and CLI entrypoint from a published release
- [ ] Existing config files that would be overwritten emit a warning and skip unless `--force` is passed

## ADR Required

Yes

## Requirements

F-27 in prd/027-init-and-onboarding.md
F-28 in prd/027-init-and-onboarding.md

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-035-1 | The target directories for each tool adapter are stable and publicly documented | Review of each tool's official documentation as of 2026-04 | assumed |
| A-035-2 | A brew tap can reference a GitHub release tarball without requiring a separate tap repository | Homebrew's URL-based formula model | assumed |
| A-035-3 | Users have write permission to the config directories for the tools they are configuring | Standard developer workstation setup | assumed |
| A-035-4 | The --all flag should configure all adapters whose tool binary is detectable on the system path | Inferred from typical developer experience with install scripts | assumed |
