import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExtractSheet, derivedFolderName, nextFreeName } from "./FileOpsDialogs";
import { ApiFailure, type LsEntry } from "../lib/filesApi";
import { ExtractTracker, type ExtractApi } from "../lib/extractJobs";

function entry(name: string): LsEntry {
  return { name, size: 1024, dir: false, modtime: "2026-11-15T10:00:00Z" };
}

function fakeApi() {
  const start = vi.fn<ExtractApi["start"]>();
  const api: ExtractApi = {
    start,
    get: vi.fn(),
    cancel: vi.fn(),
  };
  return { api, start };
}

function runningJob() {
  return {
    id: "j1",
    state: "running" as const,
    phase: "scanning" as const,
    path: "docs/photos.zip",
    target: "docs/photos",
    skipped: 0,
    entriesTotal: 0,
    entriesDone: 0,
    bytesTotal: 0,
    bytesDone: 0,
    startedAt: "2026-11-15T10:00:00Z",
  };
}

function renderSheet(tracker: ExtractTracker, onStarted = vi.fn(), onClose = vi.fn()) {
  render(
    <ExtractSheet
      vdirId="v1"
      entry={entry("photos.zip")}
      path="docs/photos.zip"
      onClose={onClose}
      onStarted={onStarted}
      tracker={tracker}
    />,
  );
  return { onStarted, onClose };
}

describe("ExtractSheet", () => {
  it("prefills the derived folder name and starts with no override", async () => {
    const { api, start } = fakeApi();
    start.mockResolvedValue(runningJob());
    const tracker = new ExtractTracker(api, 1e9);
    const { onStarted } = renderSheet(tracker);

    expect(screen.getByTestId("extract-name")).toHaveValue("photos");
    await userEvent.setup().click(screen.getByTestId("extract-submit"));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(start).toHaveBeenCalledWith("v1", "docs/photos.zip", undefined);
  });

  it("sends an edited folder name as the override", async () => {
    const { api, start } = fakeApi();
    start.mockResolvedValue({ ...runningJob(), target: "docs/holiday" });
    const tracker = new ExtractTracker(api, 1e9);
    renderSheet(tracker);

    const field = screen.getByTestId("extract-name");
    await userEvent.setup().clear(field);
    await userEvent.setup().type(field, "holiday");
    await userEvent.setup().click(screen.getByTestId("extract-submit"));

    await waitFor(() => expect(start).toHaveBeenCalledWith("v1", "docs/photos.zip", "holiday"));
  });

  it("turns a 409 into an alternative name and retries with it", async () => {
    const { api, start } = fakeApi();
    start.mockRejectedValueOnce(new ApiFailure("rejected", 409, "Conflict"));
    start.mockResolvedValueOnce({ ...runningJob(), target: "docs/photos 2" });
    const tracker = new ExtractTracker(api, 1e9);
    const { onStarted } = renderSheet(tracker);

    await userEvent.setup().click(screen.getByTestId("extract-submit"));
    expect(await screen.findByTestId("extract-conflict")).toHaveTextContent("photos");
    expect(screen.getByTestId("extract-name")).toHaveValue("photos 2");

    await userEvent.setup().click(screen.getByTestId("extract-submit"));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(start).toHaveBeenLastCalledWith("v1", "docs/photos.zip", "photos 2");
  });

  it("renders a forbidden failure without claiming success", async () => {
    const { api, start } = fakeApi();
    start.mockRejectedValue(new ApiFailure("forbidden", 403, "Forbidden"));
    const tracker = new ExtractTracker(api, 1e9);
    const { onStarted } = renderSheet(tracker);

    await userEvent.setup().click(screen.getByTestId("extract-submit"));
    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("offers a retry on a retryable failure", async () => {
    const { api, start } = fakeApi();
    start.mockRejectedValueOnce(new ApiFailure("retryable", 503, "Remote host unavailable"));
    start.mockResolvedValueOnce(runningJob());
    const tracker = new ExtractTracker(api, 1e9);
    const { onStarted } = renderSheet(tracker);

    await userEvent.setup().click(screen.getByTestId("extract-submit"));
    const retry = await screen.findByRole("button", { name: /try again|retry/i });
    await userEvent.setup().click(retry);
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
  });
});

describe("naming helpers", () => {
  it("derives the folder name like the server", () => {
    expect(derivedFolderName("photos.zip")).toBe("photos");
    expect(derivedFolderName("Backup.ZIP")).toBe("Backup");
    expect(derivedFolderName("my.photos.zip")).toBe("my.photos");
    expect(derivedFolderName("notes.txt")).toBe("notes.txt");
  });

  it("suggests the next free name on a conflict", () => {
    expect(nextFreeName("photos")).toBe("photos 2");
    expect(nextFreeName("photos 2")).toBe("photos 3");
    expect(nextFreeName("travel 9")).toBe("travel 10");
  });
});
