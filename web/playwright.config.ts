import { defineConfig, devices } from "@playwright/test";

// E2E targets the Vite dev server (which proxies /api and /files to the
// Go E2E harness on 127.0.0.1:8090), per design D2/D7. Set
// SF_E2E_BASE_URL to run against an already-served stack (the
// verification server), and SF_E2E_EXECUTABLE to point at a specific
// browser binary (e.g. chrome-headless-shell).
const externalBaseURL = process.env.SF_E2E_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:5173";
const executablePath = process.env.SF_E2E_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command:
            'bash -lc \'export PATH="$HOME/.local/go/bin:$PATH"; cd .. && exec go run ./cmd/stratofold-e2e --http 127.0.0.1:8090\'',
          url: "http://127.0.0.1:8090/api/health",
          reuseExistingServer: true,
          timeout: 180_000,
        },
        {
          command: "npm run dev",
          url: "http://127.0.0.1:5173",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
