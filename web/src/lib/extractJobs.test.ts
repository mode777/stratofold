import { describe, expect, it, vi } from "vitest";
import type { ExtractJobJson } from "./filesApi";
import {
  ExtractTracker,
  percentOf,
  skipLabel,
  skipNames,
  skipSummary,
  type ExtractApi,
} from "./extractJobs";

function job(over: Partial<ExtractJobJson> = {}): ExtractJobJson {
  return {
    id: "j1",
    state: "running",
    phase: "extracting",
    path: "docs/photos.zip",
    target: "docs/photos",
    skipped: 0,
    entriesTotal: 4,
    entriesDone: 1,
    bytesTotal: 100,
    bytesDone: 25,
    startedAt: "2026-11-15T10:00:00Z",
    ...over,
  };
}

function fakeApi(): ExtractApi & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { start: [], get: [], cancel: [] };
  const api: ExtractApi = {
    start: vi.fn(async (vdirId: string, path: string, name?: string) => {
      calls.start.push([vdirId, path, name]);
      return job();
    }),
    get: vi.fn(async (vdirId: string, id: string) => {
      calls.get.push([vdirId, id]);
      return job({ state: "succeeded", entriesDone: 4, bytesDone: 100 });
    }),
    cancel: vi.fn(async (vdirId: string, id: string) => {
      calls.cancel.push([vdirId, id]);
      return job({ state: "canceled" });
    }),
  };
  return Object.assign(api, { calls });
}

describe("ExtractTracker", () => {
  it("starts a job and tracks it with its vdir", async () => {
    const api = fakeApi();
    const tracker = new ExtractTracker(api, 1e9);
    const started = await tracker.start("v1", "docs/photos.zip");

    expect(api.calls.start).toEqual([["v1", "docs/photos.zip", undefined]]);
    expect(started.vdirId).toBe("v1");
    expect(tracker.getSnapshot().jobs).toHaveLength(1);
    expect(tracker.getSnapshot().jobs[0].state).toBe("running");
  });

  it("passes an explicit folder name through", async () => {
    const api = fakeApi();
    const tracker = new ExtractTracker(api, 1e9);
    await tracker.start("v1", "docs/photos.zip", "photos 2");
    expect(api.calls.start).toEqual([["v1", "docs/photos.zip", "photos 2"]]);
  });

  it("settles on success and notifies settled listeners", async () => {
    const api = fakeApi();
    const tracker = new ExtractTracker(api, 1e9);
    const settled = vi.fn();
    tracker.onSettled(settled);
    const started = await tracker.start("v1", "docs/photos.zip");

    await tracker.tick(started.id);

    const current = tracker.getSnapshot().jobs[0];
    expect(current.state).toBe("succeeded");
    expect(current.entriesDone).toBe(4);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ id: started.id, state: "succeeded" }));
  });

  it("keeps a job running when a poll fails transiently", async () => {
    const api = fakeApi();
    api.get = vi.fn(async () => {
      throw new Error("network");
    });
    const tracker = new ExtractTracker(api, 1e9);
    const started = await tracker.start("v1", "docs/photos.zip");

    await tracker.tick(started.id);
    expect(tracker.getSnapshot().jobs[0].state).toBe("running");
  });

  it("cancels through the api and applies the terminal state", async () => {
    const api = fakeApi();
    const tracker = new ExtractTracker(api, 1e9);
    const started = await tracker.start("v1", "docs/photos.zip");

    await tracker.cancel(started.id);

    expect(api.calls.cancel).toEqual([["v1", started.id]]);
    expect(tracker.getSnapshot().jobs[0].state).toBe("canceled");
  });

  it("replaces rather than duplicates a job id", async () => {
    const api = fakeApi();
    const tracker = new ExtractTracker(api, 1e9);
    const started = await tracker.start("v1", "docs/photos.zip");
    await tracker.tick(started.id);
    expect(tracker.getSnapshot().jobs.filter((j) => j.id === started.id)).toHaveLength(1);
  });
});

describe("percentOf", () => {
  const tracked = (over: Partial<ExtractJobJson> = {}) => ({ ...job(), vdirId: "v1", ...over });

  it("prefers entries and falls back to bytes", () => {
    expect(percentOf(tracked({ entriesTotal: 4, entriesDone: 1, bytesTotal: 100, bytesDone: 50 }))).toBe(25);
    expect(percentOf(tracked({ entriesTotal: 0, entriesDone: 0, bytesTotal: 100, bytesDone: 50 }))).toBe(50);
    expect(percentOf(tracked({ entriesTotal: 0, bytesTotal: 0 }))).toBe(0);
    expect(percentOf(tracked({ state: "succeeded" }))).toBe(100);
  });
});

describe("skip reporting", () => {
  it("renders the split between invalid and metadata skips", () => {
    expect(skipSummary(job())).toBe("");
    expect(skipSummary(job({ skipped: 2 }))).toBe("2 skipped (metadata)");
    expect(skipSummary(job({ skippedInvalid: 1 }))).toBe("1 skipped (invalid)");
    expect(skipSummary(job({ skipped: 2, skippedInvalid: 1 }))).toBe("3 skipped: 1 invalid, 2 metadata");
  });

  it("labels the closed reason vocabulary and passes unknowns through", () => {
    expect(skipLabel("unsafe-name")).toBe("unsafe");
    expect(skipLabel("depth")).toBe("too deep");
    expect(skipLabel("symlink")).toBe("link");
    expect(skipLabel("encrypted")).toBe("encrypted");
    expect(skipLabel("unsupported-compression")).toBe("unsupported");
    expect(skipLabel("corrupt")).toBe("corrupt");
    expect(skipLabel("made-up")).toBe("made-up");
  });

  it("names the bounded sample with reasons and an overflow marker", () => {
    expect(skipNames(job())).toBe("");
    expect(
      skipNames(
        job({
          skippedInvalid: 2,
          skippedDetails: [
            { name: "../escape.txt", reason: "unsafe-name" },
            { name: "secret.txt", reason: "encrypted" },
          ],
        }),
      ),
    ).toBe("../escape.txt (unsafe), secret.txt (encrypted)");
    expect(
      skipNames(
        job({
          skippedInvalid: 5,
          skippedDetails: [
            { name: "a", reason: "corrupt" },
            { name: "b", reason: "corrupt" },
            { name: "c", reason: "corrupt" },
            { name: "d", reason: "corrupt" },
          ],
        }),
      ),
    ).toBe("a (corrupt), b (corrupt), c (corrupt), +2 more");
  });
});
