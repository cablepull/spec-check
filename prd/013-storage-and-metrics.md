# PRD: Feature F-13: Storage And Metrics

## Feature F-13: Storage and Metrics

### Rule R-33: Validate Every check run must be persisted to a Parquet file
Example: Successful run produces a Parquet file
  Given `run_all` is called on a project at `path`
  When the run completes
  Then a Parquet file is written at the path derived from the naming convention
  And the file contains all columns from the gate check schema

Example: Persistence failure does not block analysis results
  Given the storage root is not writable
  When `run_all` is called
  Then the analysis results are returned to the caller
  And a write failure is logged to stderr
  And no error is returned in the tool response

### Rule R-34: Validate Cross-project metrics must be queryable by glob
Example: All Claude runs across all projects
  Given Parquet files exist for multiple projects and multiple models
  When `get_rollup` is called
  Then compliance scores are computed per project and per model
  And models are ranked by gate pass rate

---
