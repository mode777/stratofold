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
  it("redirects / to the first vdir and browses it", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE, SHARED])]);
    installFetchMock([lsRoute("v1", "", [{ name: "docs", size: 0, dir: true, modtime: "2026-01-01T00:00:00Z" }])]);

    renderApp("/");

    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Mine"));
    await waitFor(() => expect(screen.getByTestId("entry-0")).toHaveTextContent("docs"));
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

  it("renders the connections and vdirs management routes", async () => {
    installPbMock([
      authRefresh(OWNER),
      collectionList("vdirs", [MINE]),
      collectionList("connections", [{ id: "c1", label: "Box", host: "h", port: 22, username: "u", auth_method: "password", host_key_fingerprint: "fp" }]),
    ]);
    installFetchMock([]);

    renderApp("/connections");
    await waitFor(() => expect(screen.getByTestId("connections-page")).toBeInTheDocument());

    renderApp("/vdirs");
    await waitFor(() => expect(screen.getByTestId("vdirs-page")).toBeInTheDocument());
  });

  it("renders a catch-all not-found page", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [])]);
    installFetchMock([]);

    renderApp("/definitely/not/a/route");
    await waitFor(() => expect(screen.getByText("Page not found")).toBeInTheDocument());
  });

  it("mounts the upload panel across authenticated routes", async () => {
    installPbMock([
      authRefresh(OWNER),
      collectionList("vdirs", [MINE]),
      collectionList("connections", []),
    ]);
    installFetchMock([lsRoute("v1", "", [])]);

    const browse = renderApp("/v/v1");
    await waitFor(() => expect(screen.getByTestId("upload-panel")).toBeInTheDocument());
    browse.unmount();

    renderApp("/connections");
    await waitFor(() => expect(screen.getByTestId("connections-page")).toBeInTheDocument());
    expect(screen.getByTestId("upload-panel")).toBeInTheDocument();
  });
});

describe("vdir switcher grouping", () => {
  it("separates my vdirs from shared with me and marks public", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE, SHARED])]);
    installFetchMock([lsRoute("v1", "", [])]);

    renderApp("/v/v1");

    const switcher = await screen.findByTestId("vdir-switcher");
    const mine = within(switcher).getByTestId("group-my-vdirs");
    expect(within(mine).getByText("Mine")).toBeInTheDocument();
    expect(within(mine).queryByText("Shared")).not.toBeInTheDocument();

    const shared = within(switcher).getByTestId("group-shared-with-me");
    expect(within(shared).getByText("Shared")).toBeInTheDocument();
    expect(within(shared).getByTestId("public-badge")).toBeInTheDocument();
  });

  it("shows no connection records to a user with none", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [SHARED]), collectionList("connections", [])]);
    installFetchMock([]);

    renderApp("/connections");

    await waitFor(() => expect(screen.getByText(/No connections yet/)).toBeInTheDocument());
    expect(screen.queryByTestId("connection-row")).not.toBeInTheDocument();
    // The switcher itself never mentions connections.
    const switcher = screen.getByTestId("vdir-switcher");
    expect(switcher).not.toHaveTextContent(/connection/i);
  });
});
