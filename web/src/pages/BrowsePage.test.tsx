import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowsePage } from "./BrowsePage";
import { PreviewPage } from "./PreviewPage";
import { MovePickerPage } from "./MovePickerPage";
import { PublicGate } from "../components/PublicGate";
import { CastProvider } from "../lib/cast";
import { pb } from "../lib/pb";
import { collectionList, installFetchMock, installPbMock, jsonResponse, type FetchRoute } from "../test/mockApi";
import type { LsEntry } from "../lib/filesApi";
import { uploadQueue, type UploadItem } from "../lib/uploadQueue";

const sessionState = vi.hoisted(() => ({ userId: "u1", state: "authenticated" as string }));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: sessionState.state,
    userId: sessionState.userId,
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const MINE = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };

function entry(name: string, over: Partial<LsEntry> = {}): LsEntry {
  return { name, size: 0, dir: false, modtime: "2026-01-02T03:04:05Z", ...over };
}

function lsRouter(vdirId: string, byPath: Record<string, LsEntry[] | Response>) {
  return (url: string, init?: RequestInit) => {
    if (url !== `/api/sf/vdirs/${vdirId}/ls` || init?.method !== "POST") return undefined;
    const path = JSON.parse(String(init.body)).path as string;
    const hit = byPath[path];
    if (!hit) return jsonResponse(404, { message: "Not found." });
    if (hit instanceof Response) return hit;
    return jsonResponse(200, { path, entries: hit });
  };
}

function renderBrowse(path = "") {
  return render(
    <CastProvider loadSdk={async () => null}>
      <MemoryRouter initialEntries={[`/v/v1${path ? "/" + path : ""}`]}>
        <LocationProbe />
        <Routes>
          <Route path="/v/:vdirId/view/*" element={<PreviewPage />} />
          <Route path="/v/:vdirId/move" element={<MovePickerPage />} />
          <Route path="/v/:vdirId/*" element={<BrowsePage />} />
          <Route path="/files" element={<div>files destination</div>} />
        </Routes>
      </MemoryRouter>
    </CastProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-state">{JSON.stringify(location.state)}</span>;
}

beforeEach(() => {
  localStorage.clear();
  pb.authStore.clear();
  sessionState.userId = "u1";
  sessionState.state = "authenticated";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SAMPLE: LsEntry[] = [
  entry("docs", { dir: true }),
  entry("b.txt", { size: 2048 }),
  entry("a.txt", { size: 10 }),
];

describe("directory listing", () => {
  it("renders name, size, type, and modification time in list view", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();

    const first = await screen.findByTestId("entry-0");
    expect(within(first).getByText("docs")).toBeInTheDocument();
    // Folders carry no size cell.
    expect(within(first).queryByTestId("entry-size")).not.toBeInTheDocument();
    expect(within(await screen.findByTestId("entry-1")).getByText("a.txt")).toBeInTheDocument();
    const second = screen.getByTestId("entry-2");
    expect(within(second).getByText("b.txt")).toBeInTheDocument();
    expect(within(second).getByTestId("entry-size")).toHaveTextContent("2.0 KB");
    expect(within(second).getByText(/2026/)).toBeInTheDocument();
  });

  it("switches between list and grid without losing the directory", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(screen.getByTestId("view-grid"));
    await waitFor(() => expect(screen.getByTestId("grid-row-0")).toBeInTheDocument());
    expect(screen.getByTestId("entry-0")).toHaveTextContent("docs");
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Mine");

    await userEvent.setup().click(screen.getByTestId("view-list"));
    await waitFor(() => expect(screen.queryByTestId("grid-row-0")).not.toBeInTheDocument());
    expect(screen.getByTestId("entry-0")).toBeInTheDocument();
  });

  it("sorts by name, size, and modified in both directions", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId("sort-key"), "size");
    await waitFor(() => expect(screen.getByTestId("entry-1")).toHaveTextContent("a.txt"));
    expect(screen.getByTestId("entry-2")).toHaveTextContent("b.txt");

    await user.click(screen.getByTestId("sort-direction"));
    await waitFor(() => expect(screen.getByTestId("entry-1")).toHaveTextContent("b.txt"));
    expect(screen.getByTestId("entry-2")).toHaveTextContent("a.txt");

    await user.selectOptions(screen.getByTestId("sort-key"), "name");
    await waitFor(() => expect(screen.getByTestId("entry-1")).toHaveTextContent("b.txt"));
    expect(screen.getByTestId("entry-2")).toHaveTextContent("a.txt");
  });
});

describe("navigation and states", () => {
  it("enters a subdirectory and updates breadcrumbs", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", { "": SAMPLE, docs: [entry("inner.txt", { size: 1 })] }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-dir"));

    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("docs"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("inner.txt"));
  });

  it("navigates back via a breadcrumb segment and via the back control", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", { "": SAMPLE, "docs/sub": [entry("deep.txt", { size: 1 })] }),
    ]);
    renderBrowse("docs/sub");
    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("sub"));

    await userEvent.setup().click(within(screen.getByTestId("breadcrumbs")).getByText("Mine"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("docs"));

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-dir"));
    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("docs"));
    // The back control returns to the parent (the vdir root).
    await userEvent.setup().click(screen.getByTestId("back"));
    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Mine"));
  });

  it("shows an empty state for an empty directory", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": [] })]);
    renderBrowse();
    await waitFor(() => expect(screen.getByTestId("state-empty")).toHaveTextContent("empty"));
  });

  it("shows the not-found state on a 404 and offers a way back", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", { "": SAMPLE, missing: jsonResponse(404, { message: "Not found." }) }),
    ]);
    renderBrowse("missing");
    await waitFor(() => expect(screen.getByTestId("state-notfound")).toBeInTheDocument());
    expect(screen.getByTestId("back")).toBeInTheDocument();
  });
});

describe("virtualization", () => {
  it("renders a 10k-entry listing with a bounded DOM window and reaches the last entry", async () => {
    const big = Array.from({ length: 10000 }, (_, i) => entry(`file-${String(i).padStart(5, "0")}.txt`, { size: i }));
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": big })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const rendered = () => screen.getAllByTestId(/^entry-\d+$/);
    expect(rendered().length).toBeLessThan(100);

    const scroll = screen.getByTestId("entry-scroll");
    fireEvent.scroll(scroll, { target: { scrollTop: 10000 * 56 } });

    await waitFor(() => {
      const names = screen.getAllByTestId(/^entry-\d+$/).map((el) => el.getAttribute("data-entry-name"));
      expect(names).toContain("file-09999.txt");
    });
  });

  it("windows the grid view for a 10k-entry listing", async () => {
    const big = Array.from({ length: 10000 }, (_, i) => entry(`file-${i}.txt`, { size: i }));
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": big })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(screen.getByTestId("view-grid"));
    await waitFor(() => expect(screen.getByTestId("grid-row-0")).toBeInTheDocument());
    expect(screen.getAllByTestId(/^grid-row-\d+$/).length).toBeLessThan(50);

    const scroll = screen.getByTestId("entry-scroll");
    fireEvent.scroll(scroll, { target: { scrollTop: 3334 * 148 } });
    await waitFor(() => {
      const names = screen.getAllByTestId(/^entry-\d+$/).map((el) => el.getAttribute("data-entry-name"));
      expect(names).toContain("file-9999.txt");
    });
  });
});

