// In-app upload manager (upload-queue spec, design D2/D6): a
// framework-free queue singleton that keeps uploading while the user
// navigates. React binds through useUploadQueue; tests drive it with an
// injected upload function.

import {
  ApiFailure,
  UploadCanceled,
  uploadFile,
  type UploadOptions,
  type UploadResult,
} from "./filesApi";

export type UploadState = "queued" | "running" | "paused" | "completed" | "canceled" | "failed";

export type UploadItem = {
  id: string;
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
  file: File | Blob;
};

export type UploadFn = (
  vdirId: string,
  path: string,
  file: File | Blob,
  options: UploadOptions,
) => Promise<UploadResult>;

export type QueueSnapshot = {
  items: UploadItem[];
  paused: boolean;
  runningId: string | null;
};

// Initial attempt plus up to two automatic retries for retryable
// failures (design D6) — a bounded budget, never a retry storm.
const MAX_ATTEMPTS = 3;

// normalizeTarget keys a target for dedupe: the vdir id plus the
// slash-normalized virtual path.
export function normalizeTarget(vdirId: string, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
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
  private snapshot: QueueSnapshot = { items: [], paused: false, runningId: null };
  private readonly upload: UploadFn;

  constructor(upload: UploadFn = uploadFile) {
    this.upload = upload;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): QueueSnapshot => this.snapshot;

  enqueue(vdirId: string, dir: string, files: Array<File | Blob>): void {
    let changed = false;
    for (const file of files) {
      const name = fileName(file);
      const path = dir ? `${dir}/${name}` : name;
      const key = normalizeTarget(vdirId, path);
      const alreadyActive = this.items.some(
        (it) => normalizeTarget(it.vdirId, it.path) === key && isActive(it.state),
      );
      if (alreadyActive) continue;
      this.items.push({
        id: `u${(seq += 1)}`,
        vdirId,
        dir,
        name,
        path,
        size: file.size,
        state: this.paused ? "paused" : "queued",
        loaded: 0,
        total: file.size,
        attempts: 0,
        error: null,
        file,
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
      // The abort rejection flips the state to canceled.
      this.controller?.abort();
      return;
    }
    if (item.state === "queued" || item.state === "paused") {
      item.state = "canceled";
      this.emit();
    }
  }

  retry(id: string): void {
    const item = this.find(id);
    if (!item || (item.state !== "failed" && item.state !== "canceled")) return;
    item.state = this.paused ? "paused" : "queued";
    item.loaded = 0;
    item.error = null;
    item.attempts = 0;
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
      const result = await this.upload(item.vdirId, item.path, item.file, {
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
    } catch (err) {
      if (err instanceof UploadCanceled) {
        item.state = "canceled";
        item.error = null;
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
        }
      }
    } finally {
      this.runningId = null;
      this.controller = null;
      this.emit();
      this.dispatch();
    }
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
