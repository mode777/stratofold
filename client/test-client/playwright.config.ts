import { defineConfig, devices } from "@playwright/test";

// Cross-origin E2E: the test client runs on 127.0.0.1:5174 and the real
// Stratofold stack (cmd/stratofold-e2e) on 127.0.0.1:8090. Two origins,
// so every browser request exercises the real preflight path.
//
// Set SF_E2E_BASE_URL to run against an already-served test client, and
// SF_E2E_EXECUTABLE to point at a specific browser binary (the
// verification server's chrome-headless-shell). Like the SPA suite, this
// is a verification-server gate, not a dev-container gate.
const externalBaseURL = process.env.SF_E2E_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:5174";
const executablePath = process.env.SF_E2E_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command:
            'bash -lc \'export PATH="$HOME/.local/go/bin:$PATH"; cd ../.. && exec go run ./cmd/stratofold-e2e --http 127.0.0.1:8090\'',
          url: "http://127.0.0.1:8090/api/health",
          reuseExistingServer: true,
          timeout: 240_000,
        },
        {
          command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
          url: "http://127.0.0.1:5174",
          reuseExistingServer: true,
          timeout: 180_000,
        },
      ],
});
