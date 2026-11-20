// Pretty public URL routes (web-ui delta): alias browse, folder and
// breadcrumb navigation, back, and the reserved view preview namespace
// all stay under /apps/<alias> without touching the signed-in routes.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AliasGate } from "../components/AliasGate";
import { BrowsePage } from "./BrowsePage";
import { PreviewPage } from "./PreviewPage";
import { installFetchMock, installPbMock, jsonResponse, type FetchRoute } from "../test/mockApi";
import type { LsEntry } from "../lib/filesApi";

const sessionState = vi.hoisted(() => ({ userId: "", state: "anonymous" as string }));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: sessionState.state,
    userId: sessionState.userId,
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function entry(name: string, over: Partial<LsEntry> = {}): LsEntry {
  return { name, size: 0, dir: false, modtime: "2026-01-02T03:04:05Z", ...over };
}

const ROOT: LsEntry[] = [entry("docs", { dir: true })];
const DOCS: LsEntry[] = [entry("sub", { dir: true }), entry("a.txt", { size: 10 })];
const SUB: LsEntry[] = [entry("b.txt", { size: 2 })];

function resolver(alias: string, status: number): FetchRoute {
  return (url) =>
    url === `/api/sf/public-urls/${alias}`
      ? status === 200
        ? jsonResponse(200, { vdir: "pub", name: "Pretty folder" })
        : jsonResponse(404, { message: "Not found." })
      : undefined;
}

function lsRouter(vdirId: string, byPath: Record<string, LsEntry[]>) {
  return (url: string, init?: RequestInit) => {
    if (url !== `/api/sf/vdirs/${vdirId}/ls` || init?.method !== "POST") return undefined;
    const path = JSON.parse(String(init.body)).path as string;
    const hit = byPath[path];
    if (!hit) return jsonResponse(404, { message: "Not found." });
    return jsonResponse(200, { path, entries: hit });
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderAlias(path = "") {
  const tail = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return render(
    <MemoryRouter initialEntries={[`/apps/pretty${tail}`]}>
      <LocationProbe />
      <Routes>
        <Route path="/apps/:alias/view/*" element={<AliasGate><PreviewPage /></AliasGate>} />
        <Route path="/apps/:alias/*" element={<AliasGate><BrowsePage /></AliasGate>} />
        <Route path="/files" element={<div>files destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionState.state = "anonymous";
  sessionState.userId = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pretty public URL navigation", () => {
  it("browses folders under the alias", async () => {
    installPbMock([]);
    installFetchMock([resolver("pretty", 200), lsRouter("pub", { "": ROOT, docs: DOCS, "docs/sub": SUB })]);

    renderAlias("/docs");
    await screen.findByTestId("entry-0");
    expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/docs");
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Pretty folder");

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-dir"));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/docs/sub"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("b.txt"));
  });

  it("navigates back through a breadcrumb and the back control", async () => {
    installPbMock([]);
    installFetchMock([resolver("pretty", 200), lsRouter("pub", { "": ROOT, docs: DOCS })]);

    renderAlias("/docs");
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(within(screen.getByTestId("breadcrumbs")).getByText("Pretty folder"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("docs"));

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-dir"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/docs"));

    await userEvent.setup().click(screen.getByTestId("back"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty"));
  });

  it("opens previews under the reserved view namespace and returns to the alias listing", async () => {
    installPbMock([]);
    installFetchMock([resolver("pretty", 200), lsRouter("pub", { "": ROOT, docs: DOCS })]);

    renderAlias("/docs");
    await screen.findByTestId("entry-1");

    await userEvent.setup().click(within(screen.getByTestId("entry-1")).getByTestId("open-preview"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/view/docs/a.txt"),
    );
    expect(screen.getByTestId("preview")).toBeInTheDocument();
    expect(screen.getByTestId("preview-download")).toHaveAttribute(
      "href",
      "/apps/pretty/docs/a.txt",
    );

    await userEvent.setup().click(screen.getByTestId("back"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/docs"));
    expect(screen.getByTestId("entry-1")).toHaveTextContent("a.txt");
  });

  it("keeps the audio queue under the alias", async () => {
    installPbMock([]);
    installFetchMock([
      resolver("pretty", 200),
      lsRouter("pub", { "": ROOT, docs: [entry("track01.mp3", { size: 5 }), entry("track02.mp3", { size: 6 })] }),
    ]);

    renderAlias("/docs");
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-preview"));
    await waitFor(() => expect(screen.getByTestId("audio-title")).toHaveTextContent("track01.mp3"));

    await userEvent.setup().click(screen.getByTestId("audio-next"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/view/docs/track02.mp3"),
    );
    expect(screen.getByTestId("audio-title")).toHaveTextContent("track02.mp3");
  });

  it("keeps the image viewer back control under the alias", async () => {
    installPbMock([]);
    installFetchMock([
      resolver("pretty", 200),
      lsRouter("pub", { "": ROOT, docs: [entry("a.png", { size: 5 }), entry("b.jpg", { size: 6 })] }),
    ]);

    renderAlias("/docs");
    await screen.findByTestId("entry-0");

    await userEvent.setup().click(within(screen.getByTestId("entry-0")).getByTestId("open-preview"));
    await waitFor(() => expect(screen.getByTestId("image-viewer")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByTestId("viewer-back"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/apps/pretty/docs"));
  });

  it("shows not-available when the alias stops being public after it resolved", async () => {
    installPbMock([]);
    installFetchMock([
      resolver("pretty", 200),
      (url, init) =>
        url === "/api/sf/vdirs/pub/ls" && init?.method === "POST"
          ? jsonResponse(401, { message: "Authentication required." })
          : undefined,
    ]);

    renderAlias("/docs");

    await waitFor(() => expect(screen.getByTestId("state-unavailable")).toBeInTheDocument());
    expect(screen.queryByTestId("entry-0")).not.toBeInTheDocument();
  });

  it("shows an explicit not-available state for an unknown alias", async () => {
    installPbMock([]);
    installFetchMock([resolver("gone", 404)]);

    render(
      <MemoryRouter initialEntries={["/apps/gone/docs"]}>
        <Routes>
          <Route path="/apps/:alias/view/*" element={<AliasGate><PreviewPage /></AliasGate>} />
          <Route path="/apps/:alias/*" element={<AliasGate><BrowsePage /></AliasGate>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("state-unavailable")).toBeInTheDocument());
    expect(screen.queryByTestId("entry-0")).not.toBeInTheDocument();
  });
});
