// Browser E2E for Connected apps: minting shows the one-time token and
// the opaque connection string, while the durable list never exposes
// either secret. Runs against the seeded Go E2E harness; E2E is a
// build/verification-server gate, not a local one.

import { expect, test } from "@playwright/test";
import { login, nav, OWNER } from "./helpers";

test.describe("connected apps", () => {
  test("mints a token and shows the one-time connection string", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const name = `E2E app ${suffix}`;

    await login(page, OWNER);
    await nav(page, "settings");
    await page.getByTestId("settings-apps").click();
    await expect(page.getByTestId("apps-page")).toBeVisible();

    await page.getByTestId("token-name").fill(name);
    await page.getByTestId("token-mint").click();

    const panel = page.getByTestId("minted-token-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("minted-token")).toHaveText(/^sf_v1_/);
    await expect(page.getByTestId("minted-connection-string")).toHaveText(
      /^sfconn_v1_/,
    );
    await expect(panel).toContainText(
      "It contains the server URL, vdir, and token",
    );
    const token = await page.getByTestId("minted-token").textContent();
    const connectionString = await page
      .getByTestId("minted-connection-string")
      .textContent();

    // The durable list shows metadata only, never the one-time values.
    const row = page.getByTestId("token-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    expect(token).toBeTruthy();
    expect(connectionString).toBeTruthy();
    await expect(row).not.toContainText(token!);
    await expect(row).not.toContainText(connectionString!);

    await page.getByTestId("dismiss-token").click();
    await expect(panel).toBeHidden();
    await expect(page.getByText(/sfconn_v1_/)).toHaveCount(0);
  });
});
