// PWA installability E2E (pwa spec): the served shell advertises a valid
// web app manifest, the manifest and its icons are fetchable, no service
// worker is registered, and the Settings install affordance is absent when
// the browser offers no install prompt. Runs against the Vite dev server or
// a built image (SF_E2E_BASE_URL), on the build/verification server.

import { expect, test } from "@playwright/test";
import { OWNER, login, nav } from "./helpers";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  prefer_related_applications?: boolean;
  icons?: ManifestIcon[];
}

test.describe("pwa installability", () => {
  test("the shell advertises a fetchable manifest with reachable icons", async ({
    page,
  }) => {
    await page.goto("/");

    const href = await page.getAttribute('link[rel="manifest"]', "href");
    expect(href).toBe("/manifest.json");

    const resp = await page.request.get("/manifest.json");
    expect(resp.status()).toBe(200);
    expect(resp.headers()["content-type"] ?? "").toMatch(/json/i);

    const manifest = (await resp.json()) as Manifest;
    expect(manifest.name ?? manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.prefer_related_applications).not.toBe(true);

    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");

    for (const icon of manifest.icons ?? []) {
      const iconResp = await page.request.get(icon.src);
      expect(iconResp.status(), `icon ${icon.src}`).toBe(200);
    }
  });

  test("registers no service worker", async ({ page }) => {
    await page.goto("/");

    const registrations = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    expect(registrations).toBe(0);

    const controller = await page.evaluate(
      () => navigator.serviceWorker.controller,
    );
    expect(controller).toBeNull();
  });

  test("shows no install affordance when the browser offers none", async ({
    page,
  }) => {
    await login(page, OWNER);
    await nav(page, "settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("settings-install")).toHaveCount(0);
  });
});
