# spec-check

A local spec-driven development runtime that exposes the same checks over MCP stdio and a local HTTP daemon. An LLM or script calls it, receives a deterministic verdict with specific violations, and must satisfy those violations before the workflow advances.

Runs entirely offline. No code, intent, or metrics leave the machine.

---

## How it works

Projects are expected to maintain five spec artifacts:

| File | Purpose |
|---|---|
| `intent.md` | Problem statement, goals, and why the project exists |
| `requirements.md` | Features with numbered rules and acceptance criteria |
| `design.md` | Architecture, component decisions, and tradeoffs |
| `tasks.md` | Breakdown of work items with status tracking |
| `tests/` or `test/` | Executable test coverage |

The runtime exposes the same tool catalog through MCP and the local JSON API. The primary workflow is:

```
run_all          → runs all five gates, stops at first BLOCK
gate_check:Gn    → targeted recheck of a single gate after a fix
diff_check       → analyse git diff, identify which gates need re-running
complexity       → CC, cognitive complexity, nesting, function length
check_mutation_score → mutation testing with trend detection
metrics          → query stored compliance history for a project
get_rollup       → cross-project rankings and model comparisons
```

Each tool returns structured JSON with `data`, `meta`, and `workflow`, with per-check `status`, `criteria`, `evidence`, and `fix` instructions inside the tool payload.

---

## Installation

**Requirements:** Node.js 18+, git

```bash
npm install -g spec-check   # or: npx spec-check
```

## Runtime modes

**MCP stdio mode** starts by default:

```bash
npx spec-check
```

**Local daemon mode** starts the dashboard and HTTP API:

```bash
npx spec-check server
```

The daemon binds to `127.0.0.1:4319` by default. Override the port with `--port=4321` or `PORT=4321`.

**Optional dependencies** (detected automatically, install as needed):

| Tool | Enables |
|---|---|
| `lizard` (Python) | Cognitive complexity, nesting depth for all languages |
| `stryker` | Mutation testing for TypeScript/JavaScript |
| `mutmut` | Mutation testing for Python |
| `go-mutesting` | Mutation testing for Go |
| `cargo-mutants` | Mutation testing for Rust |

Check what's available: call the `check_dependencies` tool.

---

## Add to your MCP client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "spec-check": {
      "command": "npx",
      "args": ["-y", "spec-check"],
      "env": {
        "LLM_PROVIDER": "anthropic",
        "LLM_MODEL": "claude-sonnet-4-6"
      }
    }
  }
}
```

**Cursor / other MCP clients:** same `command` + `args`, placed in the client's MCP server config.

## Local HTTP API

When the daemon is running, the local API exposes:

- `GET /health`
- `GET /api/tools`
- `GET /api/projects`
- `POST /api/projects`
- `POST /api/tools/call`
- `GET /api/project`
- `GET /api/rollup`
- `GET /api/assumptions`
- `GET /api/dependencies`

Example:

```bash
curl -s http://127.0.0.1:4319/api/tools
```

Register a project:

```bash
curl -s -X POST http://127.0.0.1:4319/api/projects \
  -H 'content-type: application/json' \
  --data '{"path":".","name":"spec-check"}'
```

Call a tool over HTTP:

```bash
curl -s -X POST http://127.0.0.1:4319/api/tools/call \
  -H 'content-type: application/json' \
  --data '{
    "tool":"run_all",
    "project_id":"spec-check",
    "arguments":{"format":"json"},
    "actor":{"provider":"openai","model":"gpt-5.4","agent_id":"agent-1","session_id":"session-1"}
  }'
```

---

## The five gates

| Gate | Name | Blocks on |
|---|---|---|
| G1 | Intent Valid | Missing or malformed `intent.md` |
| G2 | Requirements Valid | Requirements lack numbered rules, acceptance criteria, or feature coverage |
| G3 | Design Valid | Design decisions undocumented or untraceable to requirements |
| G4 | Tasks Valid | Work items missing, unlinked, or lacking status |
| G5 | Executability Valid | No test directory or executable coverage present |

`run_all` stops at the first BLOCKED gate and returns next-step instructions. Gates that pass continue.

---

## Configuration

Place `spec-check.config.json` in the project root (all fields optional):

```json
{
  "thresholds": {
    "CC-1": 10,
    "MT-1": 80,
    "MT-2": 90
  },
  "compliance_weights": {
    "G1": 0.15,
    "G2": 0.30,
    "G3": 0.20,
    "G4": 0.15,
    "G5": 0.20
  },
  "metrics": {
    "db_path": "~/.spec-check/data",
    "retention_days": 365
  },
  "mutation": {
    "enabled": true,
    "incremental": true,
    "triggers": {
      "default": "pre_merge"
    }
  }
}
```

**Key thresholds:**

| ID | What it controls | Default |
|---|---|---|
| `CC-1` | Max cyclomatic complexity per function | 10 |
| `CC-3` | Max average CC per file | 5 |
| `CC-4` | Max nesting depth | 4 |
| `MT-1` | Project mutation score floor (%) | 80 |
| `MT-2` | Spec-critical function mutation floor (%) | 90 |

---

## Metrics and dashboard

Every tool call writes a Parquet record to `~/.spec-check/data` (or the configured `db_path`). Queried by DuckDB; no external database required.

**Per-project metrics** (`metrics` tool): gate pass rates, compliance score, cyclomatic complexity history (max CC + violations per run), mutation trend, assumption invalidation rate, lifecycle measurements.

**Cross-project rollup** (`get_rollup` tool): compliance rankings, model and agent comparisons, top projects by max CC, common violations.

**HTML dashboard** (served by `spec-check server`): renders charts for gate pass rate history, CC trend (max CC vs CC-1 threshold), mutation score, and the heatmap showing pass/fail across all five gates per run iteration.

## Multi-project usage

The daemon can register multiple local repositories and route tool calls by stable project identifier instead of raw path. When multiple projects are registered, callers should send `project_id` or `path` explicitly so the request stays unambiguous.

---

## Workflow guidance

Agents that call `begin_session` receive `WorkflowGuidance` after every tool call:

```json
{
  "phase": "implementation",
  "must_call_next": ["run_all"],
  "should_call_metrics": true,
  "must_report_state": true,
  "blocked": false,
  "blocked_by": []
}
```

`must_call_next` always resolves to `run_all` after a passing individual gate check (not `gate_check:G2 → gate_check:G3` chains), so agents run full sweeps rather than piecemeal checks.

---

## Monorepo support

Automatically detects services by scanning for `package.json`, `go.mod`, `requirements.txt`, `Cargo.toml`, and `pom.xml` up to two directory levels deep. Each detected service is checked independently. Configure with `monorepo.strategy: "auto" | "explicit"`.

---

## Development

```bash
npm install
npm run build   # tsc
npm test        # vitest
```

All source is TypeScript in `src/`. Compiled output goes to `dist/`. The server speaks the MCP stdio transport protocol.
