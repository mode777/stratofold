import { describe, expect, it, vi } from "vitest";
import { ApiFailure, UploadCanceled } from "./filesApi";
import { UploadQueue, normalizeTarget, type UploadFn } from "./uploadQueue";

type Call = {
  vdirId: string;
  path: string;
  file: File | Blob;
  options: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal };
  resolve: (result: { path: string; size: number }) => void;
  reject: (err: unknown) => void;
};

function fakeUpload() {
  const calls: Call[] = [];
  const fn: UploadFn = (vdirId, path, file, options) =>
    new Promise((resolve, reject) => {
      calls.push({ vdirId, path, file, options, resolve, reject });
    });
  return { fn, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name);
}

describe("normalizeTarget", () => {
  it("strips surrounding slashes so equivalent paths dedupe", () => {
    expect(normalizeTarget("v1", "docs/a.txt")).toBe(normalizeTarget("v1", "/docs/a.txt/"));
  });
});

describe("UploadQueue scheduling", () => {
  it("dispatches in enqueue order with a single active upload", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "docs", [file("a.txt"), file("b.txt"), file("c.txt")]);

    expect(calls.map((c) => c.path)).toEqual(["docs/a.txt"]);
    calls[0].resolve({ path: "docs/a.txt", size: 10 });
    await tick();
    expect(calls.map((c) => c.path)).toEqual(["docs/a.txt", "docs/b.txt"]);
    calls[1].resolve({ path: "docs/b.txt", size: 10 });
    await tick();
    expect(calls.map((c) => c.path)).toEqual(["docs/a.txt", "docs/b.txt", "docs/c.txt"]);
  });

  it("coalesces a duplicate target that is already active", () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "docs", [file("a.txt")]);
    queue.enqueue("v1", "docs", [file("a.txt")]);
    expect(queue.getSnapshot().items).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("holds queued items while paused and continues on resume", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt"), file("b.txt")]);
    queue.pause();

    calls[0].resolve({ path: "a.txt", size: 10 });
    await tick();
    expect(calls).toHaveLength(1);
    expect(queue.getSnapshot().paused).toBe(true);
    expect(queue.getSnapshot().items[1].state).toBe("paused");

    queue.resume();
    expect(calls.map((c) => c.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("returns a stable snapshot until a change occurs", () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    const first = queue.getSnapshot();
    expect(queue.getSnapshot()).toBe(first);
    queue.pause();
    expect(queue.getSnapshot()).not.toBe(first);
  });
});

describe("UploadQueue lifecycle", () => {
  it("reports progress from the transport", () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt", 100)]);
    calls[0].options.onProgress?.(40, 100);
    expect(queue.getSnapshot().items[0]).toMatchObject({ loaded: 40, total: 100, state: "running" });
  });

  it("marks a completed item with the published size", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt", 100)]);
    calls[0].resolve({ path: "a.txt", size: 100 });
    await tick();
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: "completed", loaded: 100, error: null });
  });

  it("cancels a running upload, publishes nothing, and dispatches the next", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt"), file("b.txt")]);
    const first = queue.getSnapshot().items[0];
    queue.cancel(first.id);
    expect(calls[0].options.signal?.aborted).toBe(true);
    calls[0].reject(new UploadCanceled());
    await tick();

    expect(queue.getSnapshot().items[0].state).toBe("canceled");
    expect(calls.map((c) => c.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("cancels a queued upload without starting it", () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt"), file("b.txt")]);
    queue.cancel(queue.getSnapshot().items[1].id);
    expect(queue.getSnapshot().items[1].state).toBe("canceled");
    expect(calls.map((c) => c.path)).toEqual(["a.txt"]);
  });

  it("auto-retries a retryable failure a bounded number of times", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt")]);
    for (let i = 0; i < 3; i += 1) {
      calls[i].reject(new ApiFailure("retryable", 0, "network"));
      await tick();
    }
    expect(calls).toHaveLength(3);
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: "failed", error: "network" });
  });

  it("fails permanently without retrying a forbidden response", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt")]);
    calls[0].reject(new ApiFailure("forbidden", 403, "nope"));
    await tick();
    expect(calls).toHaveLength(1);
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: "failed", error: "nope" });
  });

  it("restarts from byte zero when a failed upload is re-enqueued", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueue("v1", "", [file("a.txt")]);
    calls[0].options.onProgress?.(50, 100);
    calls[0].reject(new ApiFailure("forbidden", 403, "nope"));
    await tick();

    queue.retry(queue.getSnapshot().items[0].id);
    expect(calls).toHaveLength(2);
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: "running", loaded: 0, error: null });
  });
});

describe("UploadQueue subscription", () => {
  it("notifies subscribers and stops after unsubscribe", () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.pause();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    queue.resume();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
