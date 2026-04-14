# Story 023: Rust and WASM Language Support

**Status:** Draft
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

`spec-check` currently treats Rust and WASM projects as second-class citizens even though
the methodology is language-agnostic. This story extends dependency probing, mutation
coverage, and executability checks in order to uphold the methodology's language-agnostic promise — so Rust repositories and WASM-targeted Rust projects
participate in the same quality signals as TypeScript, Python, and Go projects. The
design must preserve the existing runtime-probe pattern and keep the G5 execution path
deterministic across plain Rust and wasm-bindgen projects.

## Acceptance Criteria

- [ ] `cargo`, `rustc`, and `wasm-pack` are added to the dependency registry with probe commands and install guidance
- [ ] Runtime detection includes probes for `cargo`, `rustc`, and `wasm-pack`
- [ ] Mutation analysis recognizes Rust source files and supports `cargo-mutants`
- [ ] `cargo mutants --json` output is mapped into the standard mutation schema and evaluated with the existing MT thresholds
- [ ] G5 detects Rust projects by `Cargo.toml` and runs `cargo test` by default
- [ ] G5 detects `wasm-bindgen` in `Cargo.toml` and prefers `wasm-pack test --headless` when `wasm-pack` is available
- [ ] WASM-targeted Rust projects emit a WARNING when `wasm-pack` is missing and fall back to `cargo test`

## ADR Required

No — this extends existing runtime-probe and test-runner patterns to another language family.

## Requirements

- PRD Rule R-41
- PRD Rule R-42
- PRD Rule R-43
- PRD Rule R-44

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | `cargo-mutants --json` exposes enough aggregate fields to map into the existing mutation report contract | The current design already normalizes other mutation runners into a shared shape | `assumed` |
| A-002 | Detecting `wasm-bindgen` in `Cargo.toml` is sufficient to distinguish WASM-targeted test execution from ordinary Rust test execution | The PRD defines this as the routing signal for v1 | `assumed` |