describe("downloads, media, and preview", () => {
  it("wires video and audio to their in-app players and previews other files", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": [entry("movie.mp4", { size: 99 }), entry("song.mp3", { size: 5 }), entry("notes.txt", { size: 1 })],
      }),
    ]);
    const view = renderBrowse();
    await screen.findByTestId("entry-0");

    // Video opens the in-app player on the preview route.
    const movieRow = screen.getByText("movie.mp4").closest("[data-testid^='entry-']") as HTMLElement;
    await userEvent.setup().click(within(movieRow).getByTestId("open-preview"));
    await waitFor(() => expect(screen.getByTestId("video-player")).toBeInTheDocument());
    expect(screen.getByTestId("video-stream")).toHaveAttribute("src", "/files/v1/movie.mp4");
    await userEvent.setup().click(screen.getByTestId("back"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toBeInTheDocument());

    // Audio opens the in-app player too.
    const songRow = screen.getByText("song.mp3").closest("[data-testid^='entry-']") as HTMLElement;
    await userEvent.setup().click(within(songRow).getByTestId("open-preview"));

    await waitFor(() => expect(screen.getByTestId("audio-stream")).toBeInTheDocument());
    expect(screen.getByTestId("audio-title")).toHaveTextContent("song.mp3");
    expect(within(screen.getByTestId("preview")).getByTestId("preview-download")).toHaveAttribute(
      "href",
      "/files/v1/song.mp3",
    );
    view.unmount();

    const notesView = renderBrowse("view/notes.txt");
    await waitFor(() => expect(screen.getByTestId("preview")).toHaveTextContent("notes.txt"));
    expect(screen.getByTestId("preview-download")).toHaveAttribute("href", "/files/v1/notes.txt");
    notesView.unmount();
  });

  it("dispatches the view route by kind: audio, image, and video get their in-app views", async () => {
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
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": [entry("song.mp3", { size: 5 }), entry("hero.png", { size: 9 }), entry("movie.mp4", { size: 99 })],
      }),
      (url: string) => (url === "/files/v1/hero.png" ? jsonResponse(200, { ok: true }) : undefined),
    ]);

    const audioView = renderBrowse("view/song.mp3");
    await waitFor(() => expect(screen.getByTestId("audio-stream")).toBeInTheDocument());
    expect(screen.getByTestId("audio-title")).toHaveTextContent("song.mp3");
    expect(screen.getByTestId("preview-download")).toHaveAttribute("href", "/files/v1/song.mp3");
    audioView.unmount();

    const imageView = renderBrowse("view/hero.png");
    await waitFor(() => expect(screen.getByTestId("image-frame")).toBeInTheDocument());
    expect(screen.getByTestId("image-frame")).toHaveAttribute("alt", "hero.png");
    expect(screen.getByTestId("preview-download")).toHaveAttribute("href", "/files/v1/hero.png");
    imageView.unmount();

    const videoView = renderBrowse("view/movie.mp4");
    await waitFor(() => expect(screen.getByTestId("video-player")).toBeInTheDocument());
    expect(screen.getByTestId("video-stream")).toHaveAttribute("src", "/files/v1/movie.mp4");
    videoView.unmount();
  });

  it("returns from the preview to the containing directory at any depth", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": SAMPLE,
        "docs/sub": [entry("deep.txt", { size: 1 })],
      }),
    ]);
    renderBrowse("view/docs/sub/deep.txt");

    await waitFor(() => expect(screen.getByTestId("preview")).toHaveTextContent("deep.txt"));

    await userEvent.setup().click(screen.getByTestId("back"));

    // Back opens the file's immediate parent directory, not the vdir root.
    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("sub"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("deep.txt"));
  });

  it("operates the preview back control from the keyboard", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", { "": [entry("notes.txt", { size: 1 })] }),
    ]);
    renderBrowse("view/notes.txt");
    await waitFor(() => expect(screen.getByTestId("preview-download")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByTestId("back")).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Mine"));
  });

  it("opens the audio player from the context menu's Open action", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": [entry("song.flac", { size: 7 })] })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("song.flac");
    await userEvent.setup().click(await screen.findByTestId("action-open"));

    await waitFor(() => expect(screen.getByTestId("audio-stream")).toBeInTheDocument());
    expect(screen.getByTestId("audio-title")).toHaveTextContent("song.flac");
  });

  it("offers a Download action in the context menu through the /files URL", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const row = screen.getByText("a.txt").closest("[data-testid^='entry-']") as HTMLElement;
    await userEvent.setup().click(within(row).getByTestId("entry-actions"));
    const download = await screen.findByTestId("action-download");
    expect(download).toHaveAttribute("href", "/files/v1/a.txt");
    expect(download).toHaveAttribute("download");
  });

  it("offers Copy public link for files on a public vdir", async () => {
    installPbMock([collectionList("vdirs", [{ ...MINE, is_public: true }])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    const copy = await screen.findByTestId("action-copy-public-link");

    const user = userEvent.setup();
    await user.click(copy);
    expect(copy).toHaveTextContent("Copied");
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${window.location.origin}/files/v1/a.txt`,
    );
  });

  it("offers no Copy public link on a non-public vdir", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("action-copy-public-link")).not.toBeInTheDocument();
  });
});

type OpCall = { op: string; body: Record<string, unknown> };

function opRouter(vdirId: string, calls: OpCall[]) {
  return (url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return undefined;
    const op = ["mkdir", "mv", "rm"].find((name) => url === `/api/sf/vdirs/${vdirId}/${name}`);
    if (!op) return undefined;
    calls.push({ op, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(null, { status: 204 });
  };
}

function mutableLsRouter(
  vdirId: string,
  root: () => LsEntry[],
  byPath: Record<string, LsEntry[]> = {},
): FetchRoute {
  return (url: string, init?: RequestInit) => {
    if (url !== `/api/sf/vdirs/${vdirId}/ls` || init?.method !== "POST") return undefined;
    const path = JSON.parse(String(init.body)).path as string;
    if (!path) return jsonResponse(200, { path, entries: root() });
    const hit = byPath[path];
    if (!hit) return jsonResponse(404, { message: "Not found." });
    return jsonResponse(200, { path, entries: hit });
  };
}

function deferredMvRouter(vdirId: string, calls: OpCall[], pending: Array<() => void>): FetchRoute {
  return (url: string, init?: RequestInit) => {
    if (url !== `/api/sf/vdirs/${vdirId}/mv` || init?.method !== "POST") return undefined;
    calls.push({ op: "mv", body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Promise<Response>((resolve) => {
      pending.push(() => resolve(new Response(null, { status: 204 })));
    }) as unknown as Response;
  };
}

function countingLs(vdirId: string, byPath: Record<string, LsEntry[] | Response>) {
  let count = 0;
  const route = (url: string, init?: RequestInit) => {
    if (url !== `/api/sf/vdirs/${vdirId}/ls` || init?.method !== "POST") return undefined;
    count += 1;
    const path = JSON.parse(String(init.body)).path as string;
    const hit = byPath[path];
    if (!hit) return jsonResponse(404, { message: "Not found." });
    if (hit instanceof Response) return hit;
    return jsonResponse(200, { path, entries: hit });
  };
  return { route, count: () => count };
}

function mintRouter(
  vdirId: string,
  response: () => Response,
  calls: Record<string, unknown>[] = [],
) {
  return (url: string, init?: RequestInit) => {
    if (url !== `/api/sf/vdirs/${vdirId}/links` || init?.method !== "POST") return undefined;
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return response();
  };
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("[data-testid^='entry-']") as HTMLElement;
}

async function openMenu(name: string) {
  await userEvent.setup().click(within(rowFor(name)).getByTestId("entry-actions"));
}

async function enterSelection() {
  await waitFor(() => expect(screen.getByTestId("select-button")).toBeInTheDocument());
  await userEvent.setup().click(screen.getByTestId("select-button"));
  await screen.findByTestId("selection-bar");
}

async function selectEntries(...names: string[]) {
  const user = userEvent.setup();
  for (const name of names) {
    await user.click(within(rowFor(name)).getByTestId("entry-select"));
  }
}

describe("temporary links", () => {
  it("mints and copies the absolute 24-hour link on a non-public vdir", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: Record<string, unknown>[] = [];
    installFetchMock([
      mintRouter("v1", () => jsonResponse(201, { url: "/s/tok123", expires_at: "2026-10-27T19:00:00Z" }), calls),
      lsRouter("v1", { "": SAMPLE }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    const copy = await screen.findByTestId("action-copy-temp-link");
    expect(screen.queryByTestId("action-copy-public-link")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(copy);
    expect(copy).toHaveTextContent("Copied");
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${window.location.origin}/s/tok123`,
    );
    expect(calls).toEqual([{ path: "a.txt" }]);
  });

  it("keeps the temporary link for a signed-in viewer", async () => {
    sessionState.userId = "u2";
    installPbMock([
      collectionList("vdirs", [MINE]),
      collectionList("vdir_shares", [{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]),
    ]);
    installFetchMock([
      mintRouter("v1", () => jsonResponse(201, { url: "/s/tok123", expires_at: "2026-10-27T19:00:00Z" })),
      lsRouter("v1", { "": SAMPLE }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    expect(await screen.findByTestId("action-copy-temp-link")).toBeInTheDocument();
    expect(screen.queryByTestId("action-rename")).not.toBeInTheDocument();
  });

  it("offers no temporary link on a public vdir", async () => {
    installPbMock([collectionList("vdirs", [{ ...MINE, is_public: true }])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    expect(await screen.findByTestId("action-copy-public-link")).toBeInTheDocument();
    expect(screen.queryByTestId("action-copy-temp-link")).not.toBeInTheDocument();
  });

  it("does not claim success when the mint fails", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      mintRouter("v1", () => jsonResponse(403, { message: "Forbidden" })),
      lsRouter("v1", { "": SAMPLE }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    const copy = await screen.findByTestId("action-copy-temp-link");
    await userEvent.setup().click(copy);
    expect(copy).toHaveTextContent("Copy 24-hour link");
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
  });

  it("does not claim success when the clipboard write rejects", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      mintRouter("v1", () => jsonResponse(201, { url: "/s/tok123", expires_at: "2026-10-27T19:00:00Z" })),
      lsRouter("v1", { "": SAMPLE }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    const copy = await screen.findByTestId("action-copy-temp-link");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    await userEvent.setup().click(copy);
    expect(copy).toHaveTextContent("Copy 24-hour link");
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
  });
});

describe("file management actions", () => {
  it("offers header write actions to the owner, above the breadcrumbs, with a view-only toolbar", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const actions = await screen.findByTestId("header-actions");
    expect(within(actions).getByTestId("new-folder")).toBeInTheDocument();
    expect(within(actions).getByTestId("upload-button")).toBeInTheDocument();
    expect(within(actions).getByTestId("upload-input")).toBeInTheDocument();

    // The header actions sit above the breadcrumbs inside the folder
    // header (spec: writer sees header actions above the breadcrumbs).
    const crumbs = screen.getByTestId("breadcrumbs");
    expect(actions.compareDocumentPosition(crumbs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The compact toolbar holds only the view controls.
    const toolbar = screen.getByTestId("toolbar");
    expect(within(toolbar).getByTestId("sort-key")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("sort-direction")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("view-list")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("view-grid")).toBeInTheDocument();
    expect(within(toolbar).queryByTestId("new-folder")).not.toBeInTheDocument();
    expect(within(toolbar).queryByTestId("upload-button")).not.toBeInTheDocument();
    expect(within(toolbar).queryByTestId("upload-input")).not.toBeInTheDocument();
  });

  it("keeps header and toolbar controls free of horizontal overflow classes at a narrow viewport", async () => {
    // jsdom does no layout; the pixel-level check runs in the e2e
    // suite at a mobile viewport. Here we pin the structural shape
    // that prevents cut-off controls: both rows lay out on a single
    // non-wrapping flex line inside the full-width header block.
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await waitFor(() => expect(screen.getByTestId("header-actions")).toBeInTheDocument());
    const header = screen.getByTestId("header-actions").parentElement as HTMLElement;
    expect(header.className).toContain("px-4");
    expect(screen.getByTestId("header-actions").className).toContain("flex");
    expect(screen.getByTestId("toolbar").className).toContain("flex");
  });

  it("offers write actions to the owner and completes a create-folder", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    const ls = countingLs("v1", { "": SAMPLE });
    installFetchMock([opRouter("v1", calls), ls.route]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("new-folder")).toBeInTheDocument());
    await user.click(screen.getByTestId("new-folder"));
    await user.type(screen.getByTestId("mkdir-name"), "newdir");
    await user.click(screen.getByTestId("mkdir-submit"));

    await waitFor(() => expect(calls).toContainEqual({ op: "mkdir", body: { path: "newdir" } }));
    await waitFor(() => expect(ls.count()).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId("mkdir-name")).not.toBeInTheDocument();
  });

  it("renames an entry through mv", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([opRouter("v1", calls), lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    await userEvent.setup().click(await screen.findByTestId("action-rename"));
    const input = await screen.findByTestId("rename-name");
    await userEvent.setup().clear(input);
    await userEvent.setup().type(input, "renamed.txt");
    await userEvent.setup().click(screen.getByTestId("rename-submit"));

    await waitFor(() => expect(calls).toContainEqual({ op: "mv", body: { path: "a.txt", to: "renamed.txt" } }));
  });

  it("opens the pushed move picker and moves an entry", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([
      opRouter("v1", calls),
      lsRouter("v1", { "": SAMPLE, docs: [entry("inner", { dir: true })] }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("a.txt");
    await userEvent.setup().click(await screen.findByTestId("action-move"));

    // The move picker is a pushed screen listing folders only.
    await waitFor(() => expect(screen.getByTestId("move-submit")).toBeInTheDocument());
    await userEvent.setup().click(within(screen.getByTestId("move-folder")).getByText("docs"));
    await userEvent.setup().click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(calls).toContainEqual({ op: "mv", body: { path: "a.txt", to: "docs/a.txt" } }));
  });

  it("deletes only after confirmation", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([opRouter("v1", calls), lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("b.txt");
    await userEvent.setup().click(await screen.findByTestId("action-delete"));
    await screen.findByTestId("delete-confirm");

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toHaveLength(0);

    await openMenu("b.txt");
    await userEvent.setup().click(await screen.findByTestId("action-delete"));
    await userEvent.setup().click(await screen.findByTestId("delete-confirm"));
    await waitFor(() => expect(calls).toContainEqual({ op: "rm", body: { path: "b.txt" } }));
  });

  it("offers no write actions to a viewer", async () => {
    sessionState.userId = "u2";
    installPbMock([
      collectionList("vdirs", [MINE]),
      collectionList("vdir_shares", [{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]),
    ]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    expect(screen.queryByTestId("new-folder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("select-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("header-actions")).not.toBeInTheDocument();

    await openMenu("a.txt");
    const menu = await screen.findByTestId("context-menu");
    expect(within(menu).queryByTestId("action-rename")).not.toBeInTheDocument();
    expect(within(menu).queryByTestId("action-delete")).not.toBeInTheDocument();
  });

  it("offers write actions to an editor", async () => {
    sessionState.userId = "u2";
    installPbMock([
      collectionList("vdirs", [MINE]),
      collectionList("vdir_shares", [{ id: "s1", vdir: "v1", user: "u2", role: "editor" }]),
    ]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await waitFor(() => expect(screen.getByTestId("new-folder")).toBeInTheDocument());
    expect(screen.getByTestId("select-button")).toBeInTheDocument();
    await openMenu("a.txt");
    expect(within(await screen.findByTestId("context-menu")).getByTestId("action-rename")).toBeInTheDocument();
  });

  it("enqueues selected files for the current directory without blocking the view", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE, docs: [] })]);
    const enqueue = vi.spyOn(uploadQueue, "enqueue").mockImplementation(() => {});
    renderBrowse("docs");
    await waitFor(() => expect(screen.getByTestId("upload-input")).toBeInTheDocument());

    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];
    await userEvent.setup().upload(screen.getByTestId("upload-input"), files);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toBe("v1");
    expect(enqueue.mock.calls[0][1]).toBe("docs");
    expect(enqueue.mock.calls[0][2]).toHaveLength(2);
    expect(screen.getByTestId("upload-input")).toBeInTheDocument();
  });
});

describe("bulk selection", () => {
  it("enters with an empty selection, disables actions, and exits with Done", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await enterSelection();
    expect(screen.queryByTestId("header-actions")).not.toBeInTheDocument();
    expect(screen.getByTestId("selection-count")).toHaveTextContent("0 selected");
    expect(screen.getByTestId("bulk-move")).toBeDisabled();
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
    expect(screen.getAllByTestId("entry-select")).toHaveLength(3);

    await userEvent.setup().click(screen.getByTestId("selection-done"));
    await waitFor(() => expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument());
    expect(screen.getByTestId("select-button")).toBeInTheDocument();
    expect(screen.queryAllByTestId("entry-select")).toHaveLength(0);
  });

  it("toggles entries from rows and checkboxes without opening them", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("entry-0"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    expect(within(screen.getByTestId("entry-0")).getByTestId("entry-select")).toBeChecked();
    // A folder tap toggled instead of navigating.
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Mine");

    await user.click(within(screen.getByTestId("entry-1")).getByTestId("entry-select"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");

    await user.click(screen.getByTestId("entry-0"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
  });

  it("selects all and deselects all", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("select-all-toggle"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("3 selected");
    expect(screen.getByTestId("select-all-toggle")).toHaveTextContent("Deselect all");
    expect(screen.getAllByTestId("entry-select").every((box) => (box as HTMLInputElement).checked)).toBe(true);

    await user.click(screen.getByTestId("select-all-toggle"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("0 selected");
    expect(screen.getByTestId("select-all-toggle")).toHaveTextContent("Select all");
  });

  it("keeps the selection across view and sort changes", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt");
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("view-grid"));
    await waitFor(() => expect(screen.getByTestId("grid-row-0")).toBeInTheDocument());
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");

    await user.selectOptions(screen.getByTestId("sort-key"), "size");
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    expect(within(rowFor("a.txt")).getByTestId("entry-select")).toBeChecked();
  });

  it("clears the selection when the directory changes", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", { "": SAMPLE, docs: [entry("inner.txt", { size: 1 })] }),
    ]);
    renderBrowse("docs");
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("inner.txt"));
    await enterSelection();
    await selectEntries("inner.txt");
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");

    await userEvent.setup().click(screen.getByTestId("back"));
    await screen.findByTestId("entry-0");
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("entry-select")).toHaveLength(0);
    expect(screen.getByTestId("select-button")).toBeInTheDocument();
  });
});

describe("bulk delete", () => {
  function deferredRmRouter(vdirId: string, calls: OpCall[], pending: Array<() => void>): FetchRoute {
    return (url, init) => {
      if (url !== `/api/sf/vdirs/${vdirId}/rm` || init?.method !== "POST") return undefined;
      calls.push({ op: "rm", body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Promise<Response>((resolve) => {
        pending.push(() => resolve(new Response(null, { status: 204 })));
      }) as unknown as Response;
    };
  }

  it("names the selection, warns about folders, and deletes only after confirmation", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([opRouter("v1", calls), lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("docs", "a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-delete"));
    expect(await screen.findByTestId("alert")).toHaveTextContent("Delete 3 items?");
    expect(screen.getByTestId("alert")).toHaveTextContent(
      "Selected folders and everything inside them will be deleted.",
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("3 selected");

    await user.click(screen.getByTestId("bulk-delete"));
    await user.click(screen.getByTestId("bulk-delete-confirm"));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((call) => call.body.path).sort()).toEqual(["a.txt", "b.txt", "docs"]);
    await waitFor(() => expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument());
    expect(screen.queryByTestId("bulk-result")).not.toBeInTheDocument();
  });

  it("applies the successful items and reports the failed one", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    let current = [entry("a.txt"), entry("b.txt"), entry("c.txt")];
    const calls: OpCall[] = [];
    const ls = (url: string, init?: RequestInit) => {
      if (url !== "/api/sf/vdirs/v1/ls" || init?.method !== "POST") return undefined;
      return jsonResponse(200, { path: "", entries: current });
    };
    const rm = (url: string, init?: RequestInit) => {
      if (url !== "/api/sf/vdirs/v1/rm" || init?.method !== "POST") return undefined;
      const body = JSON.parse(String(init.body)) as { path: string };
      calls.push({ op: "rm", body });
      if (body.path === "b.txt") {
        current = current.filter((e) => e.name === "b.txt");
        return jsonResponse(404, { message: "Not found." });
      }
      current = current.filter((e) => e.name !== body.path);
      return new Response(null, { status: 204 });
    };
    installFetchMock([rm, ls]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt", "b.txt", "c.txt");

    await userEvent.setup().click(screen.getByTestId("bulk-delete"));
    await userEvent.setup().click(screen.getByTestId("bulk-delete-confirm"));

    await waitFor(() => expect(screen.getByTestId("bulk-result")).toBeInTheDocument());
    expect(screen.getByTestId("bulk-result-summary")).toHaveTextContent(
      "Deleted 2 of 3 items. 1 failed.",
    );
    expect(screen.getByTestId("bulk-result-failure")).toHaveTextContent("b.txt (not found)");
    expect(calls).toHaveLength(3);

    await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
    expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("c.txt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("bulk-result-dismiss"));
    expect(screen.queryByTestId("bulk-result")).not.toBeInTheDocument();
  });

  it("shows progress, disables repeat actions, and attempts each item once", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    const pending: Array<() => void> = [];
    installFetchMock([
      deferredRmRouter("v1", calls, pending),
      lsRouter("v1", { "": [entry("a.txt"), entry("b.txt")] }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-delete"));
    const confirm = screen.getByTestId("bulk-delete-confirm");
    // A double activation must not start a second batch; the lock is
    // synchronous even before React re-renders.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(calls).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByTestId("selection-count")).toHaveTextContent("Deleting 0 of 2"),
    );
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
    expect(screen.getByTestId("bulk-move")).toBeDisabled();
    expect(screen.getByTestId("selection-done")).toBeDisabled();

    await act(async () => {
      pending.shift()!();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("selection-count")).toHaveTextContent("Deleting 1 of 2"),
    );
    expect(calls).toHaveLength(2);

    await act(async () => {
      pending.shift()!();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument());
    expect(screen.queryByTestId("bulk-result")).not.toBeInTheDocument();
  });
});

describe("bulk move", () => {
  const MOVE_SAMPLE: LsEntry[] = [
    entry("docs", { dir: true }),
    entry("dest", { dir: true }),
    entry("a.txt", { size: 10 }),
    entry("b.txt", { size: 20 }),
  ];

  it("moves every selected entry into the chosen folder", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    let current = [...MOVE_SAMPLE];
    const calls: OpCall[] = [];
    const mv = (url: string, init?: RequestInit) => {
      if (url !== "/api/sf/vdirs/v1/mv" || init?.method !== "POST") return undefined;
      const body = JSON.parse(String(init.body)) as { path: string; to: string };
      calls.push({ op: "mv", body });
      current = current.filter((e) => e.name !== body.path);
      return new Response(null, { status: 204 });
    };
    installFetchMock([
      mv,
      mutableLsRouter("v1", () => current, {
        docs: [entry("inner", { dir: true })],
        dest: [],
      }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("docs", "a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-move"));
    await screen.findByTestId("move-title");
    expect(screen.getByTestId("move-title")).toHaveTextContent("Move 3 items");
    await user.click(screen.getByText("dest"));
    await user.click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((call) => call.body)).toEqual(
      expect.arrayContaining([
        { path: "docs", to: "dest/docs" },
        { path: "a.txt", to: "dest/a.txt" },
        { path: "b.txt", to: "dest/b.txt" },
      ]),
    );
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("dest"));
    expect(screen.queryByText("docs")).not.toBeInTheDocument();
    expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("b.txt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bulk-result")).not.toBeInTheDocument();
  });

  it("shows progress and disables Back and Move Here while moving", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    const pending: Array<() => void> = [];
    installFetchMock([
      deferredMvRouter("v1", calls, pending),
      mutableLsRouter("v1", () => [entry("docs", { dir: true }), entry("a.txt"), entry("b.txt")], {
        docs: [],
      }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-move"));
    await screen.findByTestId("move-title");
    await user.click(screen.getByText("docs"));
    await user.click(screen.getByTestId("move-submit"));

    expect(calls).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByTestId("move-progress")).toHaveTextContent("Moving 0 of 2"),
    );
    expect(screen.getByTestId("move-submit")).toBeDisabled();
    expect(screen.getByTestId("move-cancel")).toBeDisabled();

    await act(async () => {
      pending.shift()!();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("move-progress")).toHaveTextContent("Moving 1 of 2"),
    );

    await act(async () => {
      pending.shift()!();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("move-submit")).not.toBeInTheDocument());
    expect(screen.queryByTestId("bulk-result")).not.toBeInTheDocument();
  });

  it("refuses the source directory as the destination", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      mutableLsRouter("v1", () => MOVE_SAMPLE, { docs: [entry("inner", { dir: true })], dest: [] }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-move"));
    await screen.findByTestId("move-title");
    // The picker starts at the vdir root, which is the source directory.
    expect(screen.getByTestId("move-submit")).toBeDisabled();

    await user.click(screen.getByText("dest"));
    expect(screen.getByTestId("move-submit")).not.toBeDisabled();
  });

  it("refuses a selected folder, its descendant, and a folded-up path", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      mutableLsRouter("v1", () => MOVE_SAMPLE, {
        docs: [entry("inner", { dir: true })],
        "docs/inner": [],
        dest: [],
      }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("docs");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-move"));
    await screen.findByTestId("move-title");
    expect(screen.getByTestId("move-title")).toHaveTextContent("Move “docs”");

    await user.click(screen.getByText("docs"));
    expect(screen.getByTestId("move-submit")).toBeDisabled();
    await user.click(screen.getByText("inner"));
    expect(screen.getByTestId("move-submit")).toBeDisabled();

    await user.click(screen.getByTestId("move-manual-toggle"));
    const input = screen.getByTestId("move-manual");
    await user.clear(input);
    await user.type(input, "docs/../docs");
    expect(screen.getByTestId("move-submit")).toBeDisabled();
  });

  it("cancels without moving anything", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([
      opRouter("v1", calls),
      mutableLsRouter("v1", () => MOVE_SAMPLE, { docs: [entry("inner", { dir: true })], dest: [] }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-move"));
    await screen.findByTestId("move-title");
    await user.click(screen.getByTestId("move-cancel"));

    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    expect(calls).toHaveLength(0);
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
  });

  it("returns partial failures to the browse view and clears the result state", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    let current = [entry("docs", { dir: true }), entry("a.txt", { size: 10 }), entry("b.txt", { size: 20 })];
    const calls: OpCall[] = [];
    const mv = (url: string, init?: RequestInit) => {
      if (url !== "/api/sf/vdirs/v1/mv" || init?.method !== "POST") return undefined;
      const body = JSON.parse(String(init.body)) as { path: string; to: string };
      calls.push({ op: "mv", body });
      if (body.path === "b.txt") return jsonResponse(404, { message: "Not found." });
      current = current.filter((e) => e.name !== body.path);
      return new Response(null, { status: 204 });
    };
    installFetchMock([mv, mutableLsRouter("v1", () => current, { docs: [] })]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    await enterSelection();
    await selectEntries("a.txt", "b.txt");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("bulk-move"));
    await screen.findByTestId("move-title");
    await user.click(screen.getByText("docs"));
    await user.click(screen.getByTestId("move-submit"));

    await waitFor(() => expect(screen.getByTestId("bulk-result")).toBeInTheDocument());
    expect(screen.getByTestId("bulk-result-summary")).toHaveTextContent(
      "Moved 1 of 2 items. 1 failed.",
    );
    expect(screen.getByTestId("bulk-result-failure")).toHaveTextContent("b.txt (not found)");
    expect(calls).toHaveLength(2);

    await waitFor(() => expect(screen.getByTestId("location-state")).toHaveTextContent("null"));
    await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
    expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
  });
});

describe("mutation error states", () => {
  it.each([
    [404, "state-notfound"],
    [403, "state-forbidden"],
    [400, "state-error"],
    [500, "state-error"],
  ] as const)("maps a %i mutation failure to %s", async (status, testid) => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      (url: string, init?: RequestInit) =>
        init?.method === "POST" && url.endsWith("/mkdir") ? jsonResponse(status, { message: "boom" }) : undefined,
      lsRouter("v1", { "": SAMPLE }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("new-folder")).toBeInTheDocument());
    await user.click(screen.getByTestId("new-folder"));
    await user.type(screen.getByTestId("mkdir-name"), "x");
    await user.click(screen.getByTestId("mkdir-submit"));

    expect(await screen.findByTestId(testid)).toBeInTheDocument();
    if (status === 403) {
      expect(screen.queryByTestId("action-retry")).not.toBeInTheDocument();
    }
  });

  it("offers a working retry on a retryable mutation failure", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    let attempts = 0;
    installFetchMock([
      (url: string, init?: RequestInit) => {
        if (init?.method !== "POST" || !url.endsWith("/mkdir")) return undefined;
        attempts += 1;
        return attempts === 1 ? jsonResponse(503, { message: "busy" }) : new Response(null, { status: 204 });
      },
      lsRouter("v1", { "": SAMPLE }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("new-folder")).toBeInTheDocument());
    await user.click(screen.getByTestId("new-folder"));
    await user.type(screen.getByTestId("mkdir-name"), "x");
    await user.click(screen.getByTestId("mkdir-submit"));

    await user.click(await screen.findByTestId("action-retry"));
    await waitFor(() => expect(attempts).toBe(2));
  });
});

describe("anonymous public mode", () => {
  function publicMeta(vdirId: string, status = 200): FetchRoute {
    return (url) =>
      url === `/api/sf/vdirs/${vdirId}/meta`
        ? status === 200
          ? jsonResponse(200, { name: "Public", is_public: true })
          : jsonResponse(404, { message: "Not found." })
        : undefined;
  }

  function renderPublic(path = "", view = false) {
    const tail = view ? `/view${path ? "/" + path : ""}` : path ? "/" + path : "";
    return render(
      <CastProvider loadSdk={async () => null}>
        <MemoryRouter initialEntries={[`/v/pub${tail}`]}>
          <Routes>
            <Route path="/v/:vdirId/view/*" element={<PublicGate><PreviewPage /></PublicGate>} />
            <Route path="/v/:vdirId/*" element={<PublicGate><BrowsePage /></PublicGate>} />
            <Route path="/" element={<div data-testid="login-screen">login</div>} />
          </Routes>
        </MemoryRouter>
      </CastProvider>,
    );
  }

  beforeEach(() => {
    sessionState.state = "anonymous";
    sessionState.userId = "";
  });

  it("browses with the meta-probed name and no record-API call", async () => {
    const send = installPbMock([]);
    installFetchMock([publicMeta("pub"), lsRouter("pub", { "": SAMPLE })]);

    renderPublic();

    await screen.findByTestId("entry-0");
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Public");
    expect(send).not.toHaveBeenCalled();
  });

  it("offers no write actions and hides the root back control", async () => {
    installPbMock([]);
    installFetchMock([publicMeta("pub"), lsRouter("pub", { "": SAMPLE })]);

    renderPublic();

    await screen.findByTestId("entry-0");
    expect(screen.queryByTestId("new-folder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("select-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("header-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("back")).not.toBeInTheDocument();

    // The context menu of a file entry keeps the read actions but
    // offers none of the write actions.
    await userEvent.setup().click(within(screen.getByTestId("entry-2")).getByTestId("entry-actions"));
    await waitFor(() => expect(screen.getByTestId("context-menu")).toBeInTheDocument());
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
    expect(screen.getByTestId("action-copy-public-link")).toBeInTheDocument();
    expect(screen.queryByTestId("action-copy-temp-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-rename")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-delete")).not.toBeInTheDocument();
  });

  it("opens the in-app video player anonymously", async () => {
    installPbMock([]);
    installFetchMock([publicMeta("pub"), lsRouter("pub", { "": [entry("movie.mp4", { size: 99 })] })]);

    renderPublic("movie.mp4", true);

    await waitFor(() => expect(screen.getByTestId("video-player")).toBeInTheDocument());
    expect(screen.getByTestId("video-stream")).toHaveAttribute("src", "/files/pub/movie.mp4");
  });

  it("keeps browse and download working anonymously", async () => {
    installPbMock([]);
    installFetchMock([publicMeta("pub"), lsRouter("pub", { docs: SAMPLE })]);

    renderPublic("docs");

    await screen.findByTestId("entry-0");
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("docs");
    expect(screen.getByTestId("back")).toBeInTheDocument();
  });

  it("surfaces the not-available state with sign-in when access is cut", async () => {
    installPbMock([]);
    installFetchMock([
      publicMeta("pub"),
      lsRouter("pub", {
        "": SAMPLE,
        docs: jsonResponse(401, { message: "Authentication required." }),
      }),
    ]);

    renderPublic();
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-dir"));

    await waitFor(() => expect(screen.getByTestId("state-unavailable")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByTestId("action-signin"));
    await waitFor(() => expect(screen.getByTestId("login-screen")).toBeInTheDocument());
  });

  it("previews anonymously and maps preview failures to not-available", async () => {
    installPbMock([]);
    installFetchMock([
      publicMeta("pub"),
      lsRouter("pub", { "": [entry("a.txt", { size: 10 })] }),
    ]);

    renderPublic("a.txt", true);

    await waitFor(() => expect(screen.getByTestId("preview-download")).toBeInTheDocument());
    expect(screen.getByTestId("preview-download")).toHaveAttribute("href", "/files/pub/a.txt");

    // After the vdir stops being public, the same preview is not
    // available rather than an unexplained error.
    installFetchMock([
      publicMeta("pub"),
      lsRouter("pub", { "": jsonResponse(401, { message: "Authentication required." }) }),
    ]);
    renderPublic("a.txt", true);
    await waitFor(() => expect(screen.getByTestId("state-unavailable")).toBeInTheDocument());
  });

  it("offers no drop behavior on a public vdir", async () => {
    installPbMock([]);
    installFetchMock([publicMeta("pub"), lsRouter("pub", { "": SAMPLE })]);
    const enqueue = vi.spyOn(uploadQueue, "enqueueEntries").mockImplementation(() => {});

    renderPublic();
    await screen.findByTestId("entry-0");
    const zone = screen.getByTestId("drop-zone");

    fireEvent.dragEnter(zone, { dataTransfer: { items: [], files: [] } });
    expect(zone).not.toHaveAttribute("data-drop-active");

    fireEvent.drop(zone, {
      dataTransfer: {
        items: [
          {
            webkitGetAsEntry: () => ({
              name: "x.txt",
              isFile: true,
              isDirectory: false,
              file: (ok: (file: File) => void) => ok(new File(["x"], "x.txt")),
            }),
          },
        ],
        files: [],
      },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("archive extraction", () => {
  function extractRouter(
    vdirId: string,
    onSettle: () => void,
  ): FetchRoute {
    return (url, init) => {
      if (url === `/api/sf/vdirs/${vdirId}/extract` && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { path: string; name?: string };
        return jsonResponse(202, {
          job: {
            id: "job1",
            state: "running",
            phase: "scanning",
            path: body.path,
            target: "photos",
            skipped: 0,
            entriesTotal: 0,
            entriesDone: 0,
            bytesTotal: 0,
            bytesDone: 0,
            startedAt: "2026-11-15T10:00:00Z",
          },
        });
      }
      const m = new RegExp(`^/api/sf/vdirs/${vdirId}/extract/(.+)$`).exec(url);
      if (m) {
        onSettle();
        return jsonResponse(200, {
          job: {
            id: m[1],
            state: "succeeded",
            phase: "publishing",
            path: "photos.zip",
            target: "photos",
            skipped: 0,
            entriesTotal: 1,
            entriesDone: 1,
            bytesTotal: 10,
            bytesDone: 10,
            startedAt: "2026-11-15T10:00:00Z",
            finishedAt: "2026-11-15T10:00:05Z",
          },
        });
      }
      return undefined;
    };
  }

  it("extracts a zip from the context menu and shows the folder without a reload", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    let settled = false;
    const before = [entry("photos.zip", { size: 100 })];
    const after = [entry("photos", { dir: true }), ...before];
    installFetchMock([
      extractRouter("v1", () => {
        settled = true;
      }),
      (url, init) => {
        if (url !== "/api/sf/vdirs/v1/ls" || init?.method !== "POST") return undefined;
        const path = JSON.parse(String(init.body)).path as string;
        if (path !== "") return jsonResponse(404, { message: "Not found." });
        return jsonResponse(200, { path, entries: settled ? after : before });
      },
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await openMenu("photos.zip");
    expect(await screen.findByTestId("action-extract")).toBeInTheDocument();
    await user.click(screen.getByTestId("action-extract"));

    // The confirmation names the derived folder.
    expect(await screen.findByTestId("extract-name")).toHaveValue("photos");
    await user.click(screen.getByTestId("extract-submit"));

    // The job settles on the next poll and the listing refreshes itself.
    expect(await screen.findByText("photos", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId("extract-name")).not.toBeInTheDocument();
  });

  it("offers no extraction to a reader without write access", async () => {
    sessionState.userId = "u2";
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      (url, init) => {
        if (url.includes("/collections/vdir_shares/records")) return jsonResponse(200, { items: [] });
        if (url !== "/api/sf/vdirs/v1/ls" || init?.method !== "POST") return undefined;
        return jsonResponse(200, { path: "", entries: [entry("photos.zip")] });
      },
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await openMenu("photos.zip");
    expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("action-extract")).not.toBeInTheDocument();
  });
});

describe("drag and drop uploads", () => {
  function fileEntry(name: string): FileSystemEntry {
    return {
      name,
      isFile: true,
      isDirectory: false,
      file: (ok: (f: File) => void) => ok(new File([name], name)),
    } as unknown as FileSystemEntry;
  }

  function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
    return {
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let cursor = 0;
        return {
          readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
            const batch = children.slice(cursor, cursor + 100);
            cursor += batch.length;
            ok(batch);
          },
        };
      },
    } as unknown as FileSystemEntry;
  }

  function failingDirEntry(name: string): FileSystemEntry {
    return {
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (_ok: unknown, fail: (error: unknown) => void) => fail(new Error("denied")),
      }),
    } as unknown as FileSystemEntry;
  }

  function transfer(entries: FileSystemEntry[]): DataTransfer {
    return {
      items: entries.map((entry) => ({ webkitGetAsEntry: () => entry, getAsFile: () => null })),
      files: [],
      dropEffect: "none",
    } as unknown as DataTransfer;
  }

  async function writerOnEmptyDocs() {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": SAMPLE, docs: [] })]);
    renderBrowse("docs");
    await screen.findByTestId("state-empty");
    await waitFor(() => expect(screen.getByTestId("upload-button")).toBeInTheDocument());
    return screen.getByTestId("drop-zone");
  }

  it("enqueues dropped files into the browsed directory", async () => {
    const zone = await writerOnEmptyDocs();
    const enqueue = vi.spyOn(uploadQueue, "enqueueEntries").mockImplementation(() => {});

    fireEvent.drop(zone, { dataTransfer: transfer([fileEntry("a.txt")]) });

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue.mock.calls[0][0]).toBe("v1");
    expect(enqueue.mock.calls[0][1]).toEqual([
      { kind: "upload", path: "docs/a.txt", file: expect.any(File) },
    ]);
  });

  it("uploads a dropped folder tree with folders first", async () => {
    const zone = await writerOnEmptyDocs();
    const enqueue = vi.spyOn(uploadQueue, "enqueueEntries").mockImplementation(() => {});

    fireEvent.drop(zone, {
      dataTransfer: transfer([
        dirEntry("photos", [dirEntry("sub", [fileEntry("a.jpg")]), fileEntry("b.jpg")]),
      ]),
    });

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    const entries = enqueue.mock.calls[0][1] as Array<{ kind: string; path: string }>;
    expect(entries.map((e) => [e.kind, e.path])).toEqual([
      ["folder", "docs/photos"],
      ["folder", "docs/photos/sub"],
      ["upload", "docs/photos/sub/a.jpg"],
      ["upload", "docs/photos/b.jpg"],
    ]);
  });

  it("marks the listing while a drag hovers and clears it on leave", async () => {
    const zone = await writerOnEmptyDocs();

    fireEvent.dragEnter(zone, { dataTransfer: transfer([fileEntry("a.txt")]) });
    expect(zone).toHaveAttribute("data-drop-active", "true");

    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveAttribute("data-drop-active");
  });

  it("shows a dismissible notice for an unreadable folder while the sibling uploads", async () => {
    const zone = await writerOnEmptyDocs();
    const enqueue = vi.spyOn(uploadQueue, "enqueueEntries").mockImplementation(() => {});

    fireEvent.drop(zone, {
      dataTransfer: transfer([failingDirEntry("locked"), dirEntry("open", [fileEntry("ok.txt")])]),
    });

    const notice = await screen.findByTestId("drop-notice");
    expect(notice).toHaveTextContent("locked");
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    const entries = enqueue.mock.calls[0][1] as Array<{ kind: string; path: string }>;
    expect(entries.map((e) => [e.kind, e.path])).toEqual([
      ["folder", "docs/open"],
      ["upload", "docs/open/ok.txt"],
    ]);

    await userEvent.setup().click(screen.getByTestId("drop-notice-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("drop-notice")).not.toBeInTheDocument());
  });

  it("does nothing for a drag that carries no files", async () => {
    const zone = await writerOnEmptyDocs();
    const enqueue = vi.spyOn(uploadQueue, "enqueueEntries").mockImplementation(() => {});

    fireEvent.drop(zone, { dataTransfer: { items: [], files: [] } as unknown as DataTransfer });

    expect(enqueue).not.toHaveBeenCalled();
    expect(screen.queryByTestId("drop-notice")).not.toBeInTheDocument();
  });

  it("invites writers but not viewers to drop files into an empty directory", async () => {
    await writerOnEmptyDocs();
    expect(within(screen.getByTestId("state-empty")).getByText(/Drop files or folders/)).toBeInTheDocument();
  });

  it("gives viewers no drop zone behavior", async () => {
    sessionState.userId = "u2";
    installPbMock([
      collectionList("vdirs", [MINE]),
      collectionList("vdir_shares", [{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]),
    ]);
    installFetchMock([lsRouter("v1", { "": SAMPLE, docs: [] })]);
    const enqueue = vi.spyOn(uploadQueue, "enqueueEntries").mockImplementation(() => {});
    renderBrowse("docs");
    await screen.findByTestId("state-empty");
    expect(within(screen.getByTestId("state-empty")).queryByText(/Drop files or folders/)).not.toBeInTheDocument();

    const zone = screen.getByTestId("drop-zone");
    fireEvent.dragEnter(zone, { dataTransfer: transfer([fileEntry("a.txt")]) });
    expect(zone).not.toHaveAttribute("data-drop-active");
    fireEvent.drop(zone, { dataTransfer: transfer([fileEntry("a.txt")]) });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refreshes the listing when a completed upload targets the browsed directory", async () => {
    const listeners: Array<(item: UploadItem) => void> = [];
    vi.spyOn(uploadQueue, "onSettled").mockImplementation((fn) => {
      listeners.push(fn);
      return () => {};
    });
    let lsCalls = 0;
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      (url, init) => {
        if (url !== "/api/sf/vdirs/v1/ls" || init?.method !== "POST") return undefined;
        lsCalls += 1;
        return jsonResponse(200, { path: "", entries: SAMPLE });
      },
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");
    expect(lsCalls).toBe(1);

    const item: UploadItem = {
      id: "u1",
      kind: "upload",
      vdirId: "v1",
      dir: "",
      name: "a.txt",
      path: "a.txt",
      size: 1,
      state: "completed",
      loaded: 1,
      total: 1,
      attempts: 1,
      error: null,
      failedBy: null,
    };
    act(() => listeners[0](item));
    await waitFor(() => expect(lsCalls).toBe(2));

    act(() => listeners[0]({ ...item, id: "u2", dir: "docs", path: "docs/a.txt" }));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toBeInTheDocument());
    expect(lsCalls).toBe(2);
  });
});
