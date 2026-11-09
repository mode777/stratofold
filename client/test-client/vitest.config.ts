import { defineConfig } from "vitest/config";

// Only the unit tests; e2e/*.spec.ts belongs to Playwright.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
