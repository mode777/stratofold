import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMemo, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { AudioPlayerPage } from "./AudioPlayerPage";
import type { LsEntry } from "../lib/filesApi";
import { decodeSplat } from "../lib/listing";

const MODTIME = "2026-01-02T03:04:05Z";

function entry(name: string, over: Partial<LsEntry> = {}): LsEntry {
  return { name, size: 1024, dir: false, modtime: MODTIME, ...over };
}

// Listing order the API returns (names sorted): the queue must be
// track01, track02, track03 — skipping cover.png, notes.txt, sub/ and
// photo.jpg even though they sit between the tracks.
const ALBUM: LsEntry[] = [
  entry("cover.png"),
  entry("notes.txt", { size: 2 }),
  entry("sub", { dir: true, size: 0 }),
  entry("track01.mp3"),
  entry("track02.mp3"),
  entry("track03.flac"),
  entry("photo.jpg"),
];

const SOLO = [entry("only.mp3")];

// jsdom implements media elements as inert stubs: properties are
// shadowed per-element and the play/pause calls are spied.
function mediaState(el: HTMLMediaElement, props: { duration?: number; currentTime?: number }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(el, key, { configurable: true, writable: true, value });
  }
}

let navigateRef: ((to: string | number, opts?: { replace?: boolean }) => void) | null = null;

