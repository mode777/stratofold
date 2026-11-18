// Browser E2E for writer bulk actions (web-ui spec, change
// add-bulk-file-actions): explicit selection in list and grid, select
// all/none, a multi-entry move through the pushed picker, a confirmed
// multi-entry delete, and a routed per-item failure that leaves the
// successful items applied.

import { expect, test, type Page } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByTestId("new-folder").click();
  await page.getByTestId("mkdir-name").fill(name);
  await page.getByTestId("mkdir-submit").click();
  await expect(entryRow(page, name)).toBeVisible();
}

async function enterSelection(page: Page): Promise<void> {
  await page.getByTestId("select-button").click();
  await expect(page.getByTestId("selection-bar")).toBeVisible();
}

async function selectEntry(page: Page, name: string): Promise<void> {
  await entryRow(page, name).getByTestId("entry-select").click();
}

test.describe("bulk actions", () => {
  test("selects in list and grid and moves entries into docs", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const stamp = Date.now().toString(36);
    const first = `bulk-${stamp}-a`;
    const second = `bulk-${stamp}-b`;
    await createFolder(page, first);
    await createFolder(page, second);

    await enterSelection(page);

    // Select all / deselect all cover the current listing without
    // performing an action.
    const listed = await page.locator("[data-entry-name]").count();
    await page.getByTestId("select-all-toggle").click();
    await expect(page.getByTestId("selection-count")).toHaveText(`${listed} selected`);
    await page.getByTestId("select-all-toggle").click();
    await expect(page.getByTestId("selection-count")).toHaveText("0 selected");

    // Select one entry in list view, switch to grid, select the other,
    // then move both into docs.
    await selectEntry(page, first);
    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("grid-row-0")).toBeVisible();
    await selectEntry(page, second);
    await expect(page.getByTestId("selection-count")).toHaveText("2 selected");

    // Return to list view for the pushed move picker and the rest of
    // the flow; the selection survives the view switch.
    await page.getByTestId("view-list").click();
    await expect(page.getByTestId("grid-row-0")).toHaveCount(0);

    await page.getByTestId("bulk-move").click();
    await expect(page.getByTestId("move-title")).toHaveText("Move 2 items");
    await page.getByTestId("move-folder").filter({ hasText: "docs" }).click();
    await expect(page.getByTestId("move-submit")).toBeEnabled();
    await page.getByTestId("move-submit").click();

    await expect(entryRow(page, first)).toHaveCount(0);
    await expect(entryRow(page, second)).toHaveCount(0);

    await entryRow(page, "docs").getByTestId("open-dir").click();
    await expect(entryRow(page, first)).toBeVisible();
    await expect(entryRow(page, second)).toBeVisible();

    // Delete the two moved folders with the selection bar and the
    // confirmation alert.
    await enterSelection(page);
    await selectEntry(page, first);
    await selectEntry(page, second);
    await page.getByTestId("bulk-delete").click();
    await expect(page.getByTestId("alert")).toContainText("Delete 2 items?");
    await page.getByTestId("bulk-delete-confirm").click();
    await expect(entryRow(page, first)).toHaveCount(0);
    await expect(entryRow(page, second)).toHaveCount(0);
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  });

  test("applies the successful items and reports a routed failure", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const stamp = Date.now().toString(36);
    const ok = `bulk-${stamp}-ok`;
    const bad = `bulk-${stamp}-bad`;
    await createFolder(page, ok);
    await createFolder(page, bad);

    await page.route("**/rm", async (route) => {
      const body = route.request().postDataJSON() as { path: string };
      if (body.path === bad) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ message: "Not found." }),
        });
        return;
      }
      await route.continue();
    });

    await enterSelection(page);
    await selectEntry(page, ok);
    await selectEntry(page, bad);
    await page.getByTestId("bulk-delete").click();
    await page.getByTestId("bulk-delete-confirm").click();

    await expect(page.getByTestId("bulk-result")).toBeVisible();
    await expect(page.getByTestId("bulk-result-summary")).toHaveText(
      "Deleted 1 of 2 items. 1 failed.",
    );
    await expect(page.getByTestId("bulk-result-failure")).toContainText(`${bad} (not found)`);
    await expect(entryRow(page, ok)).toHaveCount(0);
    await expect(entryRow(page, bad)).toBeVisible();

    // Clean up after the notice is dismissed with the route removed.
    await page.unroute("**/rm");
    await page.getByTestId("bulk-result-dismiss").click();
    await enterSelection(page);
    await selectEntry(page, bad);
    await page.getByTestId("bulk-delete").click();
    await page.getByTestId("bulk-delete-confirm").click();
    await expect(entryRow(page, bad)).toHaveCount(0);
  });
});
