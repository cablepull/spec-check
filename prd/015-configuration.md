# PRD: Feature F-15: Configuration

## Feature F-15: Configuration

### Rule R-37: Validate Project config overrides global config without replacing it
Example: Project threshold overrides global default
  Given global config has `R-3: 0.7` and project config has `R-3: 0.9`
  When `check_requirements` is called on that project
  Then criterion `R-3` uses threshold `0.9`
  And all other thresholds use their global or default values

### Rule R-38: Validate Invalid config returns a structured error without crashing
Example: Invalid JSON in project config
  Given `spec-check.config.json` contains malformed JSON
  When any tool is called with that project path
  Then a `CONFIG_PARSE_ERROR` is returned with the file path and parse error
  And built-in defaults are used for the remainder of the call

---
