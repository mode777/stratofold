// Browser E2E for connection setup: a connection may be created without
// a host-key fingerprint (trust on first use) and carries a remote
// directory that seeds the vdir root-path default. Runs against the Go
// E2E harness (design D7); E2E is a build/verification-server gate, not
// a local one.

import { expect, test } from "@playwright/test";
import { login, nav, OWNER } from "./helpers";

test.describe("connection setup", () => {
  test("a connection without a fingerprint seeds the vdir root path", async ({ page }) => {
    // Unique names so repeated runs against a reused harness do not
    // collide with the (owner, name) vdir constraint.
    const suffix = Date.now().toString(36);
    const connLabel = `TOFU box ${suffix}`;
    const vdirName = `TofuRoot ${suffix}`;

    await login(page, OWNER);

    // Create a connection leaving the fingerprint empty.
    await nav(page, "settings");
    await page.getByTestId("settings-connections").click();
    await page.getByTestId("new-connection").click();
    await page.getByLabel("Label").fill(connLabel);
    await page.getByLabel("Host", { exact: true }).fill("127.0.0.1");
    await page.getByLabel("Username").fill("testuser");
    await page.getByLabel(/^Password/).fill("whatever");
    await page.getByLabel("Remote directory").fill("/home/");
    // Host key fingerprint intentionally left empty (trust on first use).
    await page.getByTestId("connection-save").click();

    await expect(page.getByTestId("connection-row").filter({ hasText: connLabel })).toContainText("/home/");

    // Back to Settings, then into Virtual Directories.
    await nav(page, "settings");
    await page.getByTestId("settings-vdirs").click();
    await page.getByTestId("new-vdir").click();
    await page.getByLabel("Name").fill(vdirName);

    const select = page.getByTestId("v-connection");
    const value = await select.locator("option", { hasText: connLabel }).getAttribute("value");
    await select.selectOption(value!);
    await expect(page.getByLabel("Root Path")).toHaveValue("/home/");

    await page.getByTestId("vdir-save").click();
    await expect(page.getByTestId("vdir-row").filter({ hasText: vdirName })).toContainText("/home/");
  });
});
