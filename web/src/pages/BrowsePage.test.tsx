import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowsePage } from "./BrowsePage";
import { pb } from "../lib/pb";
import { collectionList, installFetchMock, installPbMock, jsonResponse } from "../test/mockApi";
import type { LsEntry } from "../lib/filesApi";
import { uploadQueue } from "../lib/uploadQueue";

const sessionState = vi.hoisted(() => ({ userId: "u1" }));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: "authenticated",
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

// lsRoutes maps virtual path -> entries (or an error response).
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
        <Route path="/v/:vdirId/*" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  pb.authStore.clear();
  sessionState.userId = "u1";
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
    // Directories sort first, then files by name.
    expect(within(first).getByText("docs")).toBeInTheDocument();
    expect(within(first).getByTestId("entry-size")).toHaveTextContent("—");
    expect(within(await screen.findByTestId("entry-1")).getByText("a.txt")).toBeInTheDocument();
    expect(within(screen.getByTestId("entry-2")).getByText("b.txt")).toBeInTheDocument();
    expect(within(screen.getByTestId("entry-2")).getByTestId("entry-size")).toHaveTextContent("2.0 KB");
    expect(within(screen.getByTestId("entry-2")).getByTestId("entry-modtime")).toHaveTextContent("2026");
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
    // Size ascending: dir first, then a.txt (10), b.txt (2048).
    await user.selectOptions(screen.getByTestId("sort-key"), "size");
    await waitFor(() => expect(screen.getByTestId("entry-1")).toHaveTextContent("a.txt"));
    expect(screen.getByTestId("entry-2")).toHaveTextContent("b.txt");

    // Flip to descending: b.txt before a.txt.
    await user.click(screen.getByTestId("sort-direction"));
    await waitFor(() => expect(screen.getByTestId("entry-1")).toHaveTextContent("b.txt"));
    expect(screen.getByTestId("entry-2")).toHaveTextContent("a.txt");

    // Name descending: docs still first (dirs before files), then b.txt, a.txt.
    await user.selectOptions(screen.getByTestId("sort-key"), "name");
    await waitFor(() => expect(screen.getByTestId("entry-1")).toHaveTextContent("b.txt"));
    expect(screen.getByTestId("entry-2")).toHaveTextContent("a.txt");
  });
});

describe("navigation and states", () => {
  it("enters a subdirectory and updates breadcrumbs", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": SAMPLE,
        docs: [entry("inner.txt", { size: 1 })],
      }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-dir"));

    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("docs"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("inner.txt"));
  });

  it("navigates back via a breadcrumb segment", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": SAMPLE,
        "docs/sub": [entry("deep.txt", { size: 1 })],
      }),
    ]);
    renderBrowse("docs/sub");
    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("sub"));

    // Click the root breadcrumb (vdir name).
    await userEvent.setup().click(within(screen.getByTestId("breadcrumbs")).getByText("Mine"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("docs"));
  });

  it("shows an empty state for an empty directory", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([lsRouter("v1", { "": [] })]);
    renderBrowse();
    await waitFor(() => expect(screen.getByTestId("state-empty")).toHaveTextContent("empty"));
  });

  it("shows the not-found state on a 404 and can go back", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": SAMPLE,
        "missing": jsonResponse(404, { message: "Not found." }),
      }),
    ]);
    renderBrowse("missing");
    await waitFor(() => expect(screen.getByTestId("state-notfound")).toBeInTheDocument());

    // A way back: the root breadcrumb link is still offered.
    expect(within(screen.getByTestId("breadcrumbs")).getByText("Mine")).toBeInTheDocument();
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
    fireEvent.scroll(scroll, { target: { scrollTop: 10000 * 44 } });

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
    const rows = screen.getAllByTestId(/^grid-row-\d+$/);
    expect(rows.length).toBeLessThan(50);

    const scroll = screen.getByTestId("entry-scroll");
    fireEvent.scroll(scroll, { target: { scrollTop: 2500 * 148 } });
    await waitFor(() => {
      const names = screen.getAllByTestId(/^entry-\d+$/).map((el) => el.getAttribute("data-entry-name"));
      expect(names).toContain("file-9999.txt");
    });
  });
});

