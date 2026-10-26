// Browser E2E for temporary file links (file-links capability): a
// signed-in owner copies a 24-hour link from a non-public vdir's
// context menu, and the link downloads with a request context that
// carries no browser cookies.

import { expect, test } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

test.describe("temporary file links", () => {
  test("copies a 24-hour link that downloads without a session", async ({
    page,
    request,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "hello.txt").getByTestId("entry-actions").click();
    const copy = page.getByTestId("action-copy-temp-link");
    await expect(copy).toHaveText("Copy 24-hour link");

    const minted = page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" &&
        resp.url().includes("/api/sf/vdirs/") &&
        resp.url().endsWith("/links"),
    );
    await copy.click();
    const mintResp = await minted;
    expect(mintResp.status()).toBe(201);
    const { url } = (await mintResp.json()) as { url: string };
    expect(url).toMatch(/^\/s\//);
    await expect(copy).toHaveText("Copied");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).pathname).toBe(url);

    // The `request` fixture is a separate API context with no browser
    // cookies: the link must stand on its own.
    const full = await request.get(url);
    expect(full.status()).toBe(200);
    expect(full.headers()["cache-control"]).toBe("no-store");
    expect(await full.text()).toBe("hello stratofold\n");

    const partial = await request.get(url, { headers: { Range: "bytes=0-9" } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()["content-range"]).toBe("bytes 0-9/17");
    expect(await partial.text()).toBe("hello stra");
  });
});
