import { describe, expect, it, vi } from "vitest";
import { ApiFailure, UploadCanceled } from "./filesApi";
import {
  UploadQueue,
  normalizeTarget,
  type MkdirFn,
  type QueueEntry,
  type UploadFn,
  type UploadItem,
} from "./uploadQueue";

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

type MkdirCall = {
  vdirId: string;
  path: string;
  resolve: () => void;
  reject: (err: unknown) => void;
};

function fakeMkdir() {
  const calls: MkdirCall[] = [];
  const fn: MkdirFn = (vdirId, path) =>
    new Promise((resolve, reject) => {
      calls.push({ vdirId, path, resolve: () => resolve(), reject });
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

describe("UploadQueue subdirectory targets", () => {
  it("uploads to an explicit full target path and reports it", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    queue.enqueueEntries("v1", [
      { kind: "upload", path: "docs/photos/sub/a.jpg", file: file("a.jpg") },
    ]);

    expect(calls.map((c) => c.path)).toEqual(["docs/photos/sub/a.jpg"]);
    calls[0].resolve({ path: "docs/photos/sub/a.jpg", size: 10 });
    await tick();
    expect(queue.getSnapshot().items[0]).toMatchObject({
      kind: "upload",
      path: "docs/photos/sub/a.jpg",
      dir: "docs/photos/sub",
      name: "a.jpg",
      state: "completed",
    });
  });

  it("dedupes on the full normalized target path", () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    const entry: QueueEntry = { kind: "upload", path: "docs/photos/a.jpg", file: file("a.jpg") };
    queue.enqueueEntries("v1", [entry]);
    queue.enqueueEntries("v1", [{ ...entry, path: "/docs/photos/a.jpg/" }]);
    expect(queue.getSnapshot().items).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe("UploadQueue folder items", () => {
  it("creates the folder before the files inside it (FIFO)", async () => {
    const { fn, calls } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "folder", path: "docs/photos/sub" },
      { kind: "upload", path: "docs/photos/sub/a.jpg", file: file("a.jpg") },
      { kind: "upload", path: "docs/photos/b.jpg", file: file("b.jpg") },
    ]);

    expect(dirs.map((c) => c.path)).toEqual(["docs/photos"]);
    expect(calls).toHaveLength(0);
    dirs[0].resolve();
    await tick();
    expect(dirs.map((c) => c.path)).toEqual(["docs/photos", "docs/photos/sub"]);
    expect(calls).toHaveLength(0);
    dirs[1].resolve();
    await tick();
    expect(calls.map((c) => c.path)).toEqual(["docs/photos/sub/a.jpg"]);
  });

  it("still creates an empty folder and reports no byte progress", async () => {
    const { fn } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    queue.enqueueEntries("v1", [{ kind: "folder", path: "docs/empty" }]);

    expect(queue.getSnapshot().items[0]).toMatchObject({
      kind: "folder",
      state: "running",
      total: 0,
      loaded: 0,
    });
    dirs[0].resolve();
    await tick();
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: "completed", error: null });
  });

  it("retries a retryable folder failure within the bounded budget", async () => {
    const { fn } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    queue.enqueueEntries("v1", [{ kind: "folder", path: "docs/x" }]);
    for (let i = 0; i < 3; i += 1) {
      dirs[i].reject(new ApiFailure("retryable", 0, "network"));
      await tick();
    }
    expect(dirs).toHaveLength(3);
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: "failed", error: "network" });
  });

  it("dedupes folder items by target as well", () => {
    const { fn } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "folder", path: "/docs/photos/" },
    ]);
    expect(queue.getSnapshot().items).toHaveLength(1);
    expect(dirs).toHaveLength(1);
  });
});

