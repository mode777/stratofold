// In-app upload manager (upload-queue spec, design D2/D6): a
// framework-free queue singleton that keeps uploading while the user
// navigates. React binds through useUploadQueue; tests drive it with an
// injected upload function (and an injected mkdir for folder items).
// Folder items (design D3) create a directory ahead of the files inside
// it, and a folder's terminal outcome carries to its pending dependents.

import {
  ApiFailure,
  UploadCanceled,
  mkdir as mkdirDirectory,
  uploadFile,
  type UploadOptions,
  type UploadResult,
} from "./filesApi";

export type UploadState = "queued" | "running" | "paused" | "completed" | "canceled" | "failed";

export type UploadKind = "upload" | "folder";

export type UploadItem = {
  id: string;
  kind: UploadKind;
  vdirId: string;
  dir: string;
  name: string;
  path: string;
  size: number;
  state: UploadState;
  loaded: number;
  total: number;
  attempts: number;
  error: string | null;
  // failedBy marks an item whose terminal state was carried over from a
  // folder item, so re-enqueueing that folder restores it.
  failedBy: string | null;
  // file is present only for upload items; folder items create a
  // directory and carry no content.
  file?: File | Blob;
};

export type UploadFn = (
  vdirId: string,
  path: string,
  file: File | Blob,
  options: UploadOptions,
) => Promise<UploadResult>;

export type MkdirFn = (vdirId: string, path: string) => Promise<void>;

// QueueEntry is the path-carrying enqueue shape: a drop plan (or any
// caller that already knows the full virtual target) enqueues uploads
// and folder creations together, in the order given.
export type QueueEntry =
  | { kind: "upload"; path: string; file: File | Blob }
  | { kind: "folder"; path: string };

export type QueueSnapshot = {
  items: UploadItem[];
  paused: boolean;
  runningId: string | null;
};

// Initial attempt plus up to two automatic retries for retryable
// failures (design D6) — a bounded budget, never a retry storm.
const MAX_ATTEMPTS = 3;

function cleanPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function baseName(path: string): string {
  const clean = cleanPath(path);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? clean : clean.slice(idx + 1);
}

function parentOf(path: string): string {
  const clean = cleanPath(path);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? "" : clean.slice(0, idx);
}

// isUnder reports whether path lies inside folder (not equal to it).
function isUnder(path: string, folder: string): boolean {
  return cleanPath(path).startsWith(`${cleanPath(folder)}/`);
}

// normalizeTarget keys a target for dedupe: the vdir id plus the
// slash-normalized virtual path.
export function normalizeTarget(vdirId: string, path: string): string {
  const clean = cleanPath(path);
  return `${vdirId}\n${clean}`;
}

function fileName(file: File | Blob): string {
  return typeof File !== "undefined" && file instanceof File ? file.name : "upload.bin";
}

let seq = 0;

export class UploadQueue {
  private items: UploadItem[] = [];
  private paused = false;
  private runningId: string | null = null;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  private settledListeners = new Set<(item: UploadItem) => void>();
  private snapshot: QueueSnapshot = { items: [], paused: false, runningId: null };
  private readonly upload: UploadFn;
  private readonly mkdir: MkdirFn;

