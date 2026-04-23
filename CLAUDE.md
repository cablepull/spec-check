# CLAUDE.md — Project Instructions

This file is read by Claude Code at the start of every session. Follow all instructions here without exception.

> **Note on command examples.** Commands shown below are illustrative examples drawn from a Python/pip project. Replace them with whatever actually applies to the project you are working in (e.g. `npm test` instead of `pytest`, `tsc` instead of `pip install`, your project's actual module paths, etc.). The *rules* are what must be followed — the exact commands will vary.

---

## CRITICAL: spec-check is mandatory

**Before implementing anything, run spec-check. After implementing anything, run spec-check.**

This is not optional. Do not skip this step. Do not assume the implementation is correct without running it.

```bash
# Before starting work
spec-check --gaps

# After implementing a module
spec-check --module <module_name> --verbose

# Before declaring any task complete
spec-check
```

If `spec-check` is not installed, install it first:
```bash
pip install -e ".[dev]"
# or
pip install -e tools/spec_check
```

If `spec-check` fails, fix the failures before proceeding. Do not work around spec failures by modifying the spec. If the spec needs to change, update PRD.md first and explain why, then update `tools/spec_check/spec_manifest.yaml` to match.

---

## Project Context

Read these files before doing any work in a session:

1. `PRD.md` — authoritative requirements and architecture
2. `RESEARCH.md` — technical reference (OAuth flow, endpoint details, token schema, known gotchas)

If you haven't read them, read them now before writing any code.

---

## Workflow Rules

### Rule 1: CLI first, always

Prefer command-line operations over mcps and file operations where possible.

```bash
# Good
python -m pytest tests/unit/test_pkce.py -v
spec-check --module auth
pip install -e ".[dev]"
grep -r "litellm" src/

# Avoid
# Manually checking test results by reading test files
# Assuming imports are correct without running them
```

### Rule 2: Verify before claiming success

Never say "this should work" or "that looks correct." Run it.

```bash
# After writing any auth module
python -c "from adk_oauth_adapter.auth.pkce import generate_pkce_pair; print(generate_pkce_pair())"

# After writing token store
python -c "from adk_oauth_adapter.store.token_store import TokenStore; ts = TokenStore(); print(ts)"

# After any change
spec-check
python -m pytest tests/unit/ -v
```
