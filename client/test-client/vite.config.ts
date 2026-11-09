import { defineConfig, loadEnv } from "vite";

// The test client is deployed to a repository subpath on GitHub Pages.
// Local builds default to "/" and can override with SF_CLIENT_BASE.
const base = process.env.SF_CLIENT_BASE ?? "/";

// Any VITE_SF_* value is a local convenience prefill (base URL, token,
// vdir). It may exist in a gitignored .env.local during development,
// but must never be embedded in a deployable bundle — the Pages site is
// public.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_SF_");
  const present = Object.entries(env)
    .filter(([key, value]) => key.startsWith("VITE_SF_") && value)
    .map(([key]) => key);
  if (command === "build" && present.length > 0) {
    throw new Error(
      `Refusing to build the Pages bundle with ${present.join(", ")} set. ` +
        "Those values are development-only and must not enter a public build.",
    );
  }
  return {
    base,
    build: { target: "es2020" },
  };
});
