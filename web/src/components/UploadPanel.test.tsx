import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../lib/filesApi";
import { UploadQueue, type MkdirFn, type UploadFn } from "../lib/uploadQueue";
import { ExtractTracker, type ExtractApi } from "../lib/extractJobs";
import { UploadPanel } from "./UploadPanel";

type Call = {
  options: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal };
  resolve: (result: { path: string; size: number }) => void;
  reject: (err: unknown) => void;
};

function fakeUpload() {
  const calls: Call[] = [];
  const fn: UploadFn = (_vdirId, _path, _file, options) =>
    new Promise((resolve, reject) => {
      calls.push({ options, resolve, reject });
    });
  return { fn, calls };
}

function fakeMkdir() {
  const calls: Array<{ path: string; resolve: () => void; reject: (err: unknown) => void }> = [];
  const fn: MkdirFn = (_vdirId, path) =>
    new Promise((resolve, reject) => {
      calls.push({ path, resolve: () => resolve(), reject });
    });
  return { fn, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe("UploadPanel", () => {
  it("shows an empty state and then reflects queue changes", () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    render(<UploadPanel queue={queue} />);
    expect(screen.getByTestId("upload-empty")).toBeInTheDocument();

    act(() => queue.enqueue("v1", "", [file("a.txt")]));
    expect(screen.getByTestId("upload-item")).toBeInTheDocument();
    expect(screen.getByTestId("upload-name")).toHaveTextContent("a.txt");
    expect(screen.getByTestId("upload-state")).toHaveTextContent("Uploading");
  });

  it("reports progress", () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    render(<UploadPanel queue={queue} />);
    act(() => queue.enqueue("v1", "", [file("a.txt", 100)]));
    act(() => calls[0].options.onProgress?.(50, 100));
    expect(screen.getByTestId("upload-progress")).toHaveAttribute("value", "50");
  });

  it("pauses and resumes the queue from the panel", async () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    render(<UploadPanel queue={queue} />);
    act(() => queue.enqueue("v1", "", [file("a.txt"), file("b.txt")]));

    await userEvent.setup().click(screen.getByTestId("queue-toggle"));
    expect(queue.getSnapshot().paused).toBe(true);
    expect(screen.getByTestId("queue-toggle")).toHaveTextContent("Resume");

    await userEvent.setup().click(screen.getByTestId("queue-toggle"));
    expect(queue.getSnapshot().paused).toBe(false);
  });

  it("cancels a running upload from the panel", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    render(<UploadPanel queue={queue} />);
    act(() => queue.enqueue("v1", "", [file("a.txt")]));

    await userEvent.setup().click(screen.getByTestId("upload-cancel"));
    expect(calls[0].options.signal?.aborted).toBe(true);
  });

  it("retries a failed upload from the panel", async () => {
    const { fn, calls } = fakeUpload();
    const queue = new UploadQueue(fn);
    render(<UploadPanel queue={queue} />);
    act(() => queue.enqueue("v1", "", [file("a.txt")]));
    act(() => calls[0].reject(new ApiFailure("forbidden", 403, "nope")));
    await act(async () => {
      await tick();
    });
    expect(screen.getByTestId("upload-error")).toHaveTextContent("nope");

    await userEvent.setup().click(screen.getByTestId("upload-retry"));
    expect(calls).toHaveLength(2);
  });

  it("renders a running folder item without byte progress", () => {
    const { fn } = fakeUpload();
    const { fn: mkdir } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    render(<UploadPanel queue={queue} />);
    act(() => queue.enqueueEntries("v1", [{ kind: "folder", path: "docs/photos" }]));

    const item = screen.getByTestId("upload-item");
    expect(item).toHaveAttribute("data-kind", "folder");
    expect(screen.getByTestId("upload-name")).toHaveTextContent("photos");
    expect(screen.getByTestId("upload-state")).toHaveTextContent("Creating folder");
    expect(screen.queryByTestId("upload-progress")).not.toBeInTheDocument();
  });

  it("surfaces a failed folder item and retries it", async () => {
    const { fn } = fakeUpload();
    const { fn: mkdir, calls: dirs } = fakeMkdir();
    const queue = new UploadQueue(fn, mkdir);
    render(<UploadPanel queue={queue} />);
    act(() => queue.enqueueEntries("v1", [{ kind: "folder", path: "docs/photos" }]));

    act(() => dirs[0].reject(new ApiFailure("forbidden", 403, "nope")));
    await act(async () => {
      await tick();
    });
    expect(screen.getByTestId("upload-state")).toHaveTextContent("Failed");
    expect(screen.getByTestId("upload-error")).toHaveTextContent("nope");

    await userEvent.setup().click(screen.getByTestId("upload-retry"));
    expect(dirs).toHaveLength(2);
  });

  it("lists archive extractions with progress and cancel", async () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    // The cancel mock must return the server's terminal job: the panel
    // renders that snapshot, and an undefined response would be a
    // tracker-invalid state rather than a realistic cancellation.
    const cancel = vi.fn<ExtractApi["cancel"]>(async () => ({
      id: "j1",
      state: "canceled" as const,
      phase: "extracting" as const,
      path: "docs/photos.zip",
      target: "docs/photos",
      skipped: 2,
      entriesTotal: 4,
      entriesDone: 1,
      bytesTotal: 100,
      bytesDone: 25,
      startedAt: "2026-11-15T10:00:00Z",
      finishedAt: "2026-11-15T10:00:01Z",
    }));
    const api: ExtractApi = {
      start: vi.fn(async () => ({
        id: "j1",
        state: "running" as const,
        phase: "extracting" as const,
        path: "docs/photos.zip",
        target: "docs/photos",
        skipped: 2,
        entriesTotal: 4,
        entriesDone: 1,
        bytesTotal: 100,
        bytesDone: 25,
        startedAt: "2026-11-15T10:00:00Z",
      })),
      get: vi.fn(),
      cancel,
    };
    const tracker = new ExtractTracker(api, 1e9);
    await act(async () => {
      await tracker.start("v1", "docs/photos.zip");
    });

    render(<UploadPanel queue={queue} tracker={tracker} />);
    expect(screen.getByTestId("extract-item")).toBeInTheDocument();
    expect(screen.getByTestId("extract-name")).toHaveTextContent("photos");
    expect(screen.getByTestId("extract-state")).toHaveTextContent("Extracting · 25%");
    expect(screen.getByTestId("extract-progress")).toHaveAttribute("value", "25");

    await userEvent.setup().click(screen.getByTestId("extract-cancel"));
    expect(cancel).toHaveBeenCalledWith("v1", "j1");
  });

  it("renders the skip split on a finished extraction", async () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    const api: ExtractApi = {
      start: vi.fn(async () => ({
        id: "j2",
        state: "succeeded" as const,
        phase: "publishing" as const,
        path: "docs/mixed.zip",
        target: "docs/mixed",
        skipped: 1,
        skippedInvalid: 2,
        skippedDetails: [
          { name: "../escape.txt", reason: "unsafe-name" },
          { name: "secret.txt", reason: "encrypted" },
        ],
        entriesTotal: 3,
        entriesDone: 3,
        bytesTotal: 30,
        bytesDone: 30,
        startedAt: "2026-11-15T10:00:00Z",
        finishedAt: "2026-11-15T10:00:05Z",
      })),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    const tracker = new ExtractTracker(api, 1e9);
    await act(async () => {
      await tracker.start("v1", "docs/mixed.zip");
    });

    render(<UploadPanel queue={queue} tracker={tracker} />);
    const skips = screen.getByTestId("extract-skips");
    expect(skips).toHaveTextContent("3 skipped: 2 invalid, 1 metadata");
    expect(skips).toHaveTextContent("../escape.txt (unsafe)");
    expect(skips).toHaveTextContent("secret.txt (encrypted)");
  });

  it("renders an invalid-only skip count without a metadata part", async () => {
    const { fn } = fakeUpload();
    const queue = new UploadQueue(fn);
    const api: ExtractApi = {
      start: vi.fn(async () => ({
        id: "j3",
        state: "failed" as const,
        phase: "extracting" as const,
        path: "docs/locked.zip",
        target: "docs/locked",
        skipped: 0,
        skippedInvalid: 1,
        skippedDetails: [{ name: "secret.txt", reason: "encrypted" }],
        entriesTotal: 1,
        entriesDone: 0,
        bytesTotal: 1,
        bytesDone: 0,
        startedAt: "2026-11-15T10:00:00Z",
        finishedAt: "2026-11-15T10:00:05Z",
        error: { status: 400, message: "nothing could be extracted: every entry was skipped as encrypted" },
      })),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    const tracker = new ExtractTracker(api, 1e9);
    await act(async () => {
      await tracker.start("v1", "docs/locked.zip");
    });

    render(<UploadPanel queue={queue} tracker={tracker} />);
    const skips = screen.getByTestId("extract-skips");
    expect(skips).toHaveTextContent("1 skipped (invalid)");
    expect(screen.getByTestId("extract-state")).toHaveTextContent("nothing could be extracted");
  });
});
