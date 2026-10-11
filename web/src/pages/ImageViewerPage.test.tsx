import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { PreviewPage } from "./PreviewPage";
import type { LsEntry } from "../lib/filesApi";
import { installFetchMock, jsonResponse } from "../test/mockApi";

const MODTIME = "2026-01-02T03:04:05Z";

const ENTRIES: LsEntry[] = [
  { name: "a.png", size: 1024, dir: false, modtime: MODTIME },
  { name: "note.txt", size: 5, dir: false, modtime: MODTIME },
  { name: "sub", size: 0, dir: true, modtime: MODTIME },
  { name: "b.jpg", size: 2048, dir: false, modtime: MODTIME },
  { name: "c.webp", size: 4096, dir: false, modtime: MODTIME },
];

const SOLO: LsEntry[] = [{ name: "only.png", size: 8192, dir: false, modtime: MODTIME }];

const OTHER: LsEntry[] = [
  { name: "d.png", size: 256, dir: false, modtime: MODTIME },
  { name: "e.jpg", size: 512, dir: false, modtime: MODTIME },
];

let navigateRef: ((to: string | number, opts?: { replace?: boolean }) => void) | null = null;

function RouteProbe({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  navigateRef = (to, opts) => {
    if (typeof to === "number") navigate(to);
    else navigate(to, opts);
  };
  return (
    <>
      <div data-testid="location-probe">{pathname}</div>
      <button type="button" data-testid="history-back" onClick={() => navigateRef!(-1)}>
        back
      </button>
      {children}
    </>
  );
}

function BrowseProbe() {
  return <div data-testid="browse-probe" />;
}

function renderPreview(initial = "/v/v1/view/photos/a.png") {
  render(
    <MemoryRouter initialEntries={["/v/v1/photos", initial]} initialIndex={1}>
      <Routes>
        <Route
          path="/v/:vdirId/view/*"
          element={
            <RouteProbe>
              <PreviewPage />
            </RouteProbe>
          }
        />
        <Route
          path="/v/:vdirId/*"
          element={
            <RouteProbe>
              <BrowseProbe />
            </RouteProbe>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function harness(entriesByDir: Record<string, LsEntry[]>, initial?: string) {
  let lsCalls = 0;
  let fileCalls = 0;
  const fetchMock = installFetchMock([
    (url, init) => {
      if (url.endsWith("/ls") && (init?.method ?? "") === "POST" && init) {
        const body = JSON.parse(String(init.body)) as { path: string };
        const entries = entriesByDir[body.path ?? ""];
        if (!entries) return jsonResponse(404, { message: "no such directory" });
        lsCalls += 1;
        return jsonResponse(200, { entries });
      }
      return undefined;
    },
    (url) => {
      if (url.startsWith("/files/")) {
        fileCalls += 1;
        return jsonResponse(200, { ok: true });
      }
      return undefined;
    },
  ]);
  renderPreview(initial);
  return { fetchMock, lsCalls: () => lsCalls, fileCalls: () => fileCalls };
}

function pointer(el: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y = 300, id = 1) {
  fireEvent[type](el, { pointerId: id, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0 });
}

async function openViewer(over?: Partial<Record<string, LsEntry[]>>, initial?: string) {
  const ctx = harness({ photos: ENTRIES, solo: SOLO, other: OTHER, ...over }, initial);
  const frame = await screen.findByTestId("image-frame");
  return { ...ctx, frame };
}

const swipe = async (fromX: number, toX: number) => {
  const stage = screen.getByTestId("viewer-stage");
  pointer(stage, "pointerDown", fromX);
  pointer(stage, "pointerMove", fromX + (toX - fromX) / 2);
  pointer(stage, "pointerMove", toX);
  pointer(stage, "pointerUp", toX);
};

const tap = async () => {
  const stage = screen.getByTestId("viewer-stage");
  pointer(stage, "pointerDown", 500);
  pointer(stage, "pointerUp", 500);
};

const doubleTap = async () => {
  await tap();
  await tap();
};

const position = () => screen.getByTestId("gallery-position").textContent;

const locationIs = (path: string) =>
  waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(path));

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
  navigateRef = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImageViewerPage gallery", () => {
  it("opens fullscreen at the opened image and cycles only image entries in listing order", async () => {
    await openViewer();

    const frame = screen.getByTestId("image-frame");
    expect(frame).toHaveAttribute("alt", "a.png");
    expect(frame).toHaveAttribute("src", "blob:mock-url");
    expect(position()).toBe("1 / 3");
    expect(screen.getByTestId("viewer-name")).toHaveTextContent("a.png");
    // the mixed directory's txt file and subdirectory are not in the cycle
    expect(screen.queryByText("note.txt")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));
    expect(position()).toBe("2 / 3");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "c.webp"));
    expect(position()).toBe("3 / 3");
  });

  it("does not refetch the listing for in-directory swipes but does for another directory", async () => {
    const { lsCalls } = await openViewer();
    expect(lsCalls()).toBe(1);

    await swipe(800, 200);
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));
    await locationIs("/v/v1/view/photos/b.jpg");
    expect(lsCalls()).toBe(1);

    await waitFor(() => navigateRef !== null);
    await navigateRef!("/v/v1/view/other/d.png", { replace: true });

    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "d.png"));
    expect(lsCalls()).toBe(2);
  });

  it("keeps the plain /files download and metadata in the chrome", async () => {
    const { fetchMock, fileCalls } = await openViewer();

    const download = screen.getByTestId("preview-download");
    expect(download).toHaveAttribute("href", "/files/v1/photos/a.png");
    expect(download).toHaveAttribute("download");
    // the ±1 prefetch window has the neighbor materialized as well (D3)
    expect(fileCalls()).toBe(2);
    const filesCall = fetchMock.mock.calls.find(([u]) => String(u).startsWith("/files/"));
    expect(filesCall?.[0]).toBe("/files/v1/photos/a.png");
    expect(screen.getByTestId("viewer-name")).toHaveTextContent("a.png");
    expect(screen.getByTestId("viewer-chrome")).toHaveTextContent("1.0 KB");
    expect(screen.getByTestId("viewer-chrome")).toHaveTextContent(/Modified/);
  });

  it("falls back to the metadata card when the displayed slide cannot be decoded", async () => {
    await openViewer();

    fireEvent.error(screen.getByTestId("image-frame"));

    // The metadata card replaces the broken frame while the gallery
    // (and its chrome download) stay available.
    expect(screen.queryByTestId("image-frame")).not.toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getAllByTestId("preview-download")[0]).toHaveAttribute(
      "href",
      "/files/v1/photos/a.png",
    );

    await swipe(800, 200);
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));
  });

  it("shows a retryable failure state for a failed slide and retries that slide", async () => {
    let files = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/ls") && (init?.method ?? "") === "POST") {
          return jsonResponse(200, { entries: ENTRIES });
        }
        if (url.startsWith("/files/")) {
          files += 1;
          if (files === 1) return jsonResponse(503, { message: "busy" });
          return jsonResponse(200, { ok: true });
        }
        return jsonResponse(404, { message: "unrouted" });
      }),
    );
    renderPreview();
    expect(await screen.findByTestId("state-retryable")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("action-retry"));

    await waitFor(() => expect(screen.getByTestId("image-frame")).toBeInTheDocument());
    // calls: the failed a.png fetch, the prefetched b.jpg, the retry of a.png
    expect(files).toBe(3);
  });

  it("toggles the chrome on image tap and goes back from the chrome", async () => {
    await openViewer();

    await tap();
    await waitFor(() => expect(screen.queryByTestId("viewer-chrome")).not.toBeInTheDocument());
    expect(screen.getByTestId("image-frame")).toBeInTheDocument();

    await tap();
    await waitFor(() => expect(screen.getByTestId("viewer-chrome")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("viewer-back"));
    await locationIs("/v/v1/photos");
    expect(screen.getByTestId("browse-probe")).toBeInTheDocument();
  });

  it("returns to the browse listing on Escape", async () => {
    await openViewer();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.getByTestId("browse-probe")).toBeInTheDocument());
    await locationIs("/v/v1/photos");
  });

  it("double-tap zooms centered on the tap point and the next image starts at fit-to-screen", async () => {
    await openViewer();

    await doubleTap();

    await waitFor(() => expect(screen.getByTestId("image-frame").style.transform).toContain("scale(2.5)"));
    expect(screen.getByTestId("image-frame").style.transform).not.toBe("translate3d(0px, 0px, 0) scale(1)");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));
    expect(screen.getByTestId("image-frame").style.transform).toBe("translate3d(0px, 0px, 0) scale(1)");
  });

  it("pans while zoomed instead of paging", async () => {
    await openViewer();

    await doubleTap();
    await waitFor(() => expect(screen.getByTestId("image-frame").style.transform).toContain("scale(2.5)"));

    const stage = screen.getByTestId("viewer-stage");
    pointer(stage, "pointerDown", 600);
    pointer(stage, "pointerMove", 400);
    pointer(stage, "pointerMove", 200);
    pointer(stage, "pointerUp", 200);

    // a 400px left drag would page at fit-to-screen; zoomed it pans
    expect(position()).toBe("1 / 3");
    expect(screen.getByTestId("image-frame").style.transform).toContain("scale(2.5)");
    expect(screen.getByTestId("image-frame").style.transform).toContain("translate3d(-382px");
  });

  it("swipes to the neighboring images and stops at both ends", async () => {
    await openViewer();

    await swipe(800, 200);
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));
    expect(position()).toBe("2 / 3");

    await swipe(800, 200);
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "c.webp"));
    expect(position()).toBe("3 / 3");

    await swipe(800, 200);
    expect(await screen.findByTestId("image-frame")).toHaveAttribute("alt", "c.webp");
    expect(position()).toBe("3 / 3");

    await swipe(200, 800);
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));

    await swipe(200, 800);
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "a.png"));
    expect(position()).toBe("1 / 3");

    await swipe(200, 800);
    expect(await screen.findByTestId("image-frame")).toHaveAttribute("alt", "a.png");
    expect(position()).toBe("1 / 3");
  });

  it("cannot swipe in a single-image directory", async () => {
    await openViewer({ photos: ENTRIES }, "/v/v1/view/solo/only.png");

    expect(position()).toBe("1 / 1");

    await swipe(800, 200);
    expect(await screen.findByTestId("image-frame")).toHaveAttribute("alt", "only.png");
    expect(position()).toBe("1 / 1");
  });

  it("tracks the URL across swipes so back returns to the browse listing", async () => {
    await openViewer();

    await swipe(800, 200);
    await locationIs("/v/v1/view/photos/b.jpg");
    expect(position()).toBe("2 / 3");

    // the swipe replaced the preview entry, so back is the listing
    await userEvent.click(screen.getByTestId("history-back"));
    await waitFor(() => expect(screen.getByTestId("browse-probe")).toBeInTheDocument());
    await locationIs("/v/v1/photos");
  });

  it("pages with the arrow keys and respects the ends", async () => {
    await openViewer();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByTestId("image-frame")).toHaveAttribute("alt", "a.png");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "b.jpg"));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "c.webp"));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByTestId("image-frame")).toHaveAttribute("alt", "c.webp");
    expect(position()).toBe("3 / 3");
  });

  it("renders as a fullscreen overlay with the chrome download", async () => {
    await openViewer();

    // the former card layout (contained frame + download button below
    // the image) is gone: the viewer is a fullscreen overlay
    expect(screen.getByTestId("image-viewer")).toHaveClass("fixed", "inset-0");
    expect(within(screen.getByTestId("viewer-chrome")).getByTestId("preview-download")).toBeInTheDocument();
  });
});
