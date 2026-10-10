// Browser E2E for the in-app media surfaces (web-ui spec,
// add-audio-player-image-viewer): audio opens the in-app player,
// images render inline, video keeps the new-tab anchor, and download
// stays available from the context menu and inside the player/viewer.
// Runs against the seeded harness (song.wav, photo.png, movie.mp4).

import { expect, test } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

test.describe("media players", () => {
  test("audio opens the in-app player with an in-page download", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    // Video keeps the new-tab native player anchor.
    await expect(entryRow(page, "movie.mp4").getByTestId("open-media")).toHaveAttribute(
      "target",
      "_blank",
    );

    await entryRow(page, "song.wav").getByTestId("open-preview").click();
    await expect(page.getByTestId("audio-title")).toHaveText("song.wav");
    await expect(page.getByTestId("audio-stream")).toHaveAttribute("src", /song\.wav$/);
    await expect(page.getByTestId("audio-play")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("preview-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe("song.wav");
  });

  test("images render inline in the viewer with an in-page download", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "photo.png").getByTestId("open-preview").click();
    await expect(page.getByTestId("image-frame")).toBeVisible();
    await expect(page.getByTestId("image-frame")).toHaveAttribute("alt", "photo.png");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("preview-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe("photo.png");
  });

  test("the context menu keeps Download for media files", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "song.wav").getByTestId("entry-actions").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("action-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe("song.wav");
  });
});
