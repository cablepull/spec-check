# PRD: Feature F-26: Project Registry

## Feature F-26: Multi-Project Registry and Routing

### Rule R-66: Validate projects can be registered with stable identifiers
Example: Register a project path
  Given a local repository at `/work/auth-service`
  When the user registers it with name `auth-service`
  Then the registry stores a stable `project_id`
  And later tool calls may reference that project by `project_id` instead of raw path

Example: Canonical path prevents duplicate registrations
  Given the same repository is referred to by two equivalent filesystem paths
  When both are registered
  Then the registry resolves them to one canonical project entry
  And duplicate project IDs are rejected

Example: Unknown registration path is rejected
  Given the registration path is absent from the filesystem
  When the project is registered
  Then the request returns an error
  And no registry entry is written

### Rule R-67: Validate daemon-mode tool calls resolve a target project explicitly
Example: Tool call by project identifier
  Given the daemon has a registered project `spec-check`
  When `POST /api/tools/call` is sent with `project_id: "spec-check"`
  Then the tool executes against that project's canonical path
  And the response includes the resolved path

Example: Ambiguous daemon request is rejected
  Given the daemon is running with multiple registered projects
  When a tool call omits both `project_id` and `path`
  Then the request returns a structured missing-project error
  And no implicit current working directory is assumed

Example: Unknown project identifier is rejected
  Given the daemon is running
  When `POST /api/tools/call` names a `project_id` that is not registered
  Then the response returns an unknown-project error
  And no tool execution occurs

### Rule R-68: Validate project state and metrics remain isolated across registered projects
Example: Separate metrics for two projects
  Given projects `auth-service` and `billing-service` are both registered
  When each project runs `run_all`
  Then the stored records remain queryable per project
  And one project's workflow state does not overwrite the other's

Example: Per-project locking prevents cross-project interference
  Given one project has an active long-running check
  When another project receives a tool call
  Then the second project can proceed independently
  And only same-project conflicting writes are serialized

Example: Project-scoped state does not leak across registry entries
  Given two registered projects use the same model and session identifiers
  When both persist workflow state
  Then each project's stored state remains isolated by project path
  And listing one project's state does not include the other's records

---