describe("downloads and media links", () => {
  it("wires plain /files URLs for download and media new-tab actions", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRouter("v1", {
        "": [entry("movie.mp4", { size: 99 }), entry("notes.txt", { size: 1 })],
      }),
    ]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    // movie.mp4 sorts after notes.txt by name; find each by name.
    const movieRow = screen.getByText("movie.mp4").closest("[data-testid^='entry-']") as HTMLElement;
    const movieLink = within(movieRow).getByTestId("open-media");
    expect(movieLink).toHaveAttribute("href", "/files/v1/movie.mp4");
    expect(movieLink).toHaveAttribute("target", "_blank");
    expect(within(movieRow).getByTestId("action-download")).toHaveAttribute("download");
    expect(within(movieRow).getByTestId("action-open-tab")).toHaveAttribute("target", "_blank");

    const notesRow = screen.getByText("notes.txt").closest("[data-testid^='entry-']") as HTMLElement;
    const notesLink = within(notesRow).getByTestId("download-link");
    expect(notesLink).toHaveAttribute("href", "/files/v1/notes.txt");
    expect(notesLink).toHaveAttribute("download");
    expect(within(notesRow).queryByTestId("open-media")).not.toBeInTheDocument();
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

describe("file management actions", () => {
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
    expect(screen.queryByTestId("mkdir-form")).not.toBeInTheDocument();
  });

  it("renames an entry through mv", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([opRouter("v1", calls), lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await waitFor(() => expect(within(rowFor("a.txt")).getByTestId("action-rename")).toBeInTheDocument());
    await user.click(within(rowFor("a.txt")).getByTestId("action-rename"));
    const input = await screen.findByTestId("rename-name");
    await user.clear(input);
    await user.type(input, "renamed.txt");
    await user.click(screen.getByTestId("rename-submit"));

    await waitFor(() =>
      expect(calls).toContainEqual({ op: "mv", body: { path: "a.txt", to: "renamed.txt" } }),
    );
  });

  it("moves an entry to a destination path through mv", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([opRouter("v1", calls), lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await waitFor(() => expect(within(rowFor("a.txt")).getByTestId("action-move")).toBeInTheDocument());
    await user.click(within(rowFor("a.txt")).getByTestId("action-move"));
    const input = await screen.findByTestId("move-to");
    await user.clear(input);
    await user.type(input, "docs/a.txt");
    await user.click(screen.getByTestId("move-submit"));

    await waitFor(() =>
      expect(calls).toContainEqual({ op: "mv", body: { path: "a.txt", to: "docs/a.txt" } }),
    );
  });

  it("deletes only after confirmation", async () => {
    installPbMock([collectionList("vdirs", [MINE])]);
    const calls: OpCall[] = [];
    installFetchMock([opRouter("v1", calls), lsRouter("v1", { "": SAMPLE })]);
    renderBrowse();
    await screen.findByTestId("entry-0");

    const user = userEvent.setup();
    await waitFor(() => expect(within(rowFor("b.txt")).getByTestId("action-delete")).toBeInTheDocument());
    await user.click(within(rowFor("b.txt")).getByTestId("action-delete"));
    await screen.findByTestId("delete-confirm");

    // Declining leaves the entry untouched and issues no request.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toHaveLength(0);
    expect(rowFor("b.txt")).toBeInTheDocument();

    // Confirming issues the rm.
    await user.click(within(rowFor("b.txt")).getByTestId("action-delete"));
    await user.click(await screen.findByTestId("delete-confirm"));
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
    expect(within(rowFor("a.txt")).queryByTestId("action-rename")).not.toBeInTheDocument();
    expect(within(rowFor("a.txt")).queryByTestId("action-delete")).not.toBeInTheDocument();
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
    // The view stays interactive after enqueueing.
    expect(screen.getByTestId("upload-input")).toBeInTheDocument();
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
    expect(within(rowFor("a.txt")).getByTestId("action-rename")).toBeInTheDocument();
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
