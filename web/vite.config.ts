/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Same-origin rule (design D2): the dev server proxies /api, /files,
// /s, and /apps to the Go server so the sf_session cookie, file
// streaming, and pretty public URLs work with no CORS anywhere.
// Production serves the build output from the same Go listener
// (go:embed) — no proxy assumptions encoded here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8090",
      // Alias browse/preview shells must come from Vite in dev (the Go
      // binary embeds the production shell, which does not exist as a
      // Vite app in dev). Proxy only direct-file-shaped alias paths;
      // extensionless direct files remain a production-only nicety.
      "/apps": {
        target: "http://127.0.0.1:8090",
        bypass(req) {
          const url = (req.url ?? "").split("?")[0];
          const rest = url.replace(/^\/apps\/[^/]+/, "");
          const directFile =
            rest !== "" &&
            !rest.endsWith("/") &&
            !rest.startsWith("/view") &&
            /\.[^/]+$/.test(rest);
          return directFile ? undefined : url;
        },
      },
      "/files": "http://127.0.0.1:8090",
      "/s/": "http://127.0.0.1:8090",
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
