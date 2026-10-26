// In-app audio player (web-ui spec, add-audio-player-image-viewer D3,
// add-audio-playlist-navigation): a native <audio> element streams the
// file's plain /files URL (cookie-authenticated, HTTP Range for seeking)
// under custom iOS-style transport controls per the design showcase
// (S6_AUDIO). The containing folder's audio entries form the queue
// (listing order), skip next/previous wrap, and a finished track
// auto-advances. The folder's first image entry is the cover art.
// Playback starts paused; the element drives the scrubber and times. An
// element error renders the standard retryable failure state and retry
// re-issues the source (design D6 of add-audio-player-image-viewer).

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiFailure, filesUrl, type LsEntry } from "../lib/filesApi";
import { entryKind } from "../lib/entryKind";
import { joinPath, parentPath, previewUrl } from "../lib/listing";
import { FailureState } from "../components/Errors";
import { DownloadIcon, MusicIcon, PauseIcon, PlayIcon } from "../components/icons";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function AudioPlayerPage({
  vdirId,
  path,
  entry,
  listing,
}: {
  vdirId: string;
  path: string;
  entry: LsEntry;
  listing: LsEntry[];
}) {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lastPath, setLastPath] = useState(path);
  const [failedCover, setFailedCover] = useState<string | null>(null);

  // Set before a route change; the effect after the remount consumes it.
  // Initial openings leave it false, so playback only starts on an
  // explicit user action.
  const autoplayRef = useRef(false);

  const dir = parentPath(path);
  const name = path.split("/").filter(Boolean).pop() ?? "";

  // The queue and cover derive from the listing PreviewPage already
  // fetched for this directory (design D1). If the opened path is not
  // in the listing (e.g. it vanished between fetch and render), the
  // single-entry fallback keeps the stream usable.
  const { queue, coverPath } = useMemo(() => {
    const audioEntries = listing.filter((e) => !e.dir && entryKind(e.name) === "audio");
    const hasCurrent = audioEntries.some((e) => e.name === name);
    const cover = listing.find((e) => !e.dir && entryKind(e.name) === "image");
    return {
      queue: hasCurrent ? audioEntries : [entry],
      coverPath: cover ? joinPath(dir, cover.name) : null,
    };
  }, [listing, entry, name, dir]);

  // A track change remounts the element via its key below; the held
  // counters and failure state reset here (the React-sanctioned
  // adjust-state-during-render pattern, as in the image gallery).
  if (path !== lastPath) {
    setLastPath(path);
    setCurrentTime(0);
    setDuration(0);
    setFailure(null);
    setPlaying(autoplayRef.current);
  }

  // Consume the navigation intent once the new element exists. A
  // refused automatic start (autoplay policy) is not a stream failure:
  // the track simply stays paused.
  useEffect(() => {
    if (!autoplayRef.current) return;
    autoplayRef.current = false;
    const el = audioRef.current;
    if (!el) return;
    const started = el.play();
    if (started) started.catch(() => setPlaying(false));
  }, [path, attempt]);

  const url = filesUrl(vdirId, path);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    const started = el.play();
    if (started) started.catch(() => setFailure(new ApiFailure("retryable", 0, "The audio stream failed.")));
  };

  const skip = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const limit = Number.isFinite(el.duration) ? el.duration : el.currentTime;
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), limit);
    setCurrentTime(el.currentTime);
  };

  const seek = (value: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = value;
    setCurrentTime(value);
  };

  // Adjacent queue entry with wrap at both ends (design D4). Selecting
  // another track is a replace-navigation so back still returns to the
  // browse listing; a one-track queue restarts in place.
  const goToTrack = (step: number, autoplay: boolean) => {
    if (queue.length === 0) return;
    const index = queue.findIndex((e) => e.name === name);
    const base = index < 0 ? 0 : index;
    const target = queue[(base + step + queue.length) % queue.length];
    if (!target) return;
    const targetPath = joinPath(dir, target.name);
    if (targetPath === path) {
      const el = audioRef.current;
      if (el) {
        el.currentTime = 0;
        setCurrentTime(0);
        if (autoplay) {
          const started = el.play();
          if (started) started.catch(() => setPlaying(false));
        }
      }
      return;
    }
    autoplayRef.current = autoplay;
    void navigate(previewUrl(vdirId, targetPath), { replace: true });
  };

  const retry = () => {
    autoplayRef.current = false;
    setFailure(null);
    setCurrentTime(0);
    setDuration(0);
    setAttempt((n) => n + 1);
  };

  const onEnded = () => {
    setPlaying(false);
    goToTrack(1, true);
  };

  const remaining = duration > currentTime ? duration - currentTime : 0;
  const coverUrl = coverPath ? filesUrl(vdirId, coverPath) : null;
  const showCover = coverUrl !== null && failedCover !== coverPath;

  return (
    <div className="flex flex-1 flex-col bg-[#1C1C1E] px-6 py-8 text-white">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div
          data-testid="audio-artwork"
          className="h-56 w-56 overflow-hidden rounded-3xl shadow-2xl"
        >
          {showCover ? (
            <img
              data-testid="audio-cover"
              src={coverUrl}
              alt=""
              onError={() => setFailedCover(coverPath)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              data-testid="audio-cover-placeholder"
              className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-pink-600 to-rose-400 text-7xl text-white"
            >
              <MusicIcon />
            </div>
          )}
        </div>
        <h2 data-testid="audio-title" className="mt-6 max-w-full truncate text-xl font-bold">
          {name}
        </h2>
        <p className="mt-1 text-sm text-white/50">Audio stream</p>
      </div>

      {failure && <FailureState failure={failure} onRetry={retry} />}

      {!failure && (
        <div className="space-y-5">
          {/* key={path + attempt} remounts the element per track and on
              retry so a new source never reuses a failed decoder. */}
          <audio
            key={`${path}:${attempt}`}
            ref={audioRef}
            data-testid="audio-stream"
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onEnded={onEnded}
            onError={() => setFailure(new ApiFailure("retryable", 0, "The audio stream failed."))}
            className="hidden"
          />

          <input
            type="range"
            data-testid="audio-seek"
            aria-label="Seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full accent-white"
          />
          <div className="flex justify-between font-mono text-xs text-white/50">
            <span data-testid="audio-elapsed">{clock(currentTime)}</span>
            <span data-testid="audio-remaining">-{clock(remaining)}</span>
          </div>

          <div className="flex items-center justify-center gap-5 text-sm font-semibold text-white/80">
            <button
              type="button"
              data-testid="audio-prev"
              aria-label="Skip previous"
              onClick={() => goToTrack(-1, playing)}
              className="px-2 py-3 text-xs uppercase tracking-wide active:scale-95"
            >
              Prev
            </button>
            <button
              type="button"
              data-testid="audio-back15"
              aria-label="Back 15 seconds"
              onClick={() => skip(-15)}
              className="active:scale-95"
            >
              -15s
            </button>
            <button
              type="button"
              data-testid="audio-play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={toggle}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-xl text-black shadow-lg active:scale-95"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              data-testid="audio-forward15"
              aria-label="Forward 15 seconds"
              onClick={() => skip(15)}
              className="active:scale-95"
            >
              +15s
            </button>
            <button
              type="button"
              data-testid="audio-next"
              aria-label="Skip next"
              onClick={() => goToTrack(1, playing)}
              className="px-2 py-3 text-xs uppercase tracking-wide active:scale-95"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Download does not depend on the stream — it stays available
          even when playback failed. */}
      <a
        href={url}
        download
        data-testid="preview-download"
        className="mx-auto mt-5 flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border border-white/20 py-3 font-semibold text-white active:scale-95"
      >
        <DownloadIcon /> Download
      </a>
    </div>
  );
}
