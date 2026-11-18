import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, mv, rm } from "./filesApi";
import { BULK_CONCURRENCY, bulkDelete, bulkMove, type BulkItem } from "./bulkOps";

vi.mock("./filesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./filesApi")>();
  return { ...actual, mv: vi.fn(), rm: vi.fn() };
});

const items: BulkItem[] = [
  { name: "a.txt", path: "a.txt" },
  { name: "b.txt", path: "b.txt" },
  { name: "c.txt", path: "c.txt" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(mv).mockReset();
  vi.mocked(rm).mockReset();
});

describe("bulkDelete", () => {
  it("attempts every item and returns outcomes in input order", async () => {
    vi.mocked(rm).mockResolvedValue(undefined);

    const outcomes = await bulkDelete("v1", items);

    expect(vi.mocked(rm).mock.calls).toEqual([
      ["v1", "a.txt"],
      ["v1", "b.txt"],
      ["v1", "c.txt"],
    ]);
    expect(outcomes).toEqual(items);
  });

  it("continues after a failure and records only that item's failure", async () => {
    vi.mocked(rm).mockImplementation(async (_vdir, path) => {
      if (path === "b.txt") throw new ApiFailure("notfound", 404, "Not found.");
    });

    const outcomes = await bulkDelete("v1", items);

    expect(outcomes.map((o) => o.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(outcomes[0].failure).toBeUndefined();
    expect(outcomes[1].failure?.kind).toBe("notfound");
    expect(outcomes[2].failure).toBeUndefined();
    expect(vi.mocked(rm).mock.calls).toHaveLength(3);
  });

  it("keeps input order even when requests settle out of order", async () => {
    const pending = new Map(items.map((item) => [item.path, deferred<never>()]));
    vi.mocked(rm).mockImplementation((_vdir, path) => pending.get(path)!.promise);

    const running = bulkDelete("v1", items);
    pending.get("c.txt")!.resolve(undefined as never);
    pending.get("a.txt")!.resolve(undefined as never);
    pending.get("b.txt")!.resolve(undefined as never);

    await expect(running).resolves.toEqual(items);
  });

  it("bounds in-flight requests and starts the next when one settles", async () => {
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    let active = 0;
    let maxActive = 0;
    vi.mocked(rm).mockImplementation(() => {
      const next = deferred<void>();
      pending.push(next);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return next.promise.finally(() => {
        active -= 1;
      });
    });

    const many = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, path: `f${i}` }));
    const running = bulkDelete("v1", many);

    expect(vi.mocked(rm)).toHaveBeenCalledTimes(BULK_CONCURRENCY);
    expect(maxActive).toBe(BULK_CONCURRENCY);

    pending.shift()!.resolve();
    await vi.waitFor(() => expect(vi.mocked(rm)).toHaveBeenCalledTimes(BULK_CONCURRENCY + 1));

    while (pending.length > 0) {
      pending.shift()!.resolve();
      await Promise.resolve();
    }
    await running;
    expect(maxActive).toBe(BULK_CONCURRENCY);
  });

  it("reports progress after each settle", async () => {
    vi.mocked(rm).mockResolvedValue(undefined);
    const progress: Array<[number, number]> = [];

    await bulkDelete("v1", items, { onProgress: (processed, total) => progress.push([processed, total]) });

    expect(progress).toHaveLength(3);
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it("maps 503, 403, and 404 to their deterministic failure classes", async () => {
    vi.mocked(rm).mockImplementation(async (_vdir, path) => {
      if (path === "a.txt") throw new ApiFailure("retryable", 503, "busy");
      if (path === "b.txt") throw new ApiFailure("forbidden", 403, "denied");
      throw new ApiFailure("notfound", 404, "gone");
    });

    const outcomes = await bulkDelete("v1", items);

    expect(outcomes.map((o) => o.failure?.kind)).toEqual(["retryable", "forbidden", "notfound"]);
  });

  it("stops scheduling new items after a 401", async () => {
    vi.mocked(rm).mockRejectedValue(new ApiFailure("unauthorized", 401, "Signed out."));

    const many = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, path: `f${i}` }));
    const outcomes = await bulkDelete("v1", many);

    expect(vi.mocked(rm)).toHaveBeenCalledTimes(BULK_CONCURRENCY);
    expect(outcomes).toHaveLength(BULK_CONCURRENCY);
    expect(outcomes.every((o) => o.failure?.kind === "unauthorized")).toBe(true);
  });
});

describe("bulkMove", () => {
  it("moves every item into the destination folder", async () => {
    vi.mocked(mv).mockResolvedValue(undefined);

    const outcomes = await bulkMove("v1", items, "docs");

    expect(vi.mocked(mv).mock.calls).toEqual([
      ["v1", "a.txt", "docs/a.txt"],
      ["v1", "b.txt", "docs/b.txt"],
      ["v1", "c.txt", "docs/c.txt"],
    ]);
    expect(outcomes).toEqual(items);
  });
});
