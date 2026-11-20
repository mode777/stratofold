// Pretty public URL E2E (public-urls + web-ui deltas): the owner claims a
// globally unique name, an anonymous visitor browses/previews/downloads
// under /apps/<name>, a second vdir cannot claim the same name,
// un-publishing makes the alias unavailable, re-publishing restores it,
// and releasing the name removes it. Runs against the Vite dev server +
// harness or SF_E2E_BASE_URL on the build/verification server.

import { expect, test, type Page } from "@playwright/test";
import { OWNER, login, nav } from "./helpers";

const SLUG = "my-public-folder";

async function openVdirSharing(page: Page, name: string) {
  await nav(page, "settings");
  await page.getByTestId("settings-vdirs").click();
  await page.getByTestId("vdir-row").filter({ hasText: name }).click();
  await page.getByTestId("vdir-sharing").click();
  await expect(page.getByTestId("sharing-page")).toBeVisible();
}

async function setPublic(page: Page, makePublic: boolean) {
  // From the sharing screen back to the vdir form.
  await page.getByRole("button", { name: "Vdir" }).click();
  await expect(page.getByTestId("vdir-form")).toBeVisible();
  if (makePublic) await page.getByTestId("v-public").check({ force: true });
  else await page.getByTestId("v-public").uncheck({ force: true });
  await page.getByTestId("vdir-save").click();
  await expect(page.getByTestId("vdirs-page")).toBeVisible();
}

test.describe.serial("pretty public URLs", () => {
  test("the owner claims a name and a second vdir cannot take it", async ({ page, context }) => {
    await login(page, OWNER);

    // The public-browsing spec may have left the seeded vdir private;
    // publishing is idempotent here.
    await openVdirSharing(page, "Public");
    await setPublic(page, true);
    await openVdirSharing(page, "Public");

    const input = page.getByTestId("public-name-input");
    await input.fill(SLUG);
    await page.getByTestId("public-name-save").click();
    await expect(page.getByTestId("public-name-saved")).toBeVisible();
    await expect(page.getByTestId("public-link")).toContainText(`/apps/${SLUG}`);

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("public-link-copy").click();
    await expect(page.getByTestId("public-link-copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).pathname).toBe(`/apps/${SLUG}`);

    // A different vdir on the same instance cannot claim the name.
    await openVdirSharing(page, "Home");
    await page.getByTestId("public-name-input").fill(SLUG);
    await page.getByTestId("public-name-save").click();
    await expect(page.getByTestId("public-name-error")).toContainText("already taken");
    await expect(page.getByTestId("public-link-reserved")).toHaveCount(0);
  });

  test("an anonymous visitor browses, previews, and downloads under the alias", async ({
    browser,
  }) => {
    const anon = await browser.newContext();
    const page = await anon.newPage();

    await page.goto(`/apps/${SLUG}`);
    await expect(page.getByTestId("breadcrumbs")).toContainText("Public");
    await expect(page.getByText("hello.txt")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);

    // No write or management affordances.
    await expect(page.getByTestId("new-folder")).toHaveCount(0);
    await expect(page.getByTestId("upload-button")).toHaveCount(0);
    await expect(page.getByTestId("sidebar")).toHaveCount(0);

    await page.getByTestId("open-dir").filter({ hasText: "docs" }).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("docs");
    await expect(page.getByText("readme.md")).toBeVisible();

    // Preview stays under the alias and downloads through it.
    await page.locator('[data-entry-name="readme.md"]').getByTestId("open-preview").click();
    await expect(page).toHaveURL(new RegExp(`/apps/${SLUG}/view/docs/readme\\.md$`));
    await expect(page.getByTestId("preview-download")).toHaveAttribute(
      "href",
      `/apps/${SLUG}/docs/readme.md`,
    );
    await page.getByTestId("back").click();
    await expect(page).toHaveURL(new RegExp(`/apps/${SLUG}/docs$`));

    // Direct file paths stream with the /files semantics.
    const direct = await page.request.get(`/apps/${SLUG}/docs/readme.md`);
    expect(direct.status()).toBe(200);
    expect(await direct.text()).toBe("# docs\n");
    expect(direct.headers()["content-type"]).toBeTruthy();

    const ranged = await page.request.get(`/apps/${SLUG}/docs/readme.md`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(ranged.status()).toBe(206);
    expect(await ranged.text()).toBe("# do");
    expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-3\/\d+$/);

    const head = await page.request.head(`/apps/${SLUG}/docs/readme.md`);
    expect(head.status()).toBe(200);
    expect(head.headers()["etag"]).toBeTruthy();

    await anon.close();
  });

  test("un-publishing hides the alias, re-publishing restores it, release removes it", async ({
    page,
    browser,
  }) => {
    await login(page, OWNER);
    await openVdirSharing(page, "Public");
    await setPublic(page, false);

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/apps/${SLUG}`);
    await expect(anonPage.getByTestId("state-unavailable")).toBeVisible();
    await expect(anonPage.getByLabel("Email")).toHaveCount(0);

    // Re-publish: the reserved name becomes active again.
    await page.getByTestId("vdir-row").filter({ hasText: "Public" }).click();
    await page.getByTestId("v-public").check({ force: true });
    await page.getByTestId("vdir-save").click();
    await expect(page.getByTestId("vdirs-page")).toBeVisible();

    await anonPage.goto(`/apps/${SLUG}`);
    await expect(anonPage.getByTestId("breadcrumbs")).toContainText("Public");
    await expect(anonPage.getByText("hello.txt")).toBeVisible();

    // Release the name; the pretty URL stops resolving.
    await openVdirSharing(page, "Public");
    await page.getByTestId("public-name-remove").click();
    await expect(page.getByTestId("public-link")).toContainText("/v/");
    await expect(page.getByTestId("public-name-input")).toHaveValue("");

    await anonPage.goto(`/apps/${SLUG}`);
    await expect(anonPage.getByTestId("state-unavailable")).toBeVisible();

    await anon.close();
  });
});
