# ADR-005: Protocol Format and Versioning

## Status

Accepted

## Context

Story [002](../stories/002-get-protocol.md) makes `get_protocol` the self-describing contract
for the entire tool. The ADR-required questions are:

- how `protocol_version` increments
- whether protocol content is embedded or loaded from an external file
- how a caller detects protocol change between sessions

The current stories and implementation assumptions already point to a consistent answer:

- protocol content is embedded in the server
- `protocol_version` should be easy for LLMs to compare
- the response includes a retrieval timestamp

Because every session may begin with `get_protocol`, this decision affects upgrade behavior,
compatibility expectations, and how the tool remains its own source of truth.

## Decision

The protocol is embedded in the server runtime and exposed directly by `get_protocol`.

Versioning strategy:

- `protocol_version` is a monotonically increasing integer
- callers detect change by comparing the current integer to the last seen integer
- `generated_at` is always included so callers know when the protocol was retrieved
- protocol changes are tied to the shipped server version, but `protocol_version` remains a
  machine-comparison field rather than a semver string

Format strategy:

- `get_protocol` supports `text`, `json`, and `markdown`
- JSON is the machine-parseable canonical representation
- text and markdown are presentation formats derived from the embedded protocol data

## Consequences

- LLM callers get a simple comparison rule: newer integer means protocol changed.
- The tool remains self-contained because it does not depend on an external protocol file.
- Protocol updates ship atomically with server updates.
- Out-of-band protocol editing is intentionally not supported.
- Any future need for independently updatable protocol content would require a new ADR because
  it would change packaging and upgrade semantics.

## Alternatives Considered

### Semver-style protocol versioning

Rejected because integer comparison is simpler and less error-prone for machine clients that
only need to know whether the protocol is newer than their cached copy.

### Load protocol content from an external file

Rejected because it complicates deployment, path resolution, and version coupling for a tool
whose self-description should be available anywhere the binary runs.

### Text-first protocol with no canonical JSON form

Rejected because machine-parseable JSON is required for reliable client consumption without
post-processing.
