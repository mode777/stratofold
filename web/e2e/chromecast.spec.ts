// Browser E2E for Cast (web-ui spec, add-chromecast-playback). A stub
// Web Sender SDK is injected before the app loads; the real backend
// mints the link and the receiver's media URL is then fetched with a
// request context that has no browser cookies.

import { expect, test } from "@playwright/test";
import { OWNER, entryRow, login, openHome } from "./helpers";

const CAST_STUB = `
(() => {
  const listeners = [];
  const session = {
    loadMedia: async (request) => {
      window.__castLoads = window.__castLoads || [];
      window.__castLoads.push(request);
    },
    getCastDevice: () => ({ friendlyName: "Test TV" }),
    endSession: () => {
      window.__castEnded = true;
      listeners.forEach((listener) => listener({ sessionState: "SESSION_ENDED" }));
    },
  };
  const context = {
    setOptions: () => {},
    requestSession: async () => {
      listeners.forEach((listener) => listener({ sessionState: "SESSION_STARTED" }));
    },
    getCurrentSession: () => session,
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: () => {},
  };
  class MediaInfo {
    constructor(url, contentType) {
      this.url = url;
      this.contentType = contentType;
      this.metadata = {};
    }
  }
  class LoadRequest {
    constructor(media) {
      this.media = media;
    }
  }
  window.cast = {
    framework: {
      CastContext: { getInstance: () => context },
      CastContextEventType: { SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED" },
      SessionState: {
        SESSION_STARTED: "SESSION_STARTED",
        SESSION_RESUMED: "SESSION_RESUMED",
        SESSION_ENDED: "SESSION_ENDED",
      },
      RemotePlayer: class {
        constructor() {
          this.isConnected = true;
        }
      },
      RemotePlayerController: class {
        addEventListener() {}
        removeEventListener() {}
      },
      RemotePlayerEventType: { IS_CONNECTED_CHANGED: "IS_CONNECTED_CHANGED" },
    },
  };
  window.chrome = {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: "ORIGIN_SCOPED" },
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
        MediaInfo,
        GenericMediaMetadata: class {
          constructor() {
            this.title = "";
          }
        },
        LoadRequest,
      },
    },
  };
})();
`;

test.describe("chromecast", () => {
  test("casts a minted 24-hour link to the default receiver and stops", async ({
    page,
    request,
  }) => {
    await page.addInitScript({ content: CAST_STUB });
    await login(page, OWNER);
    await openHome(page);

    await entryRow(page, "movie.mp4").getByTestId("open-preview").click();
    await expect(page.getByTestId("video-player")).toBeVisible();

    const cast = page.getByTestId("video-cast");
    await expect(cast).toBeVisible();
    await cast.click();

    await expect(page.getByTestId("cast-indicator")).toContainText(
      "Casting to Test TV",
    );
    // The indicator turns on at SESSION_STARTED, before the link mint
    // and loadMedia complete; wait for the stubbed receiver's load.
    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (window as unknown as { __castLoads?: unknown[] }).__castLoads
                ?.length ?? 0,
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const media = await page.evaluate(
      () =>
        (
          window as unknown as {
            __castLoads?: Array<{
              media: {
                url: string;
                contentType: string;
                metadata: { title: string };
              };
            }>;
          }
        ).__castLoads?.[0]?.media,
    );
    expect(media!.contentType).toBe("video/mp4");
    expect(media!.metadata.title).toBe("movie.mp4");

    const path = new URL(media!.url).pathname;
    expect(path).toMatch(/^\/s\//);

    // The API request context has no browser cookies: the link is the
    // only credential.
    const full = await request.get(path);
    expect(full.status()).toBe(200);
    const partial = await request.get(path, {
      headers: { Range: "bytes=0-9" },
    });
    expect(partial.status()).toBe(206);
    expect((await partial.body()).length).toBe(10);

    await page.getByTestId("cast-stop").click();
    await expect(page.getByTestId("cast-indicator")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __castEnded?: boolean }).__castEnded,
      ),
    ).toBe(true);
  });
});
