# Story 034: Storage and Rollup Integrity Hardening

**Status:** Implemented
**Created:** 2026-04-15
**Author:** GPT-5

## Intent

The local daemon and MCP runtime now support multiple projects and repeated tool
calls from multiple agents. The problem is that storage collisions and misleading
rollup metrics would make the shared runtime untrustworthy, because silent
overwrites or count-vs-rate confusion would corrupt the signals that other tools
and agents depend on. Storage and rollup metrics must therefore be correct
under concurrent writes and must report rates and counts that match the actual
project artifacts. The system must not silently overwrite parquet events, and the
cross-project rollup must only report metrics whose semantics are defensible.

## Acceptance Criteria

- [x] Storage writes produce unique parquet paths even when the same check type is
  written more than once in the same millisecond
- [x] Project registry persistence is written atomically
- [x] Rollup supersession values report project rates rather than raw counts
- [x] Rollup unresolved RCA counts are derived from current project RCA artifacts
- [x] Rollup model assumption accuracy counts assumptions made and invalidated per
  model
- [x] Rollup adoption trend reflects historical compliance movement over time

## ADR Required

Yes — see [ADR-009](../adr/009-storage-integrity-and-rollup-semantics.md)

## Requirements

- Requirement R-16
- Requirement R-18
- Requirement R-65
- Requirement R-68

## Assumptions

| ID | Assumption | Basis | Status |
|----|-----------|-------|--------|
| A-001 | Rollup metrics may combine parquet-derived event data with live filesystem scans when the metric describes current artifact state | Unresolved RCAs and assumption inventories are current-state signals, not only event streams | `assumed` |
| A-002 | Event filename uniqueness does not require a deterministic suffix as long as the timestamp prefix and artifact metadata remain visible | Querying is path-glob based, not filename-address based | `assumed` |
