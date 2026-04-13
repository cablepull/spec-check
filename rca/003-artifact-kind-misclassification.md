# RCA-003: Artifact Kind Misclassification in inferArtifactKind

## Summary

Story artifacts located in the `stories/` directory were being silently misclassified as
ADRs when their content contained the phrase "Alternatives Considered". This caused story
files to be validated against ADR criteria (A-1 through A-3) instead of story criteria
(S-1 through S-5), producing false VIOLATION results and an incorrect FAILING status for
the entire `stories/` directory.

Story 009 (`stories/009-artifact-validation.md`) was the concrete manifestation: it
documents ADR validation criteria including "Alternatives Considered" as a required ADR
section, so describing the rule caused the rule itself to fire incorrectly.

## Root Cause

In `src/artifacts.ts`, `inferArtifactKind` evaluated text-content heuristics before
path-based heuristics:

```ts
if (normal.includes("/adr/") || /^adr[-_]/.test(name) || /alternatives considered/i.test(text)) return "adr";
if (normal.includes("/rca/") || /^rca[-_]/.test(name) || /violated requirement/i.test(text)) return "rca";
if (normal.includes("/stories/") || /^\d{3}-/.test(name)) return "story";
```

Because the ADR text check (`/alternatives considered/i`) ran first, any file mentioning
ADR section names — including story files that describe those sections — was classified as
an ADR before the `/stories/` path check was ever reached.

## Violated Requirement

R-20 — Stories must have all required sections.

The story validation was never applied because the wrong artifact kind was returned;
instead ADR validation ran and emitted spurious VIOLATION results.

## Resolution

Reordered detection to prioritise directory path, then filename prefix, then text content:

```ts
if (normal.includes("/adr/")) return "adr";
if (normal.includes("/rca/")) return "rca";
if (normal.includes("/stories/")) return "story";
if (/^adr[-_]/.test(name)) return "adr";
if (/^rca[-_]/.test(name)) return "rca";
if (/^\d{3}-/.test(name)) return "story";
if (/alternatives considered/i.test(text)) return "adr";
if (/violated requirement/i.test(text)) return "rca";
```

Text content is now only used as a last resort for files not in a standard directory.
All 30 story artifacts, 6 ADRs, and 2 RCAs now validate correctly.

## Spec Update Required

No

## ADR Required

No

## Assumptions

- The detection priority (directory > filename prefix > text content) is the correct semantic
  ordering because canonical spec artifacts always live in their designated directories.
- Text-content fallback is retained for unconventional file locations (e.g. ad-hoc ADRs
  outside the `adr/` directory) where the path cannot be used.
