# Story 027: Evidence Artifacts

**Status:** Draft
**Created:** 2026-04-06
**Author:** GPT-5

## Intent

Release and performance claims need attached evidence, not just passing tests. This
story adds evidence checks that require verification artifacts for releases and benchmark
result files for performance-sensitive components. The goal is to keep production-facing
claims auditable without forcing a heavyweight evidence system into every project.

## Acceptance Criteria

- [ ] Release artifacts under `release/` are detected automatically
- [ ] Verification artifacts under `verification/` are matched against release artifact names and missing matches return `EV-1` VIOLATION
- [ ] Benchmark annotations in source files are detected across supported languages
- [ ] Benchmark result files under `benchmarks/` are matched against annotated components and missing matches return `EV-2` WARNING
- [ ] Evidence results are exposed through the `check_evidence` tool and persisted for metrics

## ADR Required

No — this adds artifact checks on top of existing repository structure.

## Requirements

- PRD Rule R-52
- PRD Rule R-53

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Directory-based conventions (`release/`, `verification/`, `benchmarks/`) are stable enough to use as evidence roots across supported projects | The PRD explicitly names these directories as the evidence locations | `assumed` |
| A-002 | Filename and content matching are sufficient to connect evidence artifacts to releases and benchmarked components in v1 | Structured evidence manifests would add complexity beyond the current PRD scope | `assumed` |
