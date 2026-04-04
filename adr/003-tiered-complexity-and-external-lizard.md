# ADR-003: Tiered Complexity Analysis with External lizard Dependency

## Status

Accepted

## Context

Stories [012](../stories/012-complexity-tier1.md) and [013](../stories/013-complexity-tier2.md)
require a decision on how `check_complexity` should cover multiple languages while keeping
the tool self-contained, portable, and honest about missing capability.

[RCA-001](../rca/001-lizard-json-output-mismatch.md) later confirmed that the original
Tier 2 specification assumed a preferred JSON output mode that the real `lizard` CLI does
not provide. That RCA narrowed the question from "which Tier 2 dependency should we use"
to "how should `spec-check` behave when an accepted external dependency does not expose the
preferred interface shape."

The competing pressures are:

- TypeScript, JavaScript, Python, and Go should work out of the box with no extra installs.
- Java, C, C++, C#, Ruby, Swift, Rust, Scala, and Kotlin still need a supported analysis path.
- Cognitive complexity and nesting depth are available from bundled AST analysis but not from
  `lizard` for Tier 2 languages in v1.
- `spec-check` may be distributed via GitHub releases, npm, or Homebrew, so coupling the core
  release artifact to a Python CLI dependency would make packaging and support more brittle.
- The tool must degrade explicitly when a dependency is missing rather than silently omitting data.

This ADR is triggered by the architectural scope of the complexity subsystem and by the need to
decide how an external analysis tool is installed and discovered at runtime.

## Decision

`check_complexity` will use a two-tier analysis model.

- Tier 1 is the primary path for TypeScript, JavaScript, Python, and Go.
  These analyzers are bundled with `spec-check` and run without external package installation.
- Tier 2 is the fallback path for non-Tier-1 languages and uses an external, PATH-visible
  `lizard` binary.
- `spec-check` will not bundle `lizard` inside the core release artifact.
- The runtime contract for Tier 2 is: if `lizard` is available on `PATH`, `spec-check` uses it;
  if it is missing, the tool returns a structured dependency-missing result with install guidance.
- The preferred install path for `lizard` is `pipx install lizard`.
- The supported fallback install path is `pip install lizard`.
- Release packaging for `spec-check` may document companion installation paths for `lizard`,
  but the release artifact itself does not own the `lizard` binary.
- When a verified external dependency cannot provide the preferred output contract, `spec-check`
  prefers to keep the dependency if it still satisfies the project intent and to own a local
  normalization adapter layer rather than inventing unsupported flags or silently degrading the
  contract.
- For Tier 2 specifically, `spec-check` accepts `lizard`'s real supported machine-readable output
  and normalizes it into the standard complexity schema. RCA-001 is the recorded justification for
  that adaptation.

## Consequences

- Tier 1 remains fast, deterministic, and self-contained for the languages most common in the
  current project set.
- Tier 2 coverage is available without implementing and maintaining custom parsers for every
  non-Tier-1 language.
- Homebrew, GitHub release, and npm packaging stay simpler because the core tool does not need
  to vendor a Python CLI.
- Users retain flexibility: any installation method that makes `lizard` visible on `PATH`
  satisfies the runtime contract.
- Tier 2 output must explicitly mark unsupported metrics such as cognitive complexity and nesting
  depth as unavailable rather than fabricating values.
- `check_dependencies` and `install_dependency("lizard")` become part of the expected operator
  workflow for enabling Tier 2 analysis.
- Support documentation must explain that Tier 2 is optional capability, not bundled baseline.
- `spec-check` owns the adapter boundary between its internal schema and the real `lizard` output
  format, so upstream CLI/output changes become an explicit maintenance responsibility.
- When a third-party integration diverges from the preferred design, the expected response is to
  record the defect in an RCA and then amend the governing ADR if the chosen resolution changes the
  durable integration contract.

## Alternatives Considered

### lizard-first for all languages

Rejected because it would make the common-path languages depend on an external install and would
forfeit richer bundled metrics where native AST analysis is already feasible.

### Bundle lizard inside spec-check

Rejected because it couples Node/Homebrew release packaging to a Python CLI distribution model,
increases maintenance cost, and narrows the available installation strategies.

### Tier 1 only with no Tier 2 fallback

Rejected because it would leave non-Tier-1 languages without any supported complexity analysis,
which conflicts with the cross-language goals in the PRD.

### Package-manager-specific ownership of lizard

Rejected because it would tie the runtime contract to a specific distribution channel instead of
accepting any valid PATH-visible installation.

### Reject lizard because it lacks the preferred JSON output

Rejected because the missing JSON mode is an interface mismatch, not a failure of the underlying
architectural role. The supported CSV output is sufficient for v1 Tier 2 metrics once normalized by
`spec-check`, as documented in [RCA-001](../rca/001-lizard-json-output-mismatch.md).
