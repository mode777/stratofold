// Archive-extraction job tracker (archive-extraction spec, design D12):
// a framework-free singleton that starts a job, polls it, keeps it across
// navigation, and tells the browse view when a folder appeared. It mirrors
// the upload queue's shape (lib/uploadQueue.ts) rather than putting job
// state inside a page, because the job outlives the view that started it.

import {
  cancelExtract,
  getExtract,
  startExtract,
  type ExtractJobJson,
} from "./filesApi";

export type ExtractJob = ExtractJobJson & { vdirId: string };

export type ExtractSnapshot = { jobs: ExtractJob[] };

export type ExtractApi = {
  start(vdirId: string, path: string, name?: string): Promise<ExtractJobJson>;
  get(vdirId: string, jobId: string): Promise<ExtractJobJson>;
  cancel(vdirId: string, jobId: string): Promise<ExtractJobJson>;
};

const defaultApi: ExtractApi = {
  start: startExtract,
  get: getExtract,
  cancel: cancelExtract,
};

// pollInterval is how often a running job is observed. The server owns
// the counters; polling is cheap and the UI needs no websocket.
export const pollInterval = 750;

let seq = 0;

export function isActive(job: ExtractJob): boolean {
  return job.state === "running";
}

// percentOf turns a job's counters into a bounded percentage: entries are
// the unit a user understands, declared bytes are only a hint.
export function percentOf(job: ExtractJob): number {
  if (job.state === "succeeded") return 100;
  if (job.entriesTotal > 0) {
    return Math.min(100, Math.round((job.entriesDone / job.entriesTotal) * 100));
  }
  if (job.bytesTotal > 0) {
    return Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100));
  }
  return 0;
}

export class ExtractTracker {
  private jobs: ExtractJob[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private settledListeners = new Set<(job: ExtractJob) => void>();
  private snapshot: ExtractSnapshot = { jobs: [] };
  private readonly api: ExtractApi;
  private readonly interval: number;

  constructor(api: ExtractApi = defaultApi, interval: number = pollInterval) {
    this.api = api;
    this.interval = interval;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ExtractSnapshot => this.snapshot;

  // onSettled notifies a subscriber when a job reaches a terminal state,
  // which is how the browse view refreshes after the folder appears.
  onSettled(listener: (job: ExtractJob) => void): () => void {
    this.settledListeners.add(listener);
    return () => {
      this.settledListeners.delete(listener);
    };
  }

  // start asks the server to extract and tracks the accepted job. A
  // rejected request (409 collision, 403, 503) throws the ApiFailure so
  // the caller can render the established error states.
  async start(vdirId: string, path: string, name?: string): Promise<ExtractJob> {
    const job = await this.api.start(vdirId, path, name);
    const tracked: ExtractJob = { ...job, vdirId };
    this.upsert(tracked);
    this.schedule(tracked);
    return tracked;
  }

  // cancel stops a job; the server reports the terminal state.
  async cancel(id: string): Promise<void> {
    const job = this.find(id);
    if (!job) return;
    const updated = await this.api.cancel(job.vdirId, id);
    this.apply({ ...updated, vdirId: job.vdirId });
  }

  // tick observes one job once. Polling calls it; tests drive it directly.
  async tick(id: string): Promise<void> {
    const job = this.find(id);
    if (!job || !isActive(job)) return;
    try {
      const updated = await this.api.get(job.vdirId, id);
      this.apply({ ...updated, vdirId: job.vdirId });
    } catch {
      // A transient poll failure leaves the job running and tries again;
      // the server's own state is the authority.
      this.schedule(job);
    }
  }

  private schedule(job: ExtractJob): void {
    if (this.timers.has(job.id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(job.id);
      void this.tick(job.id);
    }, this.interval);
    this.timers.set(job.id, timer);
  }

  private apply(job: ExtractJob): void {
    this.upsert(job);
    if (isActive(job)) {
      this.schedule(job);
      return;
    }
    const timer = this.timers.get(job.id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(job.id);
    }
    for (const listener of this.settledListeners) listener(job);
  }

  private upsert(job: ExtractJob): void {
    const idx = this.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) this.jobs[idx] = job;
    else this.jobs.unshift({ ...job, id: job.id || `x${(seq += 1)}` });
    this.emit();
  }

  private find(id: string): ExtractJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  private emit(): void {
    this.snapshot = { jobs: [...this.jobs] };
    for (const listener of this.listeners) listener();
  }
}

export const extractJobs = new ExtractTracker();
