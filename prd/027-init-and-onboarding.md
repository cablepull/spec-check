# PRD 027: LLM Tool Initialization and Onboarding

## Feature F-27: Tool-Specific Onboarding Configuration

### Rule R-69: Validate the init command writes tool-specific integration files for a named tool
Example: Claude adapter writes MCP config and guidance file
  Given the `claude` tool name is in the arguments and the project path resolves to a valid directory
  When the init command runs
  Then a CLAUDE.md fragment containing spec-check workflow instructions is written to the project root
  And a spec-check MCP server entry is appended to the Claude MCP configuration file
  And the output lists each file written with its absolute path

Example: Unknown tool name is rejected
  Given a tool name in the arguments that does not correspond to any registered adapter
  When the init command runs
  Then the command exits with a structured error naming the unknown tool
  And no files are written to disk

### Rule R-70: Validate the init command supports all named LLM tools without cross-adapter interference
Example: Cursor adapter writes rules file
  Given the `cursor` tool name is in the arguments and the project path resolves to a valid directory
  When the init command runs
  Then a `.cursor/rules/spec-check.mdc` rules file is written containing Cursor-compatible spec-check guidance
  And no files belonging to other adapters are written

Example: Gemini adapter writes guidance file
  Given the `gemini` tool name is in the arguments and the project path resolves to a valid directory
  When the init command runs
  Then a `.gemini/GEMINI.md` file is written containing spec-check workflow instructions
  And no files belonging to other adapters are written

Example: Codex adapter writes guidance file
  Given the `codex` tool name is in the arguments and the project path resolves to a valid directory
  When the init command runs
  Then a `codex.md` file is written at the project root
  And no files belonging to other adapters are written

Example: Ollama adapter writes instructions fragment
  Given the `ollama` tool name is in the arguments and the project path resolves to a valid directory
  When the init command runs
  Then a `.ollama/spec-check.md` fragment is written containing modelfile integration instructions
  And no files belonging to other adapters are written

Example: --all flag configures only detected tools
  Given the `--all` flag is present in the arguments and `cursor` is available on the system path
  When the init command runs
  Then the cursor adapter writes its files
  And adapters whose tool binary is absent from the system path are skipped with a noted reason

Example: --force flag is absent and target file already exists
  Given the `cursor` tool name is in the arguments
  And `.cursor/rules/spec-check.mdc` is already present at the project path
  When the init command runs without `--force`
  Then the existing file is not overwritten
  And the output reports the file was skipped with a reason

### Rule R-71: Validate the --install flag installs additional support dependencies for a tool
Example: --install resolves missing support dependency
  Given the `cursor` tool name is in the arguments and a required dependency is absent from the system path
  When the init command runs with `--install`
  Then the install command for that dependency is executed
  And the output reports whether installation succeeded or failed

Example: --install is a no-op when all dependencies are present
  Given the `cursor` tool name is in the arguments and all required dependencies are present on the path
  When the init command runs with `--install`
  Then no install commands are executed
  And the output confirms all dependencies are satisfied

Example: --install without a tool name is rejected
  Given the init command arguments contain `--install` but no `--tool` or `--all` flag
  When the command runs
  Then the command exits with a structured error requiring a tool selection
  And no install commands are executed

---

## Feature F-28: Homebrew Tap Distribution

### Rule R-72: Validate spec-check can be installed via a homebrew tap
Example: Formula installs the binary
  Given the homebrew tap is added and the formula is available
  When `brew install` is run for the spec-check formula
  Then the `spec-check` binary is available on the system path
  And `spec-check --help` exits with code 0

Example: Formula references a valid release archive
  Given the formula specifies a release URL with a sha256 checksum
  When the formula is evaluated
  Then the URL is reachable and the checksum matches the downloaded archive
  And no network errors are raised during installation

Example: Missing release archive causes install failure
  Given the formula specifies a release URL that does not resolve
  When `brew install` is run
  Then the install exits with a non-zero code
  And an error message names the failed URL

### Rule R-73: Validate the formula registers the CLI entrypoint correctly
Example: Binary is on the path after install
  Given the formula has been installed successfully
  When the shell searches for `spec-check`
  Then the installed binary is found
  And the binary responds to `spec-check --version` with the package version string

Example: Formula includes a caveats block with MCP configuration guidance
  Given the formula has been installed
  When the user runs `brew info spec-check`
  Then caveats text is shown containing MCP server registration instructions
  And the caveats reference the `spec-check init` command

Example: Formula installation fails when Node.js is absent
  Given the build environment does not have Node.js available
  When the formula build runs
  Then the build exits with a non-zero code
  And the error output names Node.js as the missing prerequisite

---

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | Tool binary names are stable across versions (cursor, ollama, codex, gemini) | Vendor CLI documentation as of 2026-04 | Adapter detection will fail; add version-aware probing |
| A2 | Homebrew formula with a URL-based install does not require a separate tap repository | Homebrew's single-file formula model | Requires a dedicated homebrew-spec-check repo |
| A3 | Users have write access to the directories where tool config files reside | Standard developer workstation posture | Must fall back to printing instructions instead of writing files |
| A4 | The MCP server entry format for Claude Code remains stable | Claude Code MCP documentation as of 2026-04 | Claude adapter must detect and handle schema version differences |
