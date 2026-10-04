import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiFailure } from "../lib/filesApi";
import { UploadQueue, type UploadFn } from "../lib/uploadQueue";
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
});
