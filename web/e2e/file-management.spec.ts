// Browser E2E for the write path and upload manager (web-ui +
// upload-queue specs, design D8) against the dev server + Go E2E
// harness. The R7 acceptance test lives here: a large upload keeps
// going while the user navigates away.

import { expect, test } from "@playwright/test";
import { GRANTEE, OWNER, entryRow, login, logout, openHome } from "./helpers";

test.describe("uploads", () => {
  test("small and large uploads report progress and survive navigation", async ({ page, context }) => {
    await login(page, OWNER);
    await openHome(page);

    // Small file: enqueued and completed through the manager.
    await page.getByTestId("upload-input").setInputFiles({
      name: "small.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("small upload\n"),
    });
    const smallItem = page.getByTestId("upload-item").filter({ hasText: "small.txt" });
    await expect(smallItem).toContainText("Done");

    // Throttle the browser's upload throughput so the large file is
    // genuinely mid-flight when the user navigates away.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: 1_000_000,
    });

    await page.getByTestId("upload-input").setInputFiles({
      name: "large.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(3 * 1024 * 1024, 7),
    });
    const largeItem = page.getByTestId("upload-item").filter({ hasText: "large.bin" });
    await expect(largeItem).toContainText("Uploading");

    // Navigate away while it is still uploading (the R7 acceptance test).
    await page.getByRole("link", { name: "Connections" }).click();
    await expect(page.getByTestId("connections-page")).toBeVisible();
    await expect(largeItem).toContainText("Uploading");

    // Lift the throttle and confirm it still completes off-page.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await expect(largeItem).toContainText("Done", { timeout: 30_000 });

    // Back on Home, the published file is listed.
    await page.getByRole("link", { name: "Stratofold" }).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("Home");
    await expect(entryRow(page, "large.bin")).toBeVisible();
  });

  test("a permanent upload failure is surfaced without a retry storm", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    let uploads = 0;
    await page.route("**/upload*", (route) => {
      uploads += 1;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "Forbidden." }),
      });
    });

    await page.getByTestId("upload-input").setInputFiles({
      name: "denied.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByTestId("upload-error")).toContainText("Forbidden");

    // No automatic retries for a permanent class.
    await page.waitForTimeout(1_000);
    expect(uploads).toBe(1);
  });
});

test.describe("file management", () => {
  test("creates, renames, moves, and deletes an entry", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const stamp = Date.now().toString(36);
    const created = `e2e-${stamp}`;
    const renamed = `e2e-${stamp}-r`;

    await page.getByTestId("new-folder").click();
    await page.getByTestId("mkdir-name").fill(created);
    await page.getByTestId("mkdir-submit").click();
    await expect(entryRow(page, created)).toBeVisible();

    await entryRow(page, created).getByTestId("action-rename").click();
    await page.getByTestId("rename-name").fill(renamed);
    await page.getByTestId("rename-submit").click();
    await expect(entryRow(page, renamed)).toBeVisible();

    await entryRow(page, renamed).getByTestId("action-move").click();
    await page.getByTestId("move-to").fill(`docs/${renamed}`);
    await page.getByTestId("move-submit").click();
    await expect(entryRow(page, renamed)).toHaveCount(0);

    await page.getByTestId("open-dir").filter({ hasText: "docs" }).click();
    await expect(entryRow(page, renamed)).toBeVisible();

    await entryRow(page, renamed).getByTestId("action-delete").click();
    await page.getByTestId("delete-confirm").click();
    await expect(entryRow(page, renamed)).toHaveCount(0);
  });

  test("a viewer is offered no write affordances", async ({ page }) => {
    // Owner grants a viewer share.
    await login(page, OWNER);
    await page.getByRole("link", { name: "Vdirs", exact: true }).click();
    await page.getByTestId(/^shares-vdir-/).first().click();
    await page.getByLabel("Share with (email)").fill(GRANTEE.email);
    await page.getByTestId("s-grant").click();
    await expect(page.getByTestId("share-row")).toBeVisible();
    await page.getByLabel("Close dialog").click();

    // Grantee browses the shared vdir and sees no write actions.
    await logout(page);
    await login(page, GRANTEE);
    await page.getByTestId("group-shared-with-me").getByRole("button", { name: /Home/ }).click();
    await expect(page.getByTestId("entry-0")).toBeVisible();
    await expect(page.getByTestId("new-folder")).toHaveCount(0);
    await expect(page.getByTestId("upload-input")).toHaveCount(0);
    await expect(page.getByTestId("action-rename")).toHaveCount(0);

    // Clean up the share so other specs see the seeded state.
    await logout(page);
    await login(page, OWNER);
    await page.getByRole("link", { name: "Vdirs", exact: true }).click();
    await page.getByTestId(/^shares-vdir-/).first().click();
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByTestId("share-row")).toHaveCount(0);
    await page.getByLabel("Close dialog").click();
  });
});
