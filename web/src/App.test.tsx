import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { pb } from "./lib/pb";
import {
  authRefresh,
  collectionList,
  installFetchMock,
  installPbMock,
  jsonResponse,
  type FetchRoute,
} from "./test/mockApi";

const OWNER = { id: "u1", email: "owner@stratofold.test" };
function fakeJwt(): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function lsRoute(vdirId: string, path: string, entries: unknown[]) {
  return (url: string, init?: RequestInit) => {
    if (url === `/api/sf/vdirs/${vdirId}/ls` && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ path });
      return jsonResponse(200, { path, entries });
    }
    return undefined;
  };
}

beforeEach(() => {
  localStorage.clear();
  pb.authStore.clear();
  pb.authStore.save(fakeJwt(), OWNER as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MINE = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv/mine", is_public: false, connection: "c1" };
const SHARED = { id: "v2", owner: "u2", name: "Shared", root_path: "/srv/shared", is_public: true, connection: "c2" };

describe("app shell and routing", () => {
  it("redirects / to the Files tab", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE, SHARED])]);
    installFetchMock([]);

    renderApp("/");

    await waitFor(() => expect(screen.getByTestId("locations")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("group-my-vdirs")).toHaveTextContent("Mine"));
  });

  it("renders the browse route for a vdir with its entries", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE])]);
    installFetchMock([
      lsRoute("v1", "docs", [{ name: "a.txt", size: 12, dir: false, modtime: "2026-01-02T00:00:00Z" }]),
    ]);

    renderApp("/v/v1/docs");

    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("docs"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("a.txt"));
  });

  it("renders the settings management routes", async () => {
    installPbMock([
      authRefresh(OWNER),
      collectionList("vdirs", [MINE]),
      collectionList("connections", [{ id: "c1", label: "Box", host: "h", port: 22, username: "u", auth_method: "password", host_key_fingerprint: "fp" }]),
    ]);
    installFetchMock([]);

    const connections = renderApp("/settings/connections");
    await waitFor(() => expect(screen.getByTestId("connections-page")).toBeInTheDocument());
    connections.unmount();

    renderApp("/settings/vdirs");
    await waitFor(() => expect(screen.getByTestId("vdirs-page")).toBeInTheDocument());
  });

  it("renders a catch-all page-not-found", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [])]);
    installFetchMock([]);

    renderApp("/definitely/not/a/route");
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("mounts the shell tab bar across authenticated routes", async () => {
    installPbMock([
      authRefresh(OWNER),
      collectionList("vdirs", [MINE]),
      collectionList("connections", []),
    ]);
    installFetchMock([lsRoute("v1", "", [])]);

    const browse = renderApp("/v/v1");
    await waitFor(() => expect(screen.getByTestId("tab-bar")).toBeInTheDocument());
    browse.unmount();

    renderApp("/settings/connections");
    await waitFor(() => expect(screen.getByTestId("connections-page")).toBeInTheDocument());
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
  });
});

describe("locations grouping", () => {
  it("separates my vdirs from shared with me and marks public", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE, SHARED])]);
    installFetchMock([]);

    renderApp("/files");

    const locations = await screen.findByTestId("locations");
    await waitFor(() => expect(within(locations).getByTestId("group-my-vdirs")).toBeInTheDocument());
    const mine = within(locations).getByTestId("group-my-vdirs");
    expect(within(mine).getByText("Mine")).toBeInTheDocument();
    expect(within(mine).queryByText("Shared")).not.toBeInTheDocument();

    const shared = within(locations).getByTestId("group-shared-with-me");
    expect(within(shared).getByText("Shared")).toBeInTheDocument();
    expect(within(shared).getByTestId("public-badge")).toBeInTheDocument();
  });

  it("shows no connection records to a user with none", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [SHARED]), collectionList("connections", [])]);
    installFetchMock([]);

    renderApp("/settings/connections");

    await waitFor(() => expect(screen.getByText(/No connections yet/)).toBeInTheDocument());
    expect(screen.queryByTestId("connection-row")).not.toBeInTheDocument();
    // The Files list never mentions connections.
    expect(screen.getByTestId("connections-page")).not.toHaveTextContent(/connection record/i);
  });
});

describe("anonymous public browsing gate", () => {
  function publicMeta(vdirId: string, status: number): FetchRoute {
    return (url) =>
      url === `/api/sf/vdirs/${vdirId}/meta`
        ? status === 200
          ? jsonResponse(200, { name: "Public", is_public: true })
          : jsonResponse(404, { message: "Not found." })
        : undefined;
  }

  beforeEach(() => {
    localStorage.clear();
    pb.authStore.clear();
  });

  it("renders the public browse view for an anonymous visitor on a public vdir", async () => {
    installPbMock([]);
    installFetchMock([
      publicMeta("pub", 200),
      lsRoute("pub", "docs", [{ name: "a.txt", size: 3, dir: false, modtime: "2026-01-02T00:00:00Z" }]),
    ]);

    renderApp("/v/pub/docs");

    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("a.txt"));
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("shows the login screen when the probed vdir is not public or unknown", async () => {
    installPbMock([]);
    installFetchMock([publicMeta("priv", 404)]);

    renderApp("/v/priv");

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.queryByTestId("entry-0")).not.toBeInTheDocument();
  });

  it("shows the login screen for anonymous management destinations", async () => {
    installPbMock([]);
    installFetchMock([]);

    for (const path of ["/v/pub/move", "/uploads", "/settings", "/files"]) {
      const view = renderApp(path);
      await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
      view.unmount();
    }
  });

  it("offers no tab bar or sidebar destinations to an anonymous visitor", async () => {
    installPbMock([]);
    installFetchMock([
      publicMeta("pub", 200),
      lsRoute("pub", "", [{ name: "a.txt", size: 3, dir: false, modtime: "2026-01-02T00:00:00Z" }]),
    ]);

    renderApp("/v/pub");

    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("a.txt"));
    expect(screen.queryByTestId("tab-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("side-uploads")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-uploads")).not.toBeInTheDocument();
    expect(screen.queryByTestId("side-settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-settings")).not.toBeInTheDocument();
  });

  it("keeps signed-in flows unchanged on the same routes", async () => {
    pb.authStore.save(fakeJwt(), OWNER as never);
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE])]);
    installFetchMock([lsRoute("v1", "", [])]);

    renderApp("/v/v1");

    await waitFor(() => expect(screen.getByTestId("tab-bar")).toBeInTheDocument());
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});
