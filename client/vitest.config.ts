import { defineConfig } from "vitest/config";

// Keep Vitest inside the package's own tests: test-client has its own
// runner, and its Playwright specs must not be collected here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
