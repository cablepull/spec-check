# ADR-002: Rule-Based NLP and No Embedding Dependency in v1

## Status

Accepted

## Context

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
