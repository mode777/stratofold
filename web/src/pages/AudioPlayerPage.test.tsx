import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AudioPlayerPage } from "./AudioPlayerPage";

// jsdom implements media elements as inert stubs: properties are
// shadowed per-element and the play/pause calls are spied.
function mediaState(el: HTMLMediaElement, props: { duration?: number; currentTime?: number }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(el, key, { configurable: true, writable: true, value });
  }
}

function renderPlayer() {
  return render(<AudioPlayerPage vdirId="v1" path="music/track01.mp3" />);
}

function audioEl(): HTMLMediaElement {
  return screen.getByTestId("audio-stream") as unknown as HTMLMediaElement;
}

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

    const download = screen.getByTestId("preview-download");
    expect(download).toHaveAttribute("href", "/files/v1/music/track01.mp3");
    expect(download).toHaveAttribute("download");
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
    expect(screen.getByTestId("preview-download")).toHaveAttribute("href", "/files/v1/music/track01.mp3");

    await userEvent.setup().click(await screen.findByTestId("action-retry"));

    const revived = audioEl();
    expect(screen.queryByTestId("state-retryable")).not.toBeInTheDocument();
    expect(screen.getByTestId("audio-play")).toBeInTheDocument();
    expect(screen.getByTestId("audio-elapsed")).toHaveTextContent("0:00");
    expect(revived.getAttribute("src")).toBe("/files/v1/music/track01.mp3");
  });
});
