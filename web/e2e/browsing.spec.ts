// Browser E2E for the SPA (web-ui spec) against the dev server + Go E2E
// harness (design D7). The harness seeds owner/grantee users, a private
// "Home" vdir and a public "Public" vdir over a dataset with hello.txt,
// a media file, docs/, and a 10k-entry big/ directory.

import { expect, test } from "@playwright/test";
import { GRANTEE, OWNER, entryRow, login, logout, nav, openHome, openSharing } from "./helpers";

test.describe("browsing", () => {
  test("login → browse → download", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await expect(page.getByTestId("entry-0")).toBeVisible();
    await expect(page.getByText("hello.txt")).toBeVisible();

    // Download lives in the entry's context menu.
    await entryRow(page, "hello.txt").getByTestId("entry-actions").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("action-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe("hello.txt");
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    expect(await fs.readFile(path!, "utf8")).toBe("hello stratofold\n");
  });

  test("list/grid, sorting, and directory navigation", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    // Enter docs/ (directories sort first: big, docs) and back.
    await page.getByTestId("open-dir").filter({ hasText: "docs" }).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("docs");
    await expect(page.getByText("readme.md")).toBeVisible();
    await page.getByTestId("breadcrumbs").getByRole("link", { name: "Home" }).click();
    await expect(page.getByText("hello.txt")).toBeVisible();

    // Sort by size descending, then switch to grid.
    await page.getByTestId("sort-key").selectOption("size");
    await page.getByTestId("sort-direction").click();
    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("grid-row-0")).toBeVisible();
    await page.getByTestId("view-list").click();
    await expect(page.getByTestId("entry-0")).toBeVisible();
  });

  test("a 10k-entry directory stays virtualized and reaches the last entry", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await page.getByTestId("open-dir").filter({ hasText: "big" }).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("big");
    await expect(page.getByTestId("entry-0")).toBeVisible();

    const rendered = await page.locator('[data-testid^="entry-"]').count();
    expect(rendered).toBeLessThan(100);

    const scroll = page.getByTestId("entry-scroll");
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByText("file-09999.txt")).toBeVisible();
  });

  test("media opens in a new tab and /files serves Range requests", async ({ page, context }) => {
    const ranges: string[] = [];
    context.on("request", (req) => {
      if (req.url().includes("/files/") && req.url().includes("movie.mp4")) {
        const range = req.headers()["range"];
        if (range) ranges.push(range);
      }
    });

    await login(page, OWNER);
    await openHome(page);

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByTestId("open-media").first().click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toContain("/files/");
    expect(popup.url()).toContain("movie.mp4");

    const movieUrl = popup.url();
    const first = await popup.evaluate(async (url) => {
      const resp = await fetch(url, { headers: { Range: "bytes=0-9" } });
      return { status: resp.status, len: (await resp.arrayBuffer()).byteLength };
    }, movieUrl);
    expect(first.status).toBe(206);
    expect(first.len).toBe(10);

    const seek = await popup.evaluate(async (url) => {
      const resp = await fetch(url, { headers: { Range: "bytes=10-19" } });
      return { status: resp.status, len: (await resp.arrayBuffer()).byteLength };
    }, movieUrl);
    expect(seek.status).toBe(206);
    expect(seek.len).toBe(10);

    expect(ranges.length).toBeGreaterThan(0);
  });

  test("share grant, grantee access, and immediate revocation", async ({ page }) => {
    // Owner grants viewer to the grantee.
    await login(page, OWNER);
    await openSharing(page);
    await page.getByLabel("Share with (email)").fill(GRANTEE.email);
    await page.getByTestId("s-grant").click();
    await expect(page.getByTestId("share-row")).toBeVisible();

    // Grantee sees the shared vdir and can browse it.
    await logout(page);
    await login(page, GRANTEE);
    const shared = page.getByTestId("group-shared-with-me");
    await expect(shared).toContainText("Home");
    await shared.getByRole("button", { name: /Home/ }).click();
    await expect(page.getByText("hello.txt")).toBeVisible();

    // Owner revokes; the grantee loses access on the next request.
    await logout(page);
    await login(page, OWNER);
    await openSharing(page);
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByTestId("share-row")).toHaveCount(0);

    await logout(page);
    await login(page, GRANTEE);
    await expect(page.getByTestId("group-shared-with-me")).toContainText("Nothing shared with you");
  });

  test("logout ends the session", async ({ page }) => {
    await login(page, OWNER);
    await logout(page);
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByTestId("locations")).toHaveCount(0);
  });
});

test.describe("responsive and keyboard", () => {
  test("mobile viewport browse works", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await login(page, OWNER);

    await expect(page.getByTestId("tab-bar")).toBeVisible();
    await page.getByTestId("group-my-vdirs").getByRole("button", { name: /Home/ }).click();
    await expect(page.getByTestId("entry-0")).toBeVisible();
    await nav(page, "files");
    await expect(page.getByTestId("locations")).toBeVisible();
  });

  test("keyboard opens a directory", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await page.getByTestId("open-dir").filter({ hasText: "docs" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("breadcrumbs")).toContainText("docs");
  });
});
