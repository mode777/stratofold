import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewerPage } from "./ImageViewerPage";
import type { LsEntry } from "../lib/filesApi";
import { jsonResponse } from "../test/mockApi";

const ENTRY: LsEntry = { name: "hero.png", size: 2048, dir: false, modtime: "2026-01-02T03:04:05Z" };

function renderViewer(over: Partial<LsEntry> = {}) {
  return render(<ImageViewerPage vdirId="v1" path="photos/hero.png" entry={{ ...ENTRY, ...over }} />);
}

beforeEach(() => {
  // jsdom has no object-URL store; the stubs stay installed for the
  // whole file so effect cleanup during unmount still finds them.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:mock-url"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImageViewerPage", () => {
  it("renders the image from the /files URL with metadata and download", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderViewer();

    const frame = await screen.findByTestId("image-frame");
    expect(frame).toHaveAttribute("src", "blob:mock-url");
    expect(frame).toHaveAttribute("alt", "hero.png");
    expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Modified/)).toBeInTheDocument();

    const download = screen.getByTestId("preview-download");
    expect(download).toHaveAttribute("href", "/files/v1/photos/hero.png");
    expect(download).toHaveAttribute("download");
    expect(fetchMock.mock.calls[0][0]).toBe("/files/v1/photos/hero.png");
  });

  it("falls back to the metadata card when the image cannot be decoded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true })));
    renderViewer();

    const frame = await screen.findByTestId("image-frame");
    fireEvent.error(frame);

    // The metadata card replaces the broken frame and carries the
    // page's download action.
    expect(screen.queryByTestId("image-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-download")).toHaveAttribute("href", "/files/v1/photos/hero.png");
    expect(screen.getByText("File")).toBeInTheDocument();
  });

  it("maps a failed image request to the retryable failure state and retries", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) return jsonResponse(503, { message: "busy" });
        return jsonResponse(200, { ok: true });
      }),
    );
    renderViewer();

    expect(await screen.findByTestId("state-retryable")).toBeInTheDocument();
    expect(screen.queryByTestId("image-frame")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("action-retry"));

    await waitFor(() => expect(screen.getByTestId("image-frame")).toBeInTheDocument());
    expect(attempts).toBe(2);
  });
});