function RouteProbe({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  navigateRef = (to, opts) => {
    if (typeof to === "number") navigate(to);
    else navigate(to, opts);
  };
  return (
    <>
      <div data-testid="location-probe">{pathname}</div>
      <button type="button" data-testid="history-back" onClick={() => navigateRef!(-1)}>
        back
      </button>
      {children}
    </>
  );
}

function BrowseProbe() {
  return <div data-testid="browse-probe" />;
}

// Mirrors PreviewPage's wiring: the route path drives the player and
// the containing directory's listing is held across path changes.
function PlayerRoute({ listing }: { listing: LsEntry[] }) {
  const { vdirId = "" } = useParams();
  const { pathname } = useLocation();
  const path = useMemo(() => {
    const prefix = `/v/${vdirId}/view`;
    return decodeSplat(pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "");
  }, [pathname, vdirId]);
  const name = path.split("/").filter(Boolean).pop() ?? "";
  const entry = listing.find((e) => e.name === name) ?? {
    name,
    size: 0,
    dir: false,
    modtime: MODTIME,
  };
  return <AudioPlayerPage vdirId={vdirId} path={path} entry={entry} listing={listing} />;
}

function renderPlayer(
  initial = "music/track01.mp3",
  listing: LsEntry[] = ALBUM,
  vdirId = "v1",
) {
  return render(
    <MemoryRouter initialEntries={[`/v/${vdirId}/music`, `/v/${vdirId}/view/${initial}`]} initialIndex={1}>
      <Routes>
        <Route
          path="/v/:vdirId/view/*"
          element={
            <RouteProbe>
              <PlayerRoute listing={listing} />
            </RouteProbe>
          }
        />
        <Route
          path="/v/:vdirId/*"
          element={
            <RouteProbe>
              <BrowseProbe />
            </RouteProbe>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function audioEl(): HTMLMediaElement {
  return screen.getByTestId("audio-stream") as unknown as HTMLMediaElement;
}

function download(): HTMLElement {
  return screen.getByTestId("preview-download");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AudioPlayerPage", () => {
  it("renders the stream, title, and download action, starting paused", () => {
    renderPlayer();

    const audio = audioEl();
    expect(audio.getAttribute("src")).toBe("/files/v1/music/track01.mp3");
    expect(audio.getAttribute("preload")).toBe("metadata");
    expect(audio.hasAttribute("autoplay")).toBe(false);

    expect(screen.getByTestId("audio-title")).toHaveTextContent("track01.mp3");
    expect(screen.getByTestId("audio-play")).toHaveAttribute("aria-label", "Play");
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("0:00");
    expect(screen.getByTestId("audio-remaining")).toHaveTextContent("-0:00");
    expect(screen.getByTestId("audio-prev")).toHaveAttribute("aria-label", "Skip previous");
    expect(screen.getByTestId("audio-next")).toHaveAttribute("aria-label", "Skip next");
    expect(screen.getByTestId("audio-prev")).not.toBeDisabled();
    expect(screen.getByTestId("audio-next")).not.toBeDisabled();

    expect(download()).toHaveAttribute("href", "/files/v1/music/track01.mp3");
    expect(download()).toHaveAttribute("download");
  });

  it("toggles playback through the play/pause control", async () => {
    renderPlayer();
    const audio = audioEl();
    const play = vi.spyOn(audio, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(audio, "pause").mockReturnValue(undefined);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("audio-play"));
    expect(play).toHaveBeenCalledTimes(1);

    // The element's own events drive the playing state.
    fireEvent.play(audio);
    expect(screen.getByTestId("audio-play")).toHaveAttribute("aria-label", "Pause");

    await user.click(screen.getByTestId("audio-play"));
    expect(pause).toHaveBeenCalledTimes(1);

    fireEvent.pause(audio);
    expect(screen.getByTestId("audio-play")).toHaveAttribute("aria-label", "Play");
  });

  it("tracks the scrubber and elapsed/remaining times from element events", () => {
    renderPlayer();
    const audio = audioEl();

    mediaState(audio, { duration: 200 });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByTestId("audio-seek")).toHaveAttribute("max", "200");

    mediaState(audio, { currentTime: 65 });
    fireEvent.timeUpdate(audio);
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("1:05");
    expect(screen.getByTestId("audio-remaining")).toHaveTextContent("-2:15");
    expect(screen.getByTestId("audio-seek")).toHaveAttribute("value", "65");
  });

  it("skips ±15s within the duration bounds", () => {
    renderPlayer();
    const audio = audioEl();
    mediaState(audio, { duration: 200, currentTime: 65 });
    fireEvent.loadedMetadata(audio);

    fireEvent.timeUpdate(audio);

    fireEvent.click(screen.getByTestId("audio-forward15"));
    expect(audio.currentTime).toBe(80);
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("1:20");

    fireEvent.click(screen.getByTestId("audio-back15"));
    expect(audio.currentTime).toBe(65);

    mediaState(audio, { currentTime: 5 });
    fireEvent.timeUpdate(audio);
    fireEvent.click(screen.getByTestId("audio-back15"));
    expect(audio.currentTime).toBe(0);
  });

  it("seeks when the scrubber moves", async () => {
    renderPlayer();
    const audio = audioEl();
    mediaState(audio, { duration: 200 });
    fireEvent.loadedMetadata(audio);

    fireEvent.change(screen.getByTestId("audio-seek"), { target: { value: "100" } });
    expect(audio.currentTime).toBe(100);
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("1:40");
  });

  it("maps an element error to the retryable failure state and retry re-issues the source", async () => {
    renderPlayer();
    const audio = audioEl();
    mediaState(audio, { duration: 200, currentTime: 30 });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);

    fireEvent.error(audio);
    expect(await screen.findByTestId("state-retryable")).toBeInTheDocument();
    expect(screen.queryByTestId("audio-play")).not.toBeInTheDocument();
    // Download survives the stream failure.
    expect(download()).toHaveAttribute("href", "/files/v1/music/track01.mp3");

    await userEvent.setup().click(await screen.findByTestId("action-retry"));

    const revived = audioEl();
    expect(screen.queryByTestId("state-retryable")).not.toBeInTheDocument();
    expect(screen.getByTestId("audio-play")).toBeInTheDocument();
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("0:00");
    expect(revived.getAttribute("src")).toBe("/files/v1/music/track01.mp3");
  });

  it("skips through the folder's audio entries in listing order and wraps at both ends", async () => {
    renderPlayer();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3"));

    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track03.flac"));

    // Wrap forward: last -> first.
    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track01.mp3"));

    // Wrap backward: first -> last.
    await user.click(screen.getByTestId("audio-prev"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track03.flac"));
    expect(audioEl().getAttribute("src")).toBe("/files/v1/music/track03.flac");
  });

  it("updates the whole player surface and download target with the track", async () => {
    renderPlayer();
    const audio = audioEl();
    mediaState(audio, { duration: 200, currentTime: 90 });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);

    await userEvent.setup().click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3"));

    expect(audioEl().getAttribute("src")).toBe("/files/v1/music/track02.mp3");
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("0:00");
    expect(screen.getByTestId("audio-remaining")).toHaveTextContent("-0:00");
    expect(screen.getByTestId("audio-seek")).toHaveAttribute("max", "0");
    expect(screen.getByTestId("audio-seek")).toHaveAttribute("value", "0");
    expect(download()).toHaveAttribute("href", "/files/v1/music/track02.mp3");
  });

  it("keeps the playback state on a manual skip", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    renderPlayer();
    const user = userEvent.setup();

    // Paused -> skip stays paused and does not start playback.
    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3"));
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByTestId("audio-play")).toHaveAttribute("aria-label", "Play");

    // Playing -> skip keeps playing the new track.
    await user.click(screen.getByTestId("audio-play"));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.play(audioEl());
    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track03.flac"));
    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).not.toHaveBeenCalled();
  });

  it("returns to the browse listing after skipping through tracks", async () => {
    renderPlayer();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3"));
    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track03.flac"));

    await user.click(screen.getByTestId("history-back"));

    await waitFor(() => expect(screen.getByTestId("browse-probe")).toBeInTheDocument());
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/v/v1/music");
  });

  it("falls back to a single-entry queue when the path is missing from the listing", async () => {
    renderPlayer("music/orphan.mp3", ALBUM);

    expect(screen.getByTestId("audio-title")).toHaveTextContent("orphan.mp3");
    await userEvent.setup().click(screen.getByTestId("audio-next"));
    expect(screen.getByTestId("audio-title")).toHaveTextContent("orphan.mp3");
    expect(audioEl().getAttribute("src")).toBe("/files/v1/music/orphan.mp3");
  });

  it("advances automatically when a track ends and wraps from the last to the first", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderPlayer();
    const user = userEvent.setup();

    fireEvent.ended(audioEl());
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3"));
    expect(play).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("audio-next"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track03.flac"));

    fireEvent.ended(audioEl());
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track01.mp3"));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("leaves the next track paused when the browser refuses the automatic start", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("blocked by policy"));
    renderPlayer();

    fireEvent.ended(audioEl());

    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3"));
    await waitFor(() => expect(screen.getByTestId("audio-play")).toHaveAttribute("aria-label", "Play"));
    expect(screen.queryByTestId("state-retryable")).not.toBeInTheDocument();
    expect(audioEl().getAttribute("src")).toBe("/files/v1/music/track02.mp3");
  });

  it("replays a single-track folder when it ends", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderPlayer("music/only.mp3", SOLO);
    const audio = audioEl();
    mediaState(audio, { duration: 5, currentTime: 5 });
    fireEvent.loadedMetadata(audio);

    fireEvent.ended(audio);

    expect(screen.getByTestId("audio-title")).toHaveTextContent("only.mp3");
    expect(audioEl()).toBe(audio);
    expect(audio.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("uses the folder's first image entry as cover art and keeps the music placeholder otherwise", () => {
    renderPlayer();
    const cover = screen.getByTestId("audio-cover") as HTMLImageElement;
    expect(cover.getAttribute("src")).toBe("/files/v1/music/cover.png");
    expect(cover.getAttribute("alt")).toBe("");
    expect(screen.queryByTestId("audio-cover-placeholder")).not.toBeInTheDocument();
  });

  it("shows the placeholder and makes no image request when the folder has no image", () => {
    renderPlayer("music/track01.mp3", [entry("track01.mp3"), entry("notes.txt")]);
    expect(screen.queryByTestId("audio-cover")).not.toBeInTheDocument();
    expect(screen.getByTestId("audio-cover-placeholder")).toBeInTheDocument();
  });

  it("falls back silently when the cover cannot be decoded", () => {
    renderPlayer();
    fireEvent.error(screen.getByTestId("audio-cover"));

    expect(screen.queryByTestId("audio-cover")).not.toBeInTheDocument();
    expect(screen.getByTestId("audio-cover-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("state-retryable")).not.toBeInTheDocument();
    expect(screen.getByTestId("audio-stream")).toBeInTheDocument();
  });

  it("loads cover, track, and download through the plain /files URL on a public vdir", () => {
    renderPlayer("music/track01.mp3", ALBUM, "pub");

    expect(audioEl().getAttribute("src")).toBe("/files/pub/music/track01.mp3");
    expect(screen.getByTestId("audio-cover")).toHaveAttribute("src", "/files/pub/music/cover.png");
    expect(download()).toHaveAttribute("href", "/files/pub/music/track01.mp3");
  });
});
