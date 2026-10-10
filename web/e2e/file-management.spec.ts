// Browser E2E for the write path and upload manager (web-ui +
// upload-queue specs, design D8) against the dev server + Go E2E
// harness. The R7 acceptance test lives here: a large upload keeps
// going while the user navigates away.

import { expect, test } from "@playwright/test";
import { GRANTEE, OWNER, entryRow, login, logout, nav, openHome, openSharing } from "./helpers";

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
    await nav(page, "uploads");
    const smallItem = page.getByTestId("upload-item").filter({ hasText: "small.txt" });
    await expect(smallItem).toContainText("Done");

    // Back to Home for the large upload.
    await openHome(page);

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

    // Navigate away while it is still uploading (the R7 acceptance test):
    // the Uploads destination stays reachable via the floating indicator.
    await nav(page, "settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("floating-upload-indicator")).toBeVisible();

    // Lift the throttle and confirm it still completes off-page.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await nav(page, "uploads");
    const largeItem = page.getByTestId("upload-item").filter({ hasText: "large.bin" });
    await expect(largeItem).toContainText("Done", { timeout: 30_000 });

    // Back on Home, the published file is listed.
    await openHome(page);
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

    await nav(page, "uploads");
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

    await entryRow(page, created).getByTestId("entry-actions").click();
    await page.getByTestId("action-rename").click();
    await page.getByTestId("rename-name").fill(renamed);
    await page.getByTestId("rename-submit").click();
    await expect(entryRow(page, renamed)).toBeVisible();

    await entryRow(page, renamed).getByTestId("entry-actions").click();
    await page.getByTestId("action-move").click();
    await page.getByTestId("move-folder").filter({ hasText: "docs" }).click();
    await page.getByTestId("move-submit").click();
    await expect(entryRow(page, renamed)).toHaveCount(0);

    await page.getByTestId("open-dir").filter({ hasText: "docs" }).click();
    await expect(entryRow(page, renamed)).toBeVisible();

    await entryRow(page, renamed).getByTestId("entry-actions").click();
    await page.getByTestId("action-delete").click();
    await page.getByTestId("delete-confirm").click();
    await expect(entryRow(page, renamed)).toHaveCount(0);
  });

  test("a viewer is offered no write affordances", async ({ page }) => {
    // Owner grants a viewer share.
    await login(page, OWNER);
    await openSharing(page);
    await page.getByLabel("Share with (email)").fill(GRANTEE.email);
    await page.getByTestId("s-grant").click();
    await expect(page.getByTestId("share-row")).toBeVisible();

    // Grantee browses the shared vdir and sees no write actions.
    await logout(page);
    await login(page, GRANTEE);
    await page.getByTestId("group-shared-with-me").getByRole("button", { name: /Home/ }).click();
    await expect(page.getByTestId("entry-0")).toBeVisible();
    await expect(page.getByTestId("new-folder")).toHaveCount(0);
    await expect(page.getByTestId("upload-input")).toHaveCount(0);

    await entryRow(page, "hello.txt").getByTestId("entry-actions").click();
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await expect(page.getByTestId("action-rename")).toHaveCount(0);
    await page.getByTestId("context-dismiss").click();

    // Clean up the share so other specs see the seeded state.
    await logout(page);
    await login(page, OWNER);
    await openSharing(page);
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByTestId("share-row")).toHaveCount(0);
  });
});

// Mobile-viewport coverage for fix-web-ui-and-session-lifetime: the
// preview screen navigates back to its containing directory, and the
// write actions live in the folder header while the toolbar stays
// view-controls-only — everything fully on-screen (no cut-off).
test.describe("preview navigation and header actions", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("preview back returns to the containing directory", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "hello.txt").getByTestId("open-preview").click();
    await expect(page.getByTestId("preview-download")).toBeVisible();

    await page.getByTestId("back").click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("Home");
    await expect(entryRow(page, "hello.txt")).toBeVisible();
  });

  test("write actions live in the folder header at a mobile viewport", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const header = page.getByTestId("header-actions");
    const newFolder = header.getByTestId("new-folder");
    const uploadButton = header.getByTestId("upload-button");
    await expect(newFolder).toBeVisible();
    await expect(uploadButton).toBeVisible();

    // Above the breadcrumbs, and inside the viewport width.
    const actionsBox = (await header.boundingBox())!;
    const crumbsBox = (await page.getByTestId("breadcrumbs").boundingBox())!;
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(crumbsBox.y + 1);
    const width = page.viewportSize()!.width;
    for (const box of [actionsBox, (await newFolder.boundingBox())!, (await uploadButton.boundingBox())!]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    // The compact toolbar holds only the view controls.
    const toolbar = page.getByTestId("toolbar");
    await expect(toolbar.getByTestId("sort-key")).toBeVisible();
    await expect(toolbar.getByTestId("view-grid")).toBeVisible();
    await expect(toolbar.getByTestId("new-folder")).toHaveCount(0);
    await expect(toolbar.getByTestId("upload-button")).toHaveCount(0);
  });
});