  constructor(upload: UploadFn = uploadFile, mkdir: MkdirFn = mkdirDirectory) {
    this.upload = upload;
    this.mkdir = mkdir;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // onSettled notifies a subscriber when an item reaches a terminal
  // state (completed, failed, or canceled) — the seam the browse view
  // uses to refresh after an upload lands (design D5), mirroring
  // extractJobs.onSettled.
  onSettled(listener: (item: UploadItem) => void): () => void {
    this.settledListeners.add(listener);
    return () => {
      this.settledListeners.delete(listener);
    };
  }

  getSnapshot = (): QueueSnapshot => this.snapshot;

  // enqueue keeps the picker path's flat signature: files land in dir
  // under their own names.
  enqueue(vdirId: string, dir: string, files: Array<File | Blob>): void {
    this.enqueueEntries(
      vdirId,
      files.map((file) => ({
        kind: "upload" as const,
        path: dir ? `${cleanPath(dir)}/${fileName(file)}` : fileName(file),
        file,
      })),
    );
  }

  // enqueueEntries takes explicit full target paths — the shape a drop
  // plan produces (folders first, then their files). Dedupe keys on the
  // normalized target across both kinds.
  enqueueEntries(vdirId: string, entries: QueueEntry[]): void {
    let changed = false;
    for (const entry of entries) {
      const path = cleanPath(entry.path);
      if (!path) continue;
      const key = normalizeTarget(vdirId, path);
      const alreadyActive = this.items.some(
        (it) => normalizeTarget(it.vdirId, it.path) === key && isActive(it.state),
      );
      if (alreadyActive) continue;
      const size = entry.kind === "upload" ? entry.file.size : 0;
      this.items.push({
        id: `u${(seq += 1)}`,
        kind: entry.kind,
        vdirId,
        dir: parentOf(path),
        name: baseName(path),
        path,
        size,
        state: this.paused ? "paused" : "queued",
        loaded: 0,
        total: size,
        attempts: 0,
        error: null,
        failedBy: null,
        file: entry.kind === "upload" ? entry.file : undefined,
      });
      changed = true;
    }
    if (changed) {
      this.emit();
      this.dispatch();
    }
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const item of this.items) {
      if (item.state === "queued") item.state = "paused";
    }
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const item of this.items) {
      if (item.state === "paused") item.state = "queued";
    }
    this.emit();
    this.dispatch();
  }

  cancel(id: string): void {
    const item = this.find(id);
    if (!item) return;
    if (item.state === "running") {
      if (item.kind === "folder") {
        // A directory creation cannot be aborted mid-request; record the
        // cancellation now and ignore the late result in run().
        item.state = "canceled";
        item.error = null;
        this.cascade(item, "canceled");
        this.settle(item);
        this.emit();
        return;
      }
      // The abort rejection flips the state to canceled.
      this.controller?.abort();
      return;
    }
    if (item.state === "queued" || item.state === "paused") {
      item.state = "canceled";
      item.error = null;
      this.cascade(item, "canceled");
      this.settle(item);
      this.emit();
    }
  }

  retry(id: string): void {
    const item = this.find(id);
    if (!item || (item.state !== "failed" && item.state !== "canceled")) return;
    this.requeue(item);
    if (item.kind === "folder") {
      // Re-enqueueing a folder restores the items its outcome carried
      // over to (design D3); items that failed on their own stay put.
      for (const dep of this.items) {
        if (dep.failedBy === item.id && (dep.state === "failed" || dep.state === "canceled")) {
          this.requeue(dep);
        }
      }
    }
    this.emit();
    this.dispatch();
  }

  reset(): void {
    this.controller?.abort();
    this.items = [];
    this.paused = false;
    this.runningId = null;
    this.controller = null;
    this.emit();
  }

  private requeue(item: UploadItem): void {
    item.state = this.paused ? "paused" : "queued";
    item.loaded = 0;
    item.error = null;
    item.attempts = 0;
    item.failedBy = null;
  }

  private dispatch(): void {
    if (this.paused || this.runningId) return;
    const next = this.items.find((it) => it.state === "queued");
    if (!next) return;
    void this.run(next);
  }

  private async run(item: UploadItem): Promise<void> {
    this.runningId = item.id;
    item.state = "running";
    this.controller = new AbortController();
    this.emit();

    try {
      if (item.kind === "folder") {
        await this.mkdir(item.vdirId, item.path);
        // A cancel during the (non-abortable) mkdir already recorded the
        // outcome; the late success must not overwrite it.
        if (item.state === "running") {
          item.state = "completed";
          item.error = null;
          this.settle(item);
        }
      } else {
        const result = await this.upload(item.vdirId, item.path, item.file!, {
          signal: this.controller.signal,
          onProgress: (loaded, total) => {
            item.loaded = loaded;
            if (total) item.total = total;
            this.emit();
          },
        });
        item.state = "completed";
        item.loaded = result.size;
        if (result.size) item.total = result.size;
        item.error = null;
        this.settle(item);
      }
    } catch (err) {
      if (item.state !== "running") {
        // Canceled while running; the outcome is already recorded.
      } else if (err instanceof UploadCanceled) {
        item.state = "canceled";
        item.error = null;
        this.settle(item);
      } else {
        const failure = err instanceof ApiFailure ? err : null;
        item.attempts += 1;
        if (failure?.kind === "retryable" && item.attempts < MAX_ATTEMPTS) {
          item.state = this.paused ? "paused" : "queued";
        } else {
          item.state = "failed";
          item.error = failure
            ? failure.message
            : err instanceof Error
              ? err.message
              : "Upload failed";
          this.cascade(item, "failed");
          this.settle(item);
        }
      }
    } finally {
      this.runningId = null;
      this.controller = null;
      this.emit();
      this.dispatch();
    }
  }

  // cascade moves a folder item's not-yet-started dependents to the
  // folder's terminal state, recording failedBy so retrying the folder
  // restores them.
  private cascade(folder: UploadItem, state: "canceled" | "failed"): void {
    if (folder.kind !== "folder") return;
    for (const dep of this.items) {
      if (dep.id === folder.id || !isUnder(dep.path, folder.path)) continue;
      if (dep.state !== "queued" && dep.state !== "paused") continue;
      dep.state = state;
      dep.error = state === "failed" ? folder.error : null;
      dep.loaded = 0;
      dep.failedBy = folder.id;
      this.settle(dep);
    }
  }

  private settle(item: UploadItem): void {
    if (this.settledListeners.size === 0) return;
    const snapshot = { ...item };
    for (const listener of this.settledListeners) listener(snapshot);
  }

  private find(id: string): UploadItem | undefined {
    return this.items.find((it) => it.id === id);
  }

  private emit(): void {
    this.snapshot = {
      items: this.items.map((it) => ({ ...it })),
      paused: this.paused,
      runningId: this.runningId,
    };
    for (const listener of this.listeners) listener();
  }
}

function isActive(state: UploadState): boolean {
  return state === "queued" || state === "running" || state === "paused";
}

export const uploadQueue = new UploadQueue();
