// Browser E2E for the in-app media surfaces (web-ui spec): audio and
// video open their in-app players, images render inline, and download
// stays available from the context menu and inside the player/viewer.
// Runs against the seeded harness (song.wav, photo.png, movie.mp4).

import { expect, test } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

test.describe("media players", () => {
  test("video opens the in-app player", async ({ page }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "movie.mp4").getByTestId("open-preview").click();
    await expect(page.getByTestId("video-player")).toBeVisible();
    await expect(page.getByTestId("video-stream")).toHaveAttribute(
      "src",
      /movie\.mp4$/,
    );
    await expect(page.getByTestId("video-play")).toBeVisible();
    await expect(page.getByTestId("video-download")).toHaveAttribute(
      "href",
      /movie\.mp4$/,
    );

    await page.getByTestId("back").click();
    await expect(entryRow(page, "movie.mp4")).toBeVisible();
  });

  test("audio opens the in-app player with an in-page download", async ({
    page,
  }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "song.wav").getByTestId("open-preview").click();
    await expect(page.getByTestId("audio-title")).toHaveText("song.wav");
    await expect(page.getByTestId("audio-stream")).toHaveAttribute(
      "src",
      /song\.wav$/,
    );
    await expect(page.getByTestId("audio-play")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("preview-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe("song.wav");
  });

  test("audio plays through the folder queue with cover art and wrapping skips", async ({
    page,
  }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "album").getByTestId("open-dir").click();
    await expect(entryRow(page, "01-intro.wav")).toBeVisible();
    await entryRow(page, "01-intro.wav").getByTestId("open-preview").click();

    await expect(page.getByTestId("audio-title")).toHaveText("01-intro.wav");
    await expect(page.getByTestId("audio-cover")).toBeVisible();
    await expect(page.getByTestId("audio-cover")).toHaveAttribute(
      "src",
      /album\/cover\.png$/,
    );
    await expect(page.getByTestId("audio-cover")).toHaveAttribute("alt", "");

    // Next moves in listing order, skipping cover.png and notes.txt.
    await page.getByTestId("audio-next").click();
    await expect(page.getByTestId("audio-title")).toHaveText("02-theme.wav");

    // Wrap forward from the last track and backward from the first.
    await page.getByTestId("audio-next").click();
    await expect(page.getByTestId("audio-title")).toHaveText("01-intro.wav");
    await page.getByTestId("audio-prev").click();
    await expect(page.getByTestId("audio-title")).toHaveText("02-theme.wav");

    // Playing the 1-second track to its end auto-advances to the next
    // queued file (wrapping to 01-intro from the last track).
    await page.getByTestId("audio-play").click();
    await expect(page.getByTestId("audio-play")).toHaveAttribute(
      "aria-label",
      "Pause",
    );
    await expect(page.getByTestId("audio-title")).toHaveText("01-intro.wav", {
      timeout: 15_000,
    });

    // Stop the looping queue before leaving the player.
    const pause = page.getByTestId("audio-play");
    if ((await pause.getAttribute("aria-label")) === "Pause")
      await pause.click();
  });

  test("images render inline in the viewer with an in-page download", async ({
    page,
  }) => {
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "photo.png").getByTestId("open-preview").click();
    await expect(page.getByTestId("image-frame")).toBeVisible();
    await expect(page.getByTestId("image-frame")).toHaveAttribute(
      "alt",
      "photo.png",
    );

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
