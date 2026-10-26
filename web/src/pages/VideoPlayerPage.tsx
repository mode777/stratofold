// In-app video player (web-ui spec, add-video-player): a native <video>
// streams the file's plain /files URL (cookie-authenticated, HTTP Range
// for seeking) under the same iOS-style transport controls as the audio
// player. Playback starts paused. The header/back control comes from the
// surrounding preview page; a stream/decoder error renders the standard
// retryable failure state and retry re-creates the source.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ApiFailure, filesUrl, type LsEntry } from "../lib/filesApi";
import { useCast, type CastFailure } from "../lib/cast";
import { videoContentType } from "../lib/entryKind";
import { FailureState } from "../components/Errors";
import {
  CastIcon,
  DownloadIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon,
} from "../components/icons";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VideoPlayerPage({
  vdirId,
  path,
  entry,
}: {
  vdirId: string;
  path: string;
  entry: LsEntry;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const url = filesUrl(vdirId, path);
  const { available, status, deviceName, failure, initialize, cast } = useCast();

  // The SDK is loaded lazily when a video player opens, never app-wide.
  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Local playback pauses while the TV owns the stream.
  useEffect(() => {
    if (status === "connected" || status === "casting") {
      videoRef.current?.pause();
      setPlaying(false);
    }
  }, [status]);

  const castFailure = (kind: CastFailure): string => {
    switch (kind) {
      case "mint":
        return "Could not prepare the video for casting. Try again.";
      case "no-device":
        return "No cast device was selected.";
      case "load":
        return "This video cannot be played on the selected device.";
      default:
        return "Casting is not available here.";
    }
  };

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    const started = el.play();
    if (started) {
      started.then(() => setPlaying(true)).catch(() => setFailed(true));
    }
  };

  const seek = (e: ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    const next = Number(e.target.value);
    el.currentTime = next;
    setCurrentTime(next);
  };

  const changeVolume = (e: ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    const next = Number(e.target.value);
    el.volume = next;
    el.muted = false;
    setVolume(next);
    setMuted(false);
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const enterFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.requestFullscreen) {
      void stage.requestFullscreen().catch(() => {});
      return;
    }
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    el?.webkitEnterFullscreen?.();
  };

  const retry = () => {
    setFailed(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAttempt((n) => n + 1);
  };

  return (
    <div data-testid="video-player" className="px-4 pb-4">
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-2xl bg-black shadow-lg"
      >
        <video
          key={attempt}
          ref={videoRef}
          data-testid="video-stream"
          src={url}
          playsInline
          preload="metadata"
          aria-label={entry.name}
          className="aspect-video w-full bg-black"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume);
            setMuted(e.currentTarget.muted);
          }}
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
        />
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
            <FailureState
              failure={new ApiFailure("retryable", 0, "The video stream failed.")}
              onRetry={retry}
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          data-testid="video-play"
          aria-label={playing ? "Pause" : "Play"}
          onClick={toggle}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ios-blue text-white shadow-sm"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span data-testid="video-time" className="w-10 shrink-0 text-xs text-ios-secondary">
          {clock(currentTime)}
        </span>
        <input
          type="range"
          data-testid="video-seek"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          className="min-w-0 flex-1"
        />
        <span data-testid="video-remaining" className="w-10 shrink-0 text-right text-xs text-ios-secondary">
          -{clock(Math.max(0, duration - currentTime))}
        </span>
        <button
          type="button"
          data-testid="video-mute"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={toggleMute}
          className="shrink-0 text-ios-secondary"
        >
          {muted ? <MuteIcon /> : <VolumeIcon />}
        </button>
        <input
          type="range"
          data-testid="video-volume"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={changeVolume}
          className="w-14 shrink-0"
        />
        {available && (
          <button
            type="button"
            data-testid="video-cast"
            aria-label="Cast"
            onClick={() =>
              void cast({
                vdirId,
                path,
                title: entry.name,
                contentType: videoContentType(entry.name),
              })
            }
            disabled={status === "connecting"}
            className="shrink-0 text-ios-blue disabled:opacity-40"
          >
            <CastIcon />
          </button>
        )}
        <button
          type="button"
          data-testid="video-fullscreen"
          aria-label="Fullscreen"
          onClick={enterFullscreen}
          className="shrink-0 text-ios-secondary"
        >
          <FullscreenIcon />
        </button>
        <a
          data-testid="video-download"
          href={url}
          download
          aria-label="Download"
          className="shrink-0 text-ios-secondary"
        >
          <DownloadIcon />
        </a>
      </div>

      {deviceName && (status === "connected" || status === "casting") && (
        <p data-testid="video-cast-state" className="mt-2 text-sm text-ios-secondary">
          Playing on {deviceName}
        </p>
      )}
      {failure && (
        <p data-testid="video-cast-failure" role="status" className="mt-2 text-sm text-ios-red">
          {castFailure(failure)}
        </p>
      )}
    </div>
  );
}
