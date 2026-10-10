// In-app audio player (web-ui spec, add-audio-player-image-viewer
// D3): a native <audio> element streams the file's plain /files URL
// (cookie-authenticated, HTTP Range for seeking) under custom
// iOS-style transport controls per the design showcase (S6_AUDIO).
// Playback starts paused; the element drives the scrubber and times.
// An element error renders the standard retryable failure state and
// retry re-issues the source (design D6).

import { useRef, useState } from "react";
import { ApiFailure, filesUrl } from "../lib/filesApi";
import { FailureState } from "../components/Errors";
import { DownloadIcon, MusicIcon, PauseIcon, PlayIcon } from "../components/icons";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function AudioPlayerPage({ vdirId, path }: { vdirId: string; path: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const name = path.split("/").filter(Boolean).pop() ?? "";
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

  const retry = () => {
    setFailure(null);
    setCurrentTime(0);
    setDuration(0);
    setAttempt((n) => n + 1);
  };

  const remaining = duration > currentTime ? duration - currentTime : 0;

  return (
    <div className="flex flex-1 flex-col bg-[#1C1C1E] px-6 py-8 text-white">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="flex h-56 w-56 items-center justify-center rounded-3xl bg-gradient-to-tr from-pink-600 to-rose-400 text-7xl text-white shadow-2xl">
          <MusicIcon />
        </div>
        <h2 data-testid="audio-title" className="mt-6 max-w-full truncate text-xl font-bold">
          {name}
        </h2>
        <p className="mt-1 text-sm text-white/50">Audio stream</p>
      </div>

      {failure && <FailureState failure={failure} onRetry={retry} />}

      {!failure && (
        <div className="space-y-5">
          {/* key={attempt} remounts the element so a retry re-issues
              the source rather than reusing the failed decoder. */}
          <audio
            key={attempt}
            ref={audioRef}
            data-testid="audio-stream"
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
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

          <div className="flex items-center justify-center gap-10 text-base font-semibold text-white/80">
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
