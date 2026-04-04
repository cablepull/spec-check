# Story 008: run_all — Full Gate Runner

**Status:** Draft
**Created:** 2026-04-03
**Author:** claude-sonnet-4-5

## Intent

An LLM checking a project needs a single tool call that tells it the full picture —
not five separate calls, not a mental model of which checks apply. `run_all` runs every
gate in sequence, stops early when a BLOCK is encountered (there is no point checking
Gate 3 if Gate 1 has a BLOCK), and returns a consolidated report with a clear next-steps
section. It is the primary entry point for automated workflow enforcement.

## Acceptance Criteria

- [ ] Runs G1 → G2 → G3 → G4 → G5 in order
- [ ] When a BLOCK is encountered in gate Gn, remaining gates are skipped; report notes which gates were skipped and why
- [ ] When all violations in Gn are resolved (no BLOCK, no VIOLATION), Gn+1 runs
- [ ] WARNINGs in any gate do not halt progression; they are collected and included in the report
- [ ] Report sections: summary table (gate / status / violation count / warning count), per-gate detail, consolidated next-steps list
- [ ] Next-steps list orders items by gate sequence, then by severity (BLOCK before VIOLATION)
- [ ] Overall status is `PASS` only when all gates return no BLOCK and no VIOLATION
- [ ] Overall status is `BLOCKED` when any gate has a BLOCK
- [ ] Overall status is `FAILING` when no BLOCK but ≥1 VIOLATION exists
- [ ] Overall status is `PASSING_WITH_WARNINGS` when only WARNINGs remain
- [ ] Metrics run persisted to Parquet after every `run_all` call (check-type: `gate-all`)
- [ ] Total run time reported; gate-level run times included in JSON format
- [ ] Supports `format: text | json | mermaid`

## ADR Required

No — orchestration of existing gate tools. No new architectural decision required.

## Requirements

- PRD Section 4 (Gate Model — early-stop on BLOCK)
- PRD Section 13.2 (`run_all` tool)
- PRD Section 11.1 (metrics record schema for gate checks)

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Early-stop on BLOCK applies per-gate, not per-criterion; a BLOCK in G2 halts G3 but not the remaining criteria within G2 | Collecting all violations within a gate gives the LLM the full picture for that gate before stopping | `assumed` |
| A-002 | Story, ADR, and RCA validation (S, A, RC criteria) run in parallel with gate checks, not sequentially, and do not block G1–G5 progression | S/A/RC checks are artifact-level; they do not gate the main workflow sequence | `assumed` |
| A-003 | Metrics are written asynchronously after results are returned, not before | Latency requirement (< 2s) must not be blocked by disk I/O | `assumed` |
