// React binding for the extraction tracker (design D12): the same
// useSyncExternalStore shape as the upload queue, so job progress
// re-renders every surface that shows it.

import { useSyncExternalStore } from "react";
import { extractJobs, type ExtractSnapshot, type ExtractTracker } from "./extractJobs";

export function useExtractJobs(tracker: ExtractTracker = extractJobs): ExtractSnapshot {
  return useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
}
