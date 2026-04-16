# PRD: Feature F-2: Get Protocol

## Feature F-2: Self-Description (get_protocol)

### Rule R-3: Validate The tool is always the source of truth for its own enforcement protocol
Example: LLM retrieves the full protocol at session start
  Given the server is running
  When `get_protocol` is called with no arguments
  Then the response contains all five gates with criteria IDs, severities, and tunable flags
  And all artifact contracts with required sections are listed
  And the assumption table format with an example is included
  And the supersession flow is described as a numbered sequence
  And tool-call guidance is provided for each workflow stage

Example: Protocol includes version and timestamp
  Given the server is running
  When `get_protocol` is called
  Then the response includes a `protocol_version` integer
  And a `generated_at` UTC timestamp

Example: Protocol returns active thresholds for the current project
  Given a project at `path` with `spec-check.config.json` overriding `R-3: 0.9`
  When `get_protocol` is called with `path`
  Then the response shows `R-3: 0.9` labelled as `project` override
  And all other thresholds are shown with their source (`default` or `global`)

Example: Unsupported protocol format is rejected
  Given the server is running
  When `get_protocol` is called with `format: "yaml"`
  Then a structured format error is returned
  And no partial protocol response is emitted

---
