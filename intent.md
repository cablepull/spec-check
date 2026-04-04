# Intent

## Problem

The problem is that LLMs are powerful but structurally inconsistent. Given the same task twice,
an LLM may produce a thorough specification one time and skip it entirely the next. It may capture
intent once and forget to update it when requirements change. The challenge is that nothing in the
current toolchain enforces the spec-driven workflow — there is no gate. There is no mechanism that
stops the LLM from proceeding when a step is incomplete.

The same problem exists for human developers working alongside LLMs. Without enforcement, the
spec-driven methodology becomes aspirational rather than operational. The discipline degrades
under time pressure, and the codebase accumulates undocumented decisions, untracked bugs,
and architecture that nobody can explain. Currently there is no way to make the methodology
operational rather than advisory.

## Why this must be solved locally

Cloud-based linting or review services introduce latency, dependencies, and data exposure
concerns. The enforcement must run locally — fast enough to be called at every gate in the
workflow, with no network dependency, and with no code or intent leaving the machine. Without
this local gate, any enforcement solution requires human review at every step, which defeats
the purpose.

Static analysis run locally can make deterministic judgments. An LLM can call a local MCP tool,
receive a structured verdict, and self-correct before proceeding. This enables the LLM to close
the correction loop autonomously, because the verdict is deterministic and actionable. Therefore,
the solution is a local MCP tool, not a cloud service.

## Intent

Build a local MCP server that enforces the spec-driven development methodology through
static analysis and rule-based NLP. The tool acts as a gatekeeper at defined checkpoints
in the development workflow. An LLM calls it, receives a deterministic verdict with specific
violations, and must satisfy those violations before the workflow advances.

The tool also tracks compliance metrics over time — per project and across all projects —
so that patterns of skipped steps or recurring violations become visible and improvable.

The project also records integration mismatches and architectural tradeoffs explicitly.
When real dependency behavior diverges from a preferred design, the tool should capture the
finding in an RCA, amend the governing ADR, and adapt the implementation in a way that still
satisfies the underlying intent instead of preserving a false specification.

## What this is not

This is not a code linter. It does not analyze implementation correctness.
This is not a test runner. It does not execute tests.
This is not a documentation generator. It does not write specs.
This is not an AI reviewer. All judgments are deterministic or rule-based.

## Constraints

- Must run entirely locally with no network calls
- Must be callable as an MCP tool from any MCP-compatible LLM client
- Non-deterministic checks (NLP-based) must be tunable and have configurable thresholds
- Must support any project structure, not assume a specific framework or language
- Metrics must persist across sessions and be queryable over time
- Verified behavior of real dependencies takes precedence over assumed interfaces, and durable
  corrections must be recorded through RCA and ADR artifacts

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | LLM clients that support MCP over stdio are the primary consumers | Inferred from current MCP tooling ecosystem; not explicitly stated by user | Tool would need a different transport if HTTP-only clients dominate |
| A2 | "Local" means the developer's workstation, not a shared CI host | Defaulted to; user said "locally" without specifying the execution context | CI integration would require different path resolution and storage strategy |
| A3 | A single spec file per gate is sufficient (intent.md, requirements.md, etc.) | Assumed because the spec-driven methodology targets one feature per workflow cycle | Multi-document features would need a merge/aggregate step before gate checks |
| A4 | The chosen embedded analytics database is available as an npm package and can be installed without system-level privileges | Inferred from the planned local metrics architecture; not verified for all target environments | Falls back to JSONL-only storage if the database package install fails — metrics queries would be unavailable |
| A5 | Git is present and the project root is a git repository | Assumed because org/repo/commit path segments require git context | Non-git projects fall back to "local/unknown/no-commit" path segments per storage fallback logic |
