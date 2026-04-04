# Story 022: Monorepo Detection and Service Routing

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

The `{service}` path segment is always present in the Parquet naming convention —
`root` for flat repos, a named service for monorepo services. Without reliable service
detection, cross-service comparisons are impossible and whole-repo checks pollute
per-service metrics. This story implements the detection logic — auto-detection for
the global default case, explicit service configuration for the local override case —
and ensures that every tool call routes its Parquet output and its spec artifact search
to the correct service context. Whole-repo checks (diff, deps, ADR, RCA) always write
to `root` regardless of service configuration.

## Acceptance Criteria

**Auto-detection (strategy: `auto`):**
- [ ] Scans the project root for language manifests (`package.json`, `go.mod`, `requirements.txt`, `Cargo.toml`, `pom.xml`) at depth 1 and 2 (not root itself)
- [ ] If manifest files found at subdirectory depth: derives service names from the containing directory names; treats each as a separate service
- [ ] If root `package.json` contains a `workspaces` array: uses workspace path entries as service names
- [ ] If `packages/`, `apps/`, or `services/` directory exists at root: uses immediate subdirectory names as service names
- [ ] If none of the above: service is `root`
- [ ] Detection result is logged at debug level; no output to the caller unless debug mode is on

**Explicit configuration (strategy: `services`):**
- [ ] Project-level `spec-check.config.json` with `monorepo.strategy: "services"` and a `services` array takes precedence over auto-detection
- [ ] Each service entry must have `name` and `path`; `spec_path` is optional (defaults to `<service.path>/specs` or `<service.path>/requirements.md`)
- [ ] Missing `name` or `path` in any service entry returns `CONFIG_VALIDATION_ERROR` listing the invalid entry
- [ ] `root_checks` array declares which check types run at repo level; defaults to `["diff", "deps", "gate-adr", "gate-rca"]`

**Routing:**
- [ ] When a tool is called with `path` pointing to a project root (not a service subdirectory), and monorepo services are detected, the tool runs for each service and returns aggregated results with per-service breakdown
- [ ] When `path` points to a service subdirectory directly, the tool runs for that service only
- [ ] Whole-repo check types (`diff`, `deps`, `gate-adr`, `gate-rca`) always run once at repo level and write to `root/` regardless of service configuration
- [ ] Parquet files for per-service runs use the service name in the path; Parquet files for whole-repo runs use `root`
- [ ] Spec artifact paths (requirements, design, tasks) are resolved relative to `service.spec_path` when defined, else relative to `service.path`

**Strategy: `flat`:**
- [ ] All checks run at repo level; service is always `root`; no subdirectory scanning

## ADR Required

No — monorepo detection is a path-resolution and configuration concern. No new
architectural dependency.

## Requirements

- PRD Section 10.5 (monorepo strategy — global config and local override)
- PRD Section 10.2 (auto-detection logic)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Depth-2 manifest scanning does not descend into `node_modules`, `vendor`, `dist`, `build`, or hidden directories (`.git`, `.github`) | These are dependency/build/VCS directories, not service roots | `assumed` |
| A-002 | When auto-detection finds both a root-level `package.json` AND subdirectory `package.json` files, it treats the project as a monorepo and ignores the root manifest for service detection; the root manifest is only consulted for `workspaces` | Root manifests that list workspaces should drive detection; root manifests that are for build tooling should not create spurious services | `assumed` |
| A-003 | Service names are normalised: lowercased, spaces and special characters replaced with `-`; must be unique within a project; duplicate names return `CONFIG_VALIDATION_ERROR` | Consistent with all path segment sanitisation in the naming convention | `assumed` |
| A-004 | When running in aggregated mode (path = project root, multiple services detected), each service check runs sequentially, not in parallel, to avoid interleaved output | Parallel execution with stdio transport requires careful output buffering; sequential is safer for v1 | `assumed` |
