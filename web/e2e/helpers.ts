// Shared browser-E2E helpers for the seeded harness (design D7/D3).
// Navigation clicks whichever of the sidebar (md+) or tab bar (mobile)
// rendering is visible, so the same helper works at any viewport.

import { expect, type Page } from "@playwright/test";

export const OWNER = { email: "owner@stratofold.test", password: "owner-pass-123" };
export const GRANTEE = { email: "grantee@stratofold.test", password: "grantee-pass-123" };

export async function nav(page: Page, name: "files" | "uploads" | "settings"): Promise<void> {
  const side = page.getByTestId(`side-${name}`);
  if (await side.isVisible()) {
    await side.click();
    return;
  }
  await page.getByTestId(`tab-${name}`).click();
}

export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("locations")).toBeVisible();
}

export async function openHome(page: Page) {
  await nav(page, "files");
  await page.getByTestId("group-my-vdirs").getByRole("button", { name: /Home/ }).click();
  await expect(page.getByTestId("breadcrumbs")).toContainText("Home");
}

export async function logout(page: Page) {
  await nav(page, "settings");
  await page.getByTestId("settings-signout").click();
  await page.getByTestId("signout-confirm").click();
  await expect(page.getByLabel("Email")).toBeVisible();
}

// openSharing pushes Settings → Vdirs → the first vdir → Sharing.
export async function openSharing(page: Page) {
  await nav(page, "settings");
  await page.getByTestId("settings-vdirs").click();
  await page.getByTestId("vdir-row").first().click();
  await page.getByTestId("vdir-sharing").click();
  await expect(page.getByTestId("sharing-page")).toBeVisible();
}

export function entryRow(page: Page, name: string) {
  return page.locator(`[data-entry-name="${name}"]`);
}
