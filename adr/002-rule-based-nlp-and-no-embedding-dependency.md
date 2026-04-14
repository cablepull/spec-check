# ADR-002: Rule-Based NLP and No Embedding Dependency in v1

## Status

Accepted

## Context

The rule-based NLP approach decided here governs text classification across all features:
F-1, F-2, F-3, F-4, F-5, F-6, F-7, F-8, F-9, F-10, F-11, F-12, F-13, F-14, F-15,
F-16, F-17, F-18, F-19, F-20, F-21, F-22, F-23.
Rules directly governed by signal-matching and heuristic detection:
R-2, R-3, R-4, R-5, R-6, R-7, R-8, R-9, R-10, R-11, R-12, R-13, R-14, R-15, R-16,
R-17, R-18, R-19, R-20, R-21, R-22, R-23, R-24, R-25, R-26, R-27, R-28, R-29, R-30,
R-31, R-32, R-33, R-34, R-35, R-36, R-37, R-38, R-39, R-40, R-41, R-42, R-43, R-44,
R-45, R-46, R-47, R-48, R-49, R-50, R-51, R-52, R-53, R-54, R-55, R-56, R-57, R-58,
R-59.

Multiple stories depend on lightweight NLP behavior:

- Story [003](../stories/003-gate-1-intent.md) for intent checks
- Story [006](../stories/006-gate-4-tasks.md) for task traceability
- Story [007](../stories/007-gate-5-executability.md) for rule-to-test correspondence
- Intent checks for causal language, constraints, ordering, and implementation leakage
- Requirements checks for imperative rules, negative examples, action verbs, compound clauses,
  and observable outcomes
- Task and test traceability use exact matching first and may use a semantic second pass
- Assumption validation checks for certainty language

The PRD consistently describes these checks as rule-based NLP with tunable thresholds and
explicit signal patterns. The stories also repeatedly assume deterministic keyword/pattern
matching for v1 and reference this ADR for any semantic-matching boundary.

The architectural question is whether v1 should depend on a local embedding model or vector
similarity layer, or whether it should stay with rule-based NLP and limited heuristic matching.

## Decision

v1 uses rule-based NLP and deterministic heuristic matching, not a local embedding model.

The NLP contract is:

- core checks use explicit lexical and structural signals
- NLP functions return confidence scores
- thresholds are applied outside the NLP engine
- exact or keyword matching is the default for traceability and correspondence checks
- any semantic second pass in v1 remains heuristic and dependency-free
- no embedding model, vector store, or model-serving runtime is required for v1

This keeps the gate behavior local, explainable, configurable, and deterministic enough to
support the correction loop described in the PRD.

## Consequences

- NLP checks remain cheap, portable, and inspectable.
- Users can understand why a criterion fired because evidence comes from visible signals.
- Threshold tuning remains a configuration concern rather than a model-selection concern.
- Semantic matching in v1 is intentionally limited and may miss paraphrases that an embedding
  model could recover.
- If future semantic recall needs justify it, embeddings can be added as a later ADR rather
  than being baked into the v1 runtime contract.

## Alternatives Considered

### Local embedding model in v1

Rejected because it increases runtime complexity, packaging burden, explainability cost, and
platform support surface for a tool whose primary value is deterministic enforcement.

### Remote embedding or API-based semantic matching

Rejected because the product must run locally with no network dependency and no data leaving
the machine during enforcement.

### Pure exact-match only

Rejected because some checks benefit from limited heuristic interpretation beyond literal
string equality, but those heuristics can still be implemented without embeddings.
