// Browser E2E for the fullscreen image gallery (web-ui spec,
// add-fullscreen-image-gallery): opening an image goes fullscreen with
// overlay chrome, double-tap zooms (and pans while zoomed), dragging
// pages between the containing directory's images in listing order and
// stops at the ends, arrow keys page too, the URL tracks the displayed
// image, and browser back returns to the browse listing. The gallery
// order is the directory's listing order (the ls result filtered to
// image entries — not necessarily alphabetical), so the spec derives
// the expected sequence from the ls API. Runs against the seeded
// harness (photos/one|two|three.png + notes.txt) on the
// build/verification server.

import { expect, test, type Page } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

async function drag(page: Page, fromX: number, toX: number, y = 300) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move((fromX + toX) / 2, y, { steps: 4 });
  await page.mouse.move(toX, y, { steps: 4 });
  await page.mouse.up();
}

// stripX reads the strip's animated horizontal offset (computed style).
async function stripX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const strip = document.querySelector("[data-testid='viewer-stage'] > div");
    if (!strip) return 0;
    const m = getComputedStyle(strip).transform;
    return m.startsWith("matrix") ? parseFloat(m.split(",")[4]) : 0;
  });
}

// openPhotos enters the seeded photos/ directory and returns the
// gallery order: the directory's ls entries filtered to images.
async function openPhotos(page: Page): Promise<string[]> {
  await login(page, OWNER);
  await openHome(page);
  await page.getByTestId("open-dir").filter({ hasText: "photos" }).click();
  await expect(entryRow(page, "one.png")).toBeVisible();
  const vdirId = new URL(page.url()).pathname.split("/")[2];
  const resp = await page.request.post(`/api/sf/vdirs/${vdirId}/ls`, {
    data: { path: "photos" },
  });
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as {
    entries: Array<{ name: string; dir: boolean }>;
  };
  const images = body.entries
    .filter((e) => !e.dir && /\.(png|jpe?g|gif|webp)$/i.test(e.name))
    .map((e) => e.name);
  expect(images).toHaveLength(3);
  expect(images).not.toContain("notes.txt");
  return images;
}

test.describe("fullscreen image gallery", () => {
  test("opens fullscreen, zooms by double-tap, and pages by drag and keyboard", async ({
    page,
  }) => {
    const [first, second, third] = await openPhotos(page);

    await entryRow(page, first).getByTestId("open-preview").click();

    const viewer = page.getByTestId("image-viewer");
    await expect(viewer).toBeVisible();
    const frame = page.getByTestId("image-frame");
    await expect(frame).toHaveAttribute("alt", first);
    await expect(page.getByTestId("gallery-position")).toHaveText("1 / 3");
    await expect(page.getByTestId("viewer-name")).toHaveText(first);
    await expect(page.getByTestId("preview-download")).toHaveAttribute(
      "href",
      new RegExp(`/files/[^/]+/photos/${first}$`),
    );

    // double-tap zooms to the 2.5 step
    await page.getByTestId("viewer-stage").dblclick();
    await expect(frame).toHaveAttribute("style", /scale\(2\.5\)/);

    // while zoomed a drag pans instead of paging
    await drag(page, 900, 300);
    await expect(page.getByTestId("gallery-position")).toHaveText("1 / 3");
    await expect(frame).toHaveAttribute("style", /scale\(2\.5\)/);

    // double-tap resets to fit-to-screen; a drag now pages
    await page.getByTestId("viewer-stage").dblclick();
    await expect(frame).toHaveAttribute("style", /scale\(1\)/);
    await drag(page, 900, 300);
    // the settle animation continues leftward toward the next slide
    // (regression: a sign flip sent the strip back across the screen)
    await expect.poll(() => stripX(page), { timeout: 2_000 }).toBeLessThan(-700);
    await expect(frame).toHaveAttribute("alt", second);
    await expect(page.getByTestId("gallery-position")).toHaveText("2 / 3");
    await expect(page).toHaveURL(new RegExp(`/photos/${second}$`));

    // the non-image sibling is skipped; arrow keys page too
    await page.keyboard.press("ArrowRight");
    await expect(frame).toHaveAttribute("alt", third);
    await expect(page.getByTestId("gallery-position")).toHaveText("3 / 3");

    // the ends do not wrap
    await drag(page, 900, 300);
    await expect(frame).toHaveAttribute("alt", third);

    await page.keyboard.press("ArrowLeft");
    await expect(frame).toHaveAttribute("alt", second);
    await drag(page, 300, 900);
    // the backward page settles rightward, past the release offset
    await expect.poll(() => stripX(page), { timeout: 2_000 }).toBeGreaterThan(700);
    await drag(page, 300, 900);
    await expect(frame).toHaveAttribute("alt", first);
    await drag(page, 300, 900);
    await expect(frame).toHaveAttribute("alt", first);
  });

  test("hides and re-shows the chrome on image tap", async ({ page }) => {
    const [first] = await openPhotos(page);

    await entryRow(page, first).getByTestId("open-preview").click();
    await expect(page.getByTestId("viewer-chrome")).toBeVisible();

    await page.getByTestId("viewer-stage").click();
    await expect(page.getByTestId("viewer-chrome")).toHaveCount(0);
    await expect(page.getByTestId("image-frame")).toBeVisible();

    await page.getByTestId("viewer-stage").click();
    await expect(page.getByTestId("viewer-chrome")).toBeVisible();
  });

  test("browser back from a swiped gallery position returns to the browse listing", async ({
    page,
  }) => {
    const [first, second] = await openPhotos(page);

    await entryRow(page, first).getByTestId("open-preview").click();
    await expect(page.getByTestId("image-viewer")).toBeVisible();

    await drag(page, 900, 300);
    await expect(page.getByTestId("image-frame")).toHaveAttribute("alt", second);

    // the swipe replaced the preview entry, so back is the listing
    await page.goBack();
    await expect(page.getByTestId("breadcrumbs")).toContainText("photos");
    await expect(entryRow(page, first)).toBeVisible();
  });
});
