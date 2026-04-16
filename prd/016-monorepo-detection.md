# PRD: Feature F-16: Monorepo Detection

## Feature F-16: Monorepo Detection and Routing

### Rule R-39: Validate Services are detected automatically for known monorepo structures
Example: Workspace-based monorepo detected
  Given a project root with `package.json` containing `"workspaces": ["packages/auth", "packages/api"]`
  When any tool is called with the project root as `path`
  Then two services are detected: `auth` and `api`
  And each service is analysed separately
  And results include a per-service breakdown

Example: Unknown layout falls back to root service
  Given a project root with no workspaces, no supported subdirectory manifests, and no explicit service config
  When any tool is called with the project root as `path`
  Then one service named `root` is returned
  And the response indicates fallback detection was used

### Rule R-40: Validate Whole-repo checks always run at root level
Example: Diff check runs at root regardless of service config
  Given a monorepo with services `auth` and `api` explicitly configured
  When `check_diff` is called with the project root
  Then the diff check runs once at the repo level
  And the Parquet file is written to the `root/` service path

Example: A node_modules subdirectory manifest is rejected as a service path
  Given a project root where the only `package.json` is present inside a `node_modules/` subdirectory
  When any tool is called with the project root as `path`
  Then no service is registered for the `node_modules` path
  And a fallback `root` service is returned

---
