# PRD: Global Assumptions

## Assumptions

| # | Assumption | Basis | Impact if wrong |
|---|-----------|-------|-----------------|
| A1 | Generic technology categories appearing in requirements are detection examples, not implementation choices | Inferred from the tool's purpose; examples are used to clarify what leakage the checker should flag | If the examples are interpreted as commitments, the requirements would incorrectly constrain implementation |
| A2 | The spec-driven hierarchy (Feature → Rule → Example → GWT) is the primary structure to validate | Chosen because specdriven.com defines this as the canonical structure | Tools using different hierarchies would need additional parsers |
| A3 | Gherkin-style Given/When/Then is the only acceptable example format | Defaulted to; user did not specify alternative formats | Free-form examples would require a different parser path |
| A4 | Rule IDs (R-N) and Feature IDs (F-N) will appear in the document text for cross-referencing | Assumed because design and task traceability depend on matching these exact patterns | Cross-reference checks would fail silently if different ID schemes are used |
