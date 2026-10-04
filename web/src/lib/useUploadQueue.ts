// React binding for the upload queue (design D2): useSyncExternalStore
// subscribes the component to the framework-free singleton so queue
// changes (progress ticks included) re-render it.

import { useSyncExternalStore } from "react";
import { uploadQueue, type QueueSnapshot, type UploadQueue } from "./uploadQueue";

export function useUploadQueue(queue: UploadQueue = uploadQueue): QueueSnapshot {
  return useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
}
