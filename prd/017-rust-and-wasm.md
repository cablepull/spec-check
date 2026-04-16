# PRD: Feature F-17: Rust And Wasm

## Feature F-17: Rust and WASM Language Support

### Rule R-41: Validate the dependency check discovers Rust toolchain components
Example: Rust toolchain components are present and each listed as installed
  Given cargo, rustc, and wasm-pack are each present on the system path
  When check_dependencies is called
  Then cargo, rustc, and wasm-pack are each listed as installed
  And the version string for each is included in the result

Example: A missing Rust toolchain component is reported with install guidance
  Given cargo and rustc are present on the system path but wasm-pack is absent
  When check_dependencies is called
  Then wasm-pack is listed as missing
  And an install command is shown for each available package manager

### Rule R-42: Validate Rust source files are eligible for mutation testing via cargo-mutants
Example: Mutation score is computed for a Rust project with cargo-mutants installed
  Given a Rust project with .rs source files and cargo-mutants present on the system path
  When check_mutation_score is called
  Then a mutation score is returned
  And the result includes the count of mutants generated and the count killed

Example: Absent cargo-mutants produces a structured missing-tool result
  Given a Rust project with .rs source files and no cargo-mutants installation on the system path
  When check_mutation_score is called
  Then cargo-mutants is listed as the missing tool
  And an install command is shown
  And no partial mutation score is returned

### Rule R-43: Validate G5 executability check executes cargo test for Rust projects
Example: cargo test outcome is included in the executability result
  Given a Rust project with test files in a tests/ directory and cargo present on the system path
  When check_executability is called
  Then cargo test is executed
  And its exit code is included in the criterion E-1 result

Example: A failing cargo test run produces a BLOCK result
  Given a Rust project where cargo test exits with a non-zero status
  When check_executability is called
  Then criterion E-1 status is BLOCK
  And the cargo test stderr output is included in the result

### Rule R-44: Validate G5 detects wasm-pack test as the test command for WASM-targeted Rust projects
Example: wasm-pack test is identified as the test command for a WASM project
  Given a Rust project with a Cargo.toml file containing wasm-bindgen as a dependency and wasm-pack present on the system path
  When check_executability is called
  Then wasm-pack test --headless is listed as the detected test command in the result

Example: A WASM project with wasm-pack absent surfaces a warning and falls back to cargo test
  Given a Rust project with a Cargo.toml file containing wasm-bindgen as a dependency and wasm-pack absent from the system path
  When check_executability is called
  Then a WARNING is returned noting wasm-pack is absent
  And cargo test is listed as the fallback test command in the result

---
