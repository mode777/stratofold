// Floating activity indicator (upload-queue + archive-extraction specs):
// while uploads or extractions are active and the user is not on the
// Uploads destination, a small pill above the tab bar shows the count and
// opens that destination.

import { useNavigate } from "react-router";
import { uploadQueue, type UploadQueue } from "../lib/uploadQueue";
import { extractJobs, isActive as isActiveExtract } from "../lib/extractJobs";
import { useExtractJobs } from "../lib/useExtractJobs";
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
  const extracts = useExtractJobs(extractJobs);
  const activeUploads =
    count ??
    snapshot.items.filter(
      (it) => it.state === "queued" || it.state === "running" || it.state === "paused",
    ).length;
  const activeExtracts = extracts.jobs.filter(isActiveExtract).length;
  const active = activeUploads + activeExtracts;

  if (active <= 0) return null;

  // Keep the established upload wording; name extraction explicitly when
  // it is the only thing running, and stay neutral when both are.
  const label =
    activeUploads > 0 && activeExtracts > 0
      ? `${active} active`
      : activeExtracts > 0
        ? `${active} Extracting`
        : `${active} Uploading`;

  return (
    <button
      type="button"
      data-testid="floating-upload-indicator"
      onClick={() => void navigate("/uploads")}
      className="fixed right-4 bottom-24 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md active:scale-95 md:bottom-6"
    >
      <RefreshIcon className="animate-spin text-sm" />
      <span className="font-medium">{label}</span>
    </button>
  );
}