describe("UploadQueue folder cascade", () => {
  function cascadeQueue() {
    const upload = fakeUpload();
    const mkdir = fakeMkdir();
    const queue = new UploadQueue(upload.fn, mkdir.fn);
    return { queue, upload, mkdir };
  }

  it("carries a terminal folder failure to its pending dependents only", async () => {
    const { queue, upload, mkdir } = cascadeQueue();
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "folder", path: "docs/photos/sub" },
      { kind: "upload", path: "docs/photos/sub/a.jpg", file: file("a.jpg") },
      { kind: "upload", path: "docs/photos/b.jpg", file: file("b.jpg") },
      { kind: "upload", path: "docs/other.txt", file: file("other.txt") },
    ]);

    mkdir.calls[0].reject(new ApiFailure("forbidden", 403, "nope"));
    await tick();

    const [folder, sub, a, b, other] = queue.getSnapshot().items;
    expect(folder).toMatchObject({ state: "failed", error: "nope" });
    expect(sub).toMatchObject({ state: "failed", error: "nope", failedBy: folder.id });
    expect(a).toMatchObject({ state: "failed", error: "nope", failedBy: folder.id });
    expect(b).toMatchObject({ state: "failed", error: "nope", failedBy: folder.id });
    // The unrelated item still runs.
    expect(other.state).toBe("running");
    expect(upload.calls.map((c) => c.path)).toEqual(["docs/other.txt"]);
  });

  it("cancels a queued folder's pending dependents without starting them", () => {
    const { queue, upload, mkdir } = cascadeQueue();
    queue.pause();
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "upload", path: "docs/photos/a.jpg", file: file("a.jpg") },
      { kind: "upload", path: "docs/keep.txt", file: file("keep.txt") },
    ]);
    const folder = queue.getSnapshot().items[0];
    queue.cancel(folder.id);

    const [canceledFolder, a, keep] = queue.getSnapshot().items;
    expect(canceledFolder).toMatchObject({ state: "canceled" });
    expect(a).toMatchObject({ state: "canceled", error: null, failedBy: folder.id });
    expect(keep.state).toBe("paused");
    expect(mkdir.calls).toHaveLength(0);
    expect(upload.calls).toHaveLength(0);
  });

  it("cancels a running folder item and ignores the late mkdir result", async () => {
    const { queue, upload, mkdir } = cascadeQueue();
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "upload", path: "docs/photos/a.jpg", file: file("a.jpg") },
    ]);
    const folder = queue.getSnapshot().items[0];
    queue.cancel(folder.id);
    expect(queue.getSnapshot().items[0].state).toBe("canceled");
    expect(queue.getSnapshot().items[1].state).toBe("canceled");

    mkdir.calls[0].resolve();
    await tick();
    expect(queue.getSnapshot().items[0].state).toBe("canceled");
    expect(upload.calls).toHaveLength(0);
  });

  it("restores carried failures on folder retry and leaves own failures alone", async () => {
    const { queue, upload, mkdir } = cascadeQueue();
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "upload", path: "docs/photos/a.jpg", file: file("a.jpg") },
      { kind: "upload", path: "docs/own.txt", file: file("own.txt") },
    ]);
    mkdir.calls[0].reject(new ApiFailure("forbidden", 403, "nope"));
    await tick();
    // docs/own.txt starts after the cascade and fails on its own.
    upload.calls[0].reject(new ApiFailure("forbidden", 403, "denied"));
    await tick();

    const folder = queue.getSnapshot().items[0];
    const own = queue.getSnapshot().items[2];
    expect(own).toMatchObject({ state: "failed", error: "denied", failedBy: null });

    queue.retry(folder.id);
    const [, a] = queue.getSnapshot().items;
    expect(queue.getSnapshot().items[0].state).toBe("running");
    expect(a.state).toBe("queued");
    expect(own.state).toBe("failed");
    expect(own.error).toBe("denied");

    mkdir.calls[1].resolve();
    await tick();
    expect(upload.calls.map((c) => c.path)).toEqual(["docs/own.txt", "docs/photos/a.jpg"]);
  });
});

describe("UploadQueue settled notifications", () => {
  it("reports completed uploads and folder items", async () => {
    const { fn, calls } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    const seen: UploadItem[] = [];
    queue.onSettled((item) => seen.push(item));

    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "upload", path: "docs/photos/a.jpg", file: file("a.jpg") },
    ]);
    dirs[0].resolve();
    await tick();
    calls[0].resolve({ path: "docs/photos/a.jpg", size: 10 });
    await tick();
    expect(seen.map((it) => [it.kind, it.state])).toEqual([
      ["folder", "completed"],
      ["upload", "completed"],
    ]);
  });

  it("reports a canceled queued upload", () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    const seen: UploadItem[] = [];
    queue.onSettled((item) => seen.push(item));
    queue.pause();
    queue.enqueue("v1", "", [file("a.txt")]);
    queue.cancel(queue.getSnapshot().items[0].id);
    expect(seen.map((it) => [it.kind, it.state])).toEqual([["upload", "canceled"]]);
  });

  it("carries the folder's failure to the settled dependents", async () => {
    const { fn } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    const seen: UploadItem[] = [];
    queue.onSettled((item) => seen.push(item));
    queue.enqueueEntries("v1", [
      { kind: "folder", path: "docs/photos" },
      { kind: "upload", path: "docs/photos/a.jpg", file: file("a.jpg") },
    ]);
    dirs[0].reject(new ApiFailure("forbidden", 403, "nope"));
    await tick();
    expect(seen.map((it) => [it.kind, it.state, it.error])).toEqual([
      ["upload", "failed", "nope"],
      ["folder", "failed", "nope"],
    ]);
  });

  it("stops notifying after unsubscribe", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    const listener = vi.fn();
    const off = queue.onSettled(listener);
    queue.enqueue("v1", "", [file("a.txt")]);
    calls[0].resolve({ path: "a.txt", size: 10 });
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    queue.enqueue("v1", "", [file("b.txt")]);
    calls[1].resolve({ path: "b.txt", size: 10 });
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
