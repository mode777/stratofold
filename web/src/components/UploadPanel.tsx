// Persistent upload status panel (upload-queue spec, design D2/D6):
// mounted in the app shell so the queue's items, progress, and
// pause/cancel/retry controls stay reachable on every authenticated
// screen.

import { uploadQueue, type UploadItem, type UploadQueue } from "../lib/uploadQueue";
import { useUploadQueue } from "../lib/useUploadQueue";

const STATE_LABEL: Record<UploadItem["state"], string> = {
  queued: "Queued",
  running: "Uploading",
  paused: "Paused",
  completed: "Done",
  canceled: "Canceled",
  failed: "Failed",
};

const controlCls = "rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50";

function percent(item: UploadItem): number {
  if (item.state === "completed") return 100;
  if (item.total <= 0) return 0;
  return Math.min(100, Math.round((item.loaded / item.total) * 100));
}

function isActive(state: UploadItem["state"]): boolean {
  return state === "queued" || state === "running" || state === "paused";
}

export function UploadPanel({ queue = uploadQueue }: { queue?: UploadQueue } = {}) {
  const { items, paused } = useUploadQueue(queue);

  return (
    <section
      data-testid="upload-panel"
      aria-label="Uploads"
      className="fixed bottom-0 right-0 z-30 m-3 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-800">
          Uploads{items.length > 0 ? ` (${items.length})` : ""}
        </h2>
        {items.length > 0 && (
          <button
            type="button"
            data-testid="queue-toggle"
            onClick={() => (paused ? queue.resume() : queue.pause())}
            className={controlCls}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p data-testid="upload-empty" className="px-3 py-2 text-sm text-gray-500">
          No uploads.
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-gray-100 overflow-auto">
          {items.map((item) => (
            <li key={item.id} data-testid="upload-item" className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span data-testid="upload-name" className="min-w-0 flex-1 truncate text-sm">
                  {item.name}
                </span>
                <span data-testid="upload-state" className="text-xs text-gray-500">
                  {STATE_LABEL[item.state]}
                </span>
              </div>
              <progress
                data-testid="upload-progress"
                value={percent(item)}
                max={100}
                className="mt-1 h-1 w-full"
              />
              <div className="mt-1 flex items-center gap-2">
                {isActive(item.state) && (
                  <button
                    type="button"
                    data-testid="upload-cancel"
                    onClick={() => queue.cancel(item.id)}
                    className={controlCls}
                  >
                    Cancel
                  </button>
                )}
                {(item.state === "failed" || item.state === "canceled") && (
                  <button
                    type="button"
                    data-testid="upload-retry"
                    onClick={() => queue.retry(item.id)}
                    className={controlCls}
                  >
                    Retry
                  </button>
                )}
              </div>
              {item.error && (
                <p role="alert" data-testid="upload-error" className="mt-1 text-xs text-red-600">
                  {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
