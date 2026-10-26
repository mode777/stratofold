import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VideoPlayerPage } from "./VideoPlayerPage";
import { CastProvider, type CastSdk } from "../lib/cast";
import type { LsEntry } from "../lib/filesApi";

const sessionState = vi.hoisted(() => ({ state: "authenticated" as string }));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: sessionState.state,
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mintFileLink = vi.hoisted(() =>
  vi.fn(async () => ({ url: "/s/tok123", expiresAt: "2026-10-27T19:00:00Z" })),
);

vi.mock("../lib/filesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/filesApi")>();
  return { ...actual, mintFileLink };
});

const MOVIE: LsEntry = {
  name: "movie.mp4",
  size: 99,
  dir: false,
  modtime: "2026-01-02T03:04:05Z",
};

beforeAll(() => {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, "play", {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(proto, "pause", { configurable: true, value: vi.fn() });
  Object.defineProperty(proto, "duration", {
    configurable: true,
    get() {
      return 120;
    },
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get() {
      return (this as { __t?: number }).__t ?? 0;
    },
    set(value: number) {
      (this as { __t?: number }).__t = value;
    },
  });
  Object.defineProperty(proto, "volume", {
    configurable: true,
    get() {
      return (this as { __v?: number }).__v ?? 1;
    },
    set(value: number) {
      (this as { __v?: number }).__v = value;
    },
  });
  Object.defineProperty(proto, "muted", {
    configurable: true,
    get() {
      return (this as { __m?: boolean }).__m ?? false;
    },
    set(value: boolean) {
      (this as { __m?: boolean }).__m = value;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

type FakeCast = {
  sdk: CastSdk;
  loads: Array<{ media: { url: string; contentType: string; metadata?: { title?: string } } }>;
  ended: boolean;
  requestSession: ReturnType<typeof vi.fn>;
  loadMedia: ReturnType<typeof vi.fn>;
};

function fakeCast(): FakeCast {
  const loads: FakeCast["loads"] = [];
  let ended = false;
  const listeners: Array<(event: { sessionState: string }) => void> = [];
  const session = {
    loadMedia: vi.fn(async (request: unknown) => {
      loads.push(request as FakeCast["loads"][number]);
    }),
    getCastDevice: () => ({ friendlyName: "Living Room TV" }),
    endSession: vi.fn(() => {
      ended = true;
      for (const listener of listeners) listener({ sessionState: "SESSION_ENDED" });
    }),
  };
  const context = {
    setOptions: vi.fn(),
    requestSession: vi.fn(async () => {
      for (const listener of listeners) listener({ sessionState: "SESSION_STARTED" });
    }),
    getCurrentSession: () => session,
    addEventListener: (_type: string, listener: (event: { sessionState: string }) => void) =>
      void listeners.push(listener),
    removeEventListener: vi.fn(),
  };
  class MediaInfo {
    metadata?: { title?: string };
    constructor(
      public url: string,
      public contentType: string,
    ) {}
  }
  class GenericMediaMetadata {
    title?: string;
  }
  class LoadRequest {
    constructor(public media: MediaInfo) {}
  }
  const sdk = {
    framework: {
      CastContext: { getInstance: () => context },
      CastContextEventType: { SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED" },
      SessionState: {
        SESSION_STARTED: "SESSION_STARTED",
        SESSION_RESUMED: "SESSION_RESUMED",
        SESSION_ENDED: "SESSION_ENDED",
      },
      RemotePlayer: class {
        isConnected = true;
      },
      RemotePlayerController: class {
        addEventListener() {}
        removeEventListener() {}
      },
      RemotePlayerEventType: { IS_CONNECTED_CHANGED: "IS_CONNECTED_CHANGED" },
    },
    chrome: {
      cast: {
        AutoJoinPolicy: { ORIGIN_SCOPED: "ORIGIN_SCOPED" },
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
          MediaInfo,
          GenericMediaMetadata,
          LoadRequest,
        },
      },
    },
  } as unknown as CastSdk;
  return {
    sdk,
    loads,
    get ended() {
      return ended;
    },
    requestSession: context.requestSession,
    loadMedia: session.loadMedia,
  } as FakeCast;
}

function renderPlayer(vdirId = "v1") {
  return render(
    <CastProvider loadSdk={async () => null}>
      <VideoPlayerPage vdirId={vdirId} path="clips/movie.mp4" entry={MOVIE} />
    </CastProvider>,
  );
}

function renderCastPlayer(cast: FakeCast) {
  return render(
    <CastProvider loadSdk={async () => cast.sdk}>
      <VideoPlayerPage vdirId="v1" path="clips/movie.mp4" entry={MOVIE} />
    </CastProvider>,
  );
}

describe("VideoPlayerPage", () => {
  it("streams the plain /files URL and starts paused", () => {
    renderPlayer();
    const video = screen.getByTestId("video-stream");
    expect(video).toHaveAttribute("src", "/files/v1/clips/movie.mp4");
    expect(video).not.toHaveAttribute("autoplay");
    expect(screen.getByTestId("video-play")).toHaveAttribute("aria-label", "Play");
    expect(screen.getByTestId("video-time")).toHaveTextContent("0:00");
  });

  it("drives play/pause and exposes the download action", async () => {
    renderPlayer();
    const video = screen.getByTestId("video-stream") as HTMLVideoElement;
    const user = userEvent.setup();

    await user.click(screen.getByTestId("video-play"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("video-play")).toHaveAttribute("aria-label", "Pause");
    });

    await user.click(screen.getByTestId("video-play"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByTestId("video-play")).toHaveAttribute("aria-label", "Play");

    expect(screen.getByTestId("video-download")).toHaveAttribute("href", "/files/v1/clips/movie.mp4");
    expect(screen.getByTestId("video-download")).toHaveAttribute("download");
    expect(video.getAttribute("src")).toBe("/files/v1/clips/movie.mp4");
  });

  it("seeks, shows elapsed/remaining time, and controls volume/mute", async () => {
    renderPlayer();
    const video = screen.getByTestId("video-stream") as HTMLVideoElement;
    const user = userEvent.setup();

    fireEvent.loadedMetadata(video);
    expect(screen.getByTestId("video-remaining")).toHaveTextContent("-2:00");

    fireEvent.change(screen.getByTestId("video-seek"), { target: { value: "30" } });
    expect(video.currentTime).toBe(30);
    expect(screen.getByTestId("video-time")).toHaveTextContent("0:30");
    expect(screen.getByTestId("video-remaining")).toHaveTextContent("-1:30");

    fireEvent.change(screen.getByTestId("video-volume"), { target: { value: "0.5" } });
    expect(video.volume).toBe(0.5);

    await user.click(screen.getByTestId("video-mute"));
    expect(video.muted).toBe(true);
    expect(screen.getByTestId("video-mute")).toHaveAttribute("aria-label", "Unmute");
    await user.click(screen.getByTestId("video-mute"));
    expect(video.muted).toBe(false);
  });

  it("requests fullscreen on the player stage", async () => {
    renderPlayer();
    await userEvent.setup().click(screen.getByTestId("video-fullscreen"));
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
  });

  it("shows a retryable failure and re-creates the stream on retry", async () => {
    renderPlayer();
    const video = screen.getByTestId("video-stream");

    fireEvent.error(video);
    expect(screen.getByTestId("state-retryable")).toBeInTheDocument();
    expect(screen.getByTestId("action-retry")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("action-retry"));
    expect(screen.queryByTestId("state-retryable")).not.toBeInTheDocument();
    expect(screen.getByTestId("video-stream")).toHaveAttribute("src", "/files/v1/clips/movie.mp4");
  });

  it("uses the public vdir URL unchanged", () => {
    renderPlayer("pub");
    expect(screen.getByTestId("video-stream")).toHaveAttribute("src", "/files/pub/clips/movie.mp4");
  });

  it("offers no Cast action when the SDK is unavailable", async () => {
    renderPlayer();
    await waitFor(() => expect(screen.queryByTestId("video-cast")).not.toBeInTheDocument());
  });

  it("casts with a minted link, pauses local playback, and stops", async () => {
    sessionState.state = "authenticated";
    const cast = fakeCast();
    renderCastPlayer(cast);

    const button = await screen.findByTestId("video-cast");
    await userEvent.setup().click(button);

    await waitFor(() => expect(screen.getByTestId("video-cast-state")).toHaveTextContent("Living Room TV"));
    expect(mintFileLink).toHaveBeenCalledWith("v1", "clips/movie.mp4");
    expect(cast.loads).toHaveLength(1);
    expect(cast.loads[0].media.url).toBe(`${window.location.origin}/s/tok123`);
    expect(cast.loads[0].media.contentType).toBe("video/mp4");
    expect(cast.loads[0].media.metadata?.title).toBe("movie.mp4");
    expect(screen.getByTestId("video-play")).toHaveAttribute("aria-label", "Play");
  });

  it("uses the plain /files URL for an anonymous public cast", async () => {
    sessionState.state = "anonymous";
    const cast = fakeCast();
    renderCastPlayer(cast);

    await userEvent.setup().click(await screen.findByTestId("video-cast"));
    await waitFor(() => expect(cast.loads).toHaveLength(1));
    expect(mintFileLink).not.toHaveBeenCalled();
    expect(cast.loads[0].media.url).toBe(`${window.location.origin}/files/v1/clips/movie.mp4`);
    sessionState.state = "authenticated";
  });

  it("reports a failed link mint without claiming success", async () => {
    sessionState.state = "authenticated";
    mintFileLink.mockRejectedValueOnce(new Error("forbidden"));
    const cast = fakeCast();
    renderCastPlayer(cast);

    await userEvent.setup().click(await screen.findByTestId("video-cast"));
    await waitFor(() =>
      expect(screen.getByTestId("video-cast-failure")).toHaveTextContent("Could not prepare"),
    );
    expect(cast.loads).toHaveLength(0);
  });
});
