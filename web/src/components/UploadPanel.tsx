// Upload queue view (upload-queue spec, design D8): the queue's items,
// progress, lifecycle state, and pause/cancel/retry controls, rendered
// on the Uploads destination. The queue singleton is unchanged.

import { uploadQueue, type UploadItem, type UploadQueue } from "../lib/uploadQueue";
import { useUploadQueue } from "../lib/useUploadQueue";
import { CircleCheckIcon, CircleXIcon, PauseIcon, PlayIcon, RefreshIcon, WarningIcon, DocIcon } from "./icons";

function percent(item: UploadItem): number {
  if (item.state === "completed") return 100;
  if (item.total <= 0) return 0;
  return Math.min(100, Math.round((item.loaded / item.total) * 100));
}

function isActive(state: UploadItem["state"]): boolean {
  return state === "queued" || state === "running" || state === "paused";
}

function statusText(item: UploadItem): string {
  const pct = percent(item);
  if (item.state === "running") return pct >= 100 ? "Finishing… (awaiting server confirm)" : `Uploading · ${pct}%`;
  if (item.state === "paused") return `Paused · ${pct}%`;
  if (item.state === "completed") return "Done";
  if (item.state === "failed") return "Failed";
  if (item.state === "canceled") return "Canceled";
  return "Queued";
}

function ItemIcon({ item }: { item: UploadItem }) {
  const tone =
    item.state === "failed"
      ? "bg-rose-50 text-ios-red"
      : item.state === "completed"
        ? "bg-emerald-50 text-ios-green"
        : "bg-ios-blue/10 text-ios-blue";
  const Icon = item.state === "failed" ? WarningIcon : item.state === "completed" ? CircleCheckIcon : DocIcon;
  return (
    <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm ${tone}`}>
      <Icon />
    </span>
  );
}

export function UploadPanel({ queue = uploadQueue }: { queue?: UploadQueue } = {}) {
  const { items, paused } = useUploadQueue(queue);
  const active = items.filter((it) => isActive(it.state)).length;

  return (
    <section data-testid="upload-panel" aria-label="Uploads" className="flex min-h-dvh flex-col pb-24 md:pb-0">
      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ios-label">Uploads</h1>
        {items.length > 0 && (
          <button
            type="button"
            data-testid="queue-toggle"
            onClick={() => (paused ? queue.resume() : queue.pause())}
            className="flex items-center gap-1.5 rounded-full border border-ios-separator bg-ios-card px-3 py-1.5 text-xs font-semibold text-ios-blue shadow-sm"
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? "Resume All" : "Pause All"}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div data-testid="upload-empty" className="flex flex-1 flex-col items-center px-6 py-12 text-center">
          <span className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-ios-blue/10 text-3xl text-ios-blue">
            <DocIcon />
          </span>
          <p className="text-lg font-semibold text-ios-label">No uploads</p>
          <p className="mt-1 max-w-xs text-sm text-ios-secondary/60">
            Uploads from the Files tab appear here — they keep going while you use the app.
          </p>
        </div>
      ) : (
        <ul className="flex-1 space-y-3 px-4 pb-24">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="upload-item"
              className="rounded-2xl border border-black/5 bg-ios-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ItemIcon item={item} />
                  <div className="min-w-0">
                    <p data-testid="upload-name" className="truncate text-sm font-semibold text-ios-label">
                      {item.name}
                    </p>
                    <p
                      data-testid="upload-state"
                      className={`text-xs font-medium ${
                        item.state === "failed"
                          ? "text-ios-red"
                          : item.state === "completed"
                            ? "text-ios-green"
                            : "text-ios-blue"
                      }`}
                    >
                      {statusText(item)}
                    </p>
                  </div>
                </div>
                {isActive(item.state) && (
                  <button
                    type="button"
                    data-testid="upload-cancel"
                    aria-label={`Cancel ${item.name}`}
                    onClick={() => queue.cancel(item.id)}
                    className="shrink-0 rounded-full p-1 text-ios-secondary/50 hover:bg-black/5"
                  >
                    <CircleXIcon className="text-lg" />
                  </button>
                )}
                {(item.state === "failed" || item.state === "canceled") && (
                  <button
                    type="button"
                    data-testid="upload-retry"
                    aria-label={`Retry ${item.name}`}
                    onClick={() => queue.retry(item.id)}
                    className="shrink-0 rounded-full p-1 text-ios-blue hover:bg-ios-blue/10"
                  >
                    <RefreshIcon className="text-lg" />
                  </button>
                )}
              </div>

              {item.state !== "failed" && item.state !== "canceled" && (
                <progress
                  data-testid="upload-progress"
                  value={percent(item)}
                  max={100}
                  className="mt-3 h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-ios-separator [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-ios-blue [&::-moz-progress-bar]:bg-ios-blue"
                />
              )}

              {item.error && (
                <p role="alert" data-testid="upload-error" className="mt-2 text-xs text-ios-red">
                  {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">{active} active uploads</span>
    </section>
  );
}
