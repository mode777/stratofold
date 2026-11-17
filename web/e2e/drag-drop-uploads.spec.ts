// Browser E2E for drag & drop uploads (web-ui drag & drop spec, design
// D6). A script-built DataTransfer exposes plain files but no directory
// entries, so these tests exercise the fallback path — file drops,
// highlight, listing refresh, replace parity, and writer-only gating.
// Directory-entry drags cannot be synthesized in the browser and stay
// unit-gated (web/src/lib/dragDrop.test.ts).

import { expect, test, type Page } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

type DroppedFile = { name: string; text: string };

async function dispatchDrag(page: Page, type: "dragenter" | "dragleave" | "drop", files: DroppedFile[]) {
  await page.evaluate(
    ({ type, files }) => {
      const zone = document.querySelector('[data-testid="drop-zone"]');
      if (!zone) throw new Error("drop zone missing");
      const dt = new DataTransfer();
      for (const file of files) {
        dt.items.add(new File([file.text], file.name, { type: "text/plain" }));
      }
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { type, files },
  );
}

async function dropFiles(page: Page, files: DroppedFile[]) {
  await dispatchDrag(page, "dragenter", files);
  await dispatchDrag(page, "drop", files);
}

function vdirId(page: Page): string {
  return new URL(page.url()).pathname.split("/")[2];
}

test.describe("drag and drop uploads", () => {
  test("dropped files upload into the browsed directory and appear without a reload", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const zone = page.getByTestId("drop-zone");

    // A hovering drag marks the drop target; leaving clears it.
    await dispatchDrag(page, "dragenter", [{ name: "hover.txt", text: "hover" }]);
    await expect(zone).toHaveAttribute("data-drop-active", "true");
    await dispatchDrag(page, "dragleave", []);
    await expect(zone).not.toHaveAttribute("data-drop-active");

    await dropFiles(page, [
      { name: "dropped-one.txt", text: "one" },
      { name: "dropped-two.txt", text: "two" },
    ]);
    await expect(zone).not.toHaveAttribute("data-drop-active");

    // Both land in the browsed directory and the listing refreshes
    // itself (no manual reload or re-navigation).
    await expect(entryRow(page, "dropped-one.txt")).toBeVisible();
    await expect(entryRow(page, "dropped-two.txt")).toBeVisible();

    const vdir = vdirId(page);
    const first = await page.request.get(`/files/${vdir}/dropped-one.txt`);
    expect(first.status()).toBe(200);
    expect(await first.text()).toBe("one");
    const second = await page.request.get(`/files/${vdir}/dropped-two.txt`);
    expect(await second.text()).toBe("two");
  });

  test("a drop replaces an existing file exactly like the picker path", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    const stamp = Date.now().toString(36);
    const name = `replace-${stamp}.txt`;

    await page.getByTestId("upload-input").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("first"),
    });
    await expect(entryRow(page, name)).toBeVisible();

    const vdir = vdirId(page);
    await expect
      .poll(async () => {
        const resp = await page.request.get(`/files/${vdir}/${name}`);
        return resp.status() === 200 ? resp.text() : "";
      })
      .toBe("first");

    await dropFiles(page, [{ name, text: "second" }]);
    await expect
      .poll(async () => {
        const resp = await page.request.get(`/files/${vdir}/${name}`);
        return resp.status() === 200 ? resp.text() : "";
      })
      .toBe("second");
  });

  test("public browse offers no drop behavior", async ({ page, browser }) => {
    // Find the seeded public vdir as its owner, then visit it anonymously.
    await login(page, OWNER);
    await page.getByTestId("group-my-vdirs").getByRole("button", { name: /Public/ }).click();
    await expect(page.getByTestId("breadcrumbs")).toContainText("Public");
    const pubPath = new URL(page.url()).pathname;

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(pubPath);
    await expect(anonPage.getByTestId("breadcrumbs")).toContainText("Public");
    await expect(anonPage.getByTestId("upload-button")).toHaveCount(0);

    const zone = anonPage.getByTestId("drop-zone");
    await dispatchDrag(anonPage, "dragenter", [{ name: "anon-drop.txt", text: "x" }]);
    await expect(zone).not.toHaveAttribute("data-drop-active");
    await dispatchDrag(anonPage, "drop", [{ name: "anon-drop.txt", text: "x" }]);

    await anonPage.waitForTimeout(500);
    await expect(entryRow(anonPage, "anon-drop.txt")).toHaveCount(0);
    await anon.close();
  });
});
