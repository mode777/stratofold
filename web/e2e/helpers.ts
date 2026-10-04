// Shared browser-E2E helpers for the seeded harness (design D7).

import { expect, type Page } from "@playwright/test";

export const OWNER = { email: "owner@stratofold.test", password: "owner-pass-123" };
export const GRANTEE = { email: "grantee@stratofold.test", password: "grantee-pass-123" };

export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("link", { name: "Connections" })).toBeVisible();
}

export async function openHome(page: Page) {
  await page.getByTestId("vdir-switcher").getByRole("button", { name: /Home/ }).click();
  await expect(page.getByTestId("breadcrumbs")).toContainText("Home");
}

export async function logout(page: Page) {
  await page.getByTestId("logout").click();
  await expect(page.getByLabel("Email")).toBeVisible();
}

export function entryRow(page: Page, name: string) {
  return page.locator(`[data-entry-name="${name}"]`);
}
