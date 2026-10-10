import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowsePage } from "./BrowsePage";
import { PreviewPage } from "./PreviewPage";
import { MovePickerPage } from "./MovePickerPage";
import { PublicGate } from "../components/PublicGate";
import { pb } from "../lib/pb";
import { collectionList, installFetchMock, installPbMock, jsonResponse, type FetchRoute } from "../test/mockApi";
import type { LsEntry } from "../lib/filesApi";
import { uploadQueue } from "../lib/uploadQueue";

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
    <MemoryRouter initialEntries={[`/v/v1${path ? "/" + path : ""}`]}>
      <Routes>
        <Route path="/v/:vdirId/view/*" element={<PreviewPage />} />
        <Route path="/v/:vdirId/move" element={<MovePickerPage />} />
        <Route path="/v/:vdirId/*" element={<BrowsePage />} />
        <Route path="/files" element={<div>files destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
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
  it("wires video to a new tab, audio to the in-app player, and previews other files", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": [entry("movie.mp4", { size: 99 }), entry("song.mp3", { size: 5 }), entry("notes.txt", { size: 1 })],
      }),
    ]);
    const view = renderBrowse();
    await screen.findByTestId("entry-0");

    // Video keeps the new-tab native player.
    const movieRow = screen.getByText("movie.mp4").closest("[data-testid^='entry-']") as HTMLElement;
    const movieLink = within(movieRow).getByTestId("open-media");
    expect(movieLink).toHaveAttribute("href", "/files/v1/movie.mp4");
    expect(movieLink).toHaveAttribute("target", "_blank");

    // Audio opens the in-app player instead of a new tab.
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

  it("dispatches the view route by kind: audio to the player, image to the viewer", async () => {
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
      lsRouter("v1", { "": [entry("song.mp3", { size: 5 }), entry("hero.png", { size: 9 })] }),
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

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("[data-testid^='entry-']") as HTMLElement;
}

async function openMenu(name: string) {
  await userEvent.setup().click(within(rowFor(name)).getByTestId("entry-actions"));
}

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
      <MemoryRouter initialEntries={[`/v/pub${tail}`]}>
        <Routes>
          <Route path="/v/:vdirId/view/*" element={<PublicGate><PreviewPage /></PublicGate>} />
          <Route path="/v/:vdirId/*" element={<PublicGate><BrowsePage /></PublicGate>} />
          <Route path="/" element={<div data-testid="login-screen">login</div>} />
        </Routes>
      </MemoryRouter>,
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
    expect(screen.queryByTestId("header-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("back")).not.toBeInTheDocument();

    // The context menu of a file entry keeps the read actions but
    // offers none of the write actions.
    await userEvent.setup().click(within(screen.getByTestId("entry-2")).getByTestId("entry-actions"));
    await waitFor(() => expect(screen.getByTestId("context-menu")).toBeInTheDocument());
    expect(screen.getByTestId("action-download")).toBeInTheDocument();
    expect(screen.queryByTestId("action-rename")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-delete")).not.toBeInTheDocument();
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
});
