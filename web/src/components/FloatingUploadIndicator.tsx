// Floating uploads indicator (upload-queue spec): while uploads are
// active and the user is not on the Uploads destination, a small pill
// above the tab bar shows progress and opens the Uploads destination.

import { useNavigate } from "react-router";
import { uploadQueue, type UploadQueue } from "../lib/uploadQueue";
import { useUploadQueue } from "../lib/useUploadQueue";
import { RefreshIcon } from "./icons";

export function FloatingUploadIndicator({
  count,
  queue = uploadQueue,
}: {
  count?: number;
  queue?: UploadQueue;
}) {
  const navigate = useNavigate();
  const snapshot = useUploadQueue(queue);
  const active =
    count ??
    snapshot.items.filter(
      (it) => it.state === "queued" || it.state === "running" || it.state === "paused",
    ).length;

  if (active <= 0) return null;

  return (
    <button
      type="button"
      data-testid="floating-upload-indicator"
      onClick={() => void navigate("/uploads")}
      className="fixed right-4 bottom-24 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md active:scale-95 md:bottom-6"
    >
      <RefreshIcon className="animate-spin text-sm" />
      <span className="font-medium">{active} Uploading</span>
    </button>
  );
}
