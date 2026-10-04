/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Same-origin rule (design D2): the dev server proxies /api and /files
// to the Go server so the sf_session cookie and /files/* work with no
// CORS anywhere. Production serves the build output from pb_public
// (change 9 swaps in go:embed) — no proxy assumptions encoded here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8090",
      "/files": "http://127.0.0.1:8090",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
    globals: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
