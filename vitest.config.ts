import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Prevent vitest from picking up stryker mutation-testing sandboxes.
    // Stryker creates .stryker-tmp/sandbox-*/  copies of the test suite and
    // runs them itself; including them here causes double-counting and spurious
    // failures when the sandbox dist is out of date with the local build.
    exclude: [".stryker-tmp/**", "node_modules/**"],
  },
});
