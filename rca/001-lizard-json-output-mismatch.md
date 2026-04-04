# RCA-001: lizard JSON Output Assumption Was Incorrect

## Summary

Tier 2 complexity analysis was specified and initially implemented under the assumption that
`lizard` exposed a JSON CLI output mode. During live verification with `lizard 1.21.3`,
the command-line tool rejected `--json` as an unsupported argument. This created a mismatch
between the written spec and the actual third-party tool behavior.

## Root Cause

The team inferred a JSON-capable lizard interface without validating the installed CLI against
the story and design assumptions before finalizing the Tier 2 acceptance language.

The implementation discovered the issue only when exercising the real dependency, which means
the defect was in the spec and design assumptions rather than in the architectural intent.

## Violated Requirement

Story [013](../stories/013-complexity-tier2.md), acceptance criterion:
"For Tier 2 languages, lizard is invoked with `--output-format json`; output is parsed into the standard per-function metrics schema"

Related design assumption:
[design.md](../design.md) Tier 2 description and assumption A4 previously claimed JSON output.

## Resolution

- Verified the real CLI surface of `lizard 1.21.3` and confirmed that `--json` is unsupported.
- Updated Tier 2 implementation to use lizard's supported machine-readable CSV output path.
- Updated [stories/013-complexity-tier2.md](../stories/013-complexity-tier2.md) to require a supported machine-readable output format instead of JSON specifically.
- Updated [design.md](../design.md) and [tasks.md](../tasks.md) to remove the incorrect JSON-specific claim.
- Re-ran Tier 2 analysis against a Java fixture to confirm real lizard-backed parsing now works.

## Spec Update Required

Yes

## ADR Required

No

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | The architectural intent of ADR-003 remains valid because the failure was in the transport detail of lizard output, not in the tiered analysis decision itself | The decision to use external `lizard` for Tier 2 still stands after verification | `assumed` |
| A-002 | Lizard CSV remains sufficient for v1 because Tier 2 only requires CC, length, location, and parameter count from the external tool | The current parser successfully extracts the fields needed for the standard schema | `assumed` |
