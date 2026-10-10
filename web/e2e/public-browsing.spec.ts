// Public browsing E2E (web-ui public-browsing + sharing-access-control
// deltas): an anonymous visitor browses the seeded public vdir without
// an account, `/files` web hosting keeps serving index.html, the owner
// copies the public link from the sharing screen, and un-publishing
// makes the link land on the login screen. Runs against the Vite dev
// server + harness or SF_E2E_BASE_URL, on the build/verification
// server. Mutates harness state (un-publish) only in the last test.

import { expect, test, type Page } from "@playwright/test";
import { OWNER, login, nav } from "./helpers";

// publicVdirPath signs in as the owner and opens the seeded public
// vdir, returning its app path (/v/<vdir-id>).
async function publicVdirPath(page: Page): Promise<string> {
  await login(page, OWNER);
  await page.getByTestId("group-my-vdirs").getByRole("button", { name: /Public/ }).click();
  await expect(page.getByTestId("breadcrumbs")).toContainText("Public");
  return new URL(page.url()).pathname;
}

test.describe("public browsing", () => {
  test("anonymous visitor browses, navigates, and downloads; web hosting keeps serving", async ({
    page,
    browser,
  }) => {
    const pubPath = await publicVdirPath(page);
    const pubId = pubPath.split("/")[2];

    // A truly anonymous context: no cookies, no storage.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    await anonPage.goto(pubPath);
    await expect(anonPage.getByTestId("breadcrumbs")).toContainText("Public");
    await expect(anonPage.getByText("hello.txt")).toBeVisible();
    await expect(anonPage.getByLabel("Email")).toHaveCount(0);

    // Directory navigation works without an account.
    await anonPage.getByTestId("open-dir").filter({ hasText: "docs" }).click();
    await expect(anonPage.getByTestId("breadcrumbs")).toContainText("docs");
    await expect(anonPage.getByText("readme.md")).toBeVisible();

    // No write affordances and no management destinations.
    await expect(anonPage.getByTestId("new-folder")).toHaveCount(0);
    await expect(anonPage.getByTestId("upload-button")).toHaveCount(0);
    await expect(anonPage.getByTestId("tab-bar")).toHaveCount(0);
    await expect(anonPage.getByTestId("sidebar")).toHaveCount(0);

    // Downloads work anonymously through the plain /files URL.
    const download = await anonPage.request.get(`/files/${pubId}/docs/readme.md`);
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe("# docs\n");

    // Web-hosting non-regression: the seeded index.html serves
    // anonymously through slashed and bare directory URLs.
    const hosted = await anonPage.request.get(`/files/${pubId}/`);
    expect(hosted.status()).toBe(200);
    expect(await hosted.text()).toContain("stratofold hosting");
    const bare = await anonPage.request.get(`/files/${pubId}`);
    expect(bare.status()).toBe(200);
    expect(await bare.text()).toContain("stratofold hosting");

    // Management destinations stay behind login.
    await anonPage.goto("/settings");
    await expect(anonPage.getByLabel("Email")).toBeVisible();

    await anon.close();
  });

  test("the owner copies the public link; un-publishing lands it on the login screen", async ({
    page,
    browser,
    context,
  }) => {
    const pubPath = await publicVdirPath(page);
    const pubId = pubPath.split("/")[2];
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Owner opens the Public vdir's sharing screen and copies the link.
    await nav(page, "settings");
    await page.getByTestId("settings-vdirs").click();
    await page.getByTestId("vdir-row").filter({ hasText: "Public" }).click();
    await page.getByTestId("vdir-sharing").click();
    await expect(page.getByTestId("public-link")).toContainText(`/v/${pubId}`);

    await page.getByTestId("public-link-copy").click();
    await expect(page.getByTestId("public-link-copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).pathname).toBe(pubPath);

    // A fresh anonymous context opens the copied link.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(copied);
    await expect(anonPage.getByTestId("breadcrumbs")).toContainText("Public");

    // Un-publish: the same link stops resolving into the app. The
    // toggle input is visually hidden behind its styled span, so the
    // state change is forced rather than clicked through the overlay.
    await page.getByRole("button", { name: "Vdir" }).click();
    await expect(page.getByTestId("vdir-form")).toBeVisible();
    await page.getByTestId("v-public").uncheck({ force: true });
    await page.getByTestId("vdir-save").click();
    await expect(page.getByTestId("vdirs-page")).toBeVisible();

    await anonPage.goto(copied);
    await expect(anonPage.getByLabel("Email")).toBeVisible();
    await expect(anonPage.getByTestId("breadcrumbs")).toHaveCount(0);

    await anon.close();
  });
});
