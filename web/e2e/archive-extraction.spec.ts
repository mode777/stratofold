// Browser E2E for archive extraction (archive-extraction spec) against
// the dev server + Go E2E harness: extract a seeded zip from the context
// menu and find the folder beside it without a manual reload.

import { expect, test } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

test.describe("archive extraction", () => {
  test("extracts a zip into a folder beside it", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const archive = entryRow(page, "bundle.zip");
    await expect(archive).toBeVisible();
    await archive.getByTestId("entry-actions").click();
    await page.getByTestId("action-extract").click();

    // The confirmation names the derived folder before anything starts.
    await expect(page.getByTestId("extract-name")).toHaveValue("bundle");
    await page.getByTestId("extract-submit").click();

    // The job runs server-side; the listing refreshes itself when it
    // settles, so the folder appears without a reload.
    const folder = entryRow(page, "bundle");
    await expect(folder).toBeVisible({ timeout: 30_000 });

    await folder.getByTestId("open-dir").click();
    await expect(entryRow(page, "readme.txt")).toBeVisible();
    await expect(entryRow(page, "nested")).toBeVisible();
    // macOS metadata is skipped, not extracted.
    await expect(entryRow(page, "__MACOSX")).toHaveCount(0);
  });
});
