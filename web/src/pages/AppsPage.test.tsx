import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppsPage } from "./AppsPage";
import {
  collectionList,
  installFetchMock,
  installPbMock,
  jsonResponse,
  type FetchRoute,
} from "../test/mockApi";
import type { VdirToken } from "../lib/tokensApi";

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: "authenticated",
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const MINE = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };
const SHARED = { id: "v2", owner: "u2", name: "Shared", root_path: "/srv/shared", is_public: false, connection: "c2" };

const TOKEN: VdirToken = {
  id: "t1",
  name: "Laptop",
  vdir: "v1",
  vdir_name: "Mine",
  role: "viewer",
  token_hint: "sf_v1_abcdef…1234",
  expires_at: null,
  last_used_at: null,
  created: "2026-11-01T00:00:00Z",
};

function pbMocks(shareRole: "viewer" | "editor" = "viewer") {
  return [
    collectionList("vdirs", [MINE, SHARED]),
    collectionList("vdir_shares", [{ id: "s1", vdir: "v2", user: "u1", role: shareRole }]),
  ];
}

function tokenStore(
  initial: VdirToken[],
  options: {
    mintStatus?: number;
    mintMessage?: string;
    deleteStatus?: number;
    deleteMessage?: string;
  } = {},
) {
  let tokens = [...initial];
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
  const route: FetchRoute = (url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/sf/tokens" && method === "GET") {
      calls.push({ method });
      return jsonResponse(200, { tokens });
    }
    if (url === "/api/sf/tokens" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ method, body });
      if (options.mintStatus) {
        return jsonResponse(options.mintStatus, { message: options.mintMessage ?? "mint failed" });
      }
      const created = {
        id: `t${tokens.length + 1}`,
        name: String(body.name),
        vdir: String(body.vdir),
        vdir_name: body.vdir === "v1" ? "Mine" : "Shared",
        role: body.role,
        token_hint: "sf_v1_new…9999",
        expires_at: (body.expires_at as string | undefined) ?? null,
        last_used_at: null,
        created: "2026-11-09T00:00:00Z",
        token: "sf_v1_secret",
      } as VdirToken & { token: string };
      tokens = [created, ...tokens];
      return jsonResponse(201, created);
    }
    if (url.startsWith("/api/sf/tokens/") && method === "DELETE") {
      calls.push({ method });
      if (options.deleteStatus) {
        return jsonResponse(options.deleteStatus, { message: options.deleteMessage ?? "delete failed" });
      }
      const id = url.split("/").pop();
      tokens = tokens.filter((token) => token.id !== id);
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
  return { route, calls };
}

function renderApps() {
  return render(
    <MemoryRouter initialEntries={["/settings/apps"]}>
      <Routes>
        <Route path="/settings/apps" element={<AppsPage />} />
        <Route path="/settings" element={<div data-testid="settings-placeholder">settings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function loadApps() {
  renderApps();
  await screen.findByTestId("apps-page");
  return userEvent.setup();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("connected apps", () => {
  it("lists metadata and never renders a secret", async () => {
    const store = tokenStore([TOKEN]);
    installPbMock(pbMocks());
    installFetchMock([store.route]);

    await loadApps();
    const row = await screen.findByTestId("token-row");
    expect(row).toHaveTextContent("Laptop");
    expect(row).toHaveTextContent("Mine · viewer");
    expect(row).toHaveTextContent("sf_v1_abcdef…1234");
    expect(row).toHaveTextContent("Expires Never");
    expect(row).toHaveTextContent("Last used Never");
    expect(screen.queryByText("sf_v1_secret")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no tokens", async () => {
    installPbMock(pbMocks());
    installFetchMock([tokenStore([]).route]);
    await loadApps();
    expect(await screen.findByTestId("state-empty")).toHaveTextContent("No connected apps");
  });

  it("maps a load failure to the retryable state", async () => {
    installPbMock(pbMocks());
    installFetchMock([() => jsonResponse(503, { message: "unavailable" })]);
    await loadApps();
    expect(await screen.findByTestId("state-retryable")).toHaveTextContent("Temporarily unavailable");
  });

  it("caps the role at the user's effective role", async () => {
    installPbMock(pbMocks("viewer"));
    installFetchMock([tokenStore([]).route]);
    const user = await loadApps();

    expect(await screen.findByTestId("token-role-editor")).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("token-vdir"), "v2");
    await waitFor(() => expect(screen.queryByTestId("token-role-editor")).not.toBeInTheDocument());
    expect(screen.getByTestId("token-role-viewer")).toBeChecked();
  });

  it("offers editor on a shared editor vdir", async () => {
    installPbMock(pbMocks("editor"));
    installFetchMock([tokenStore([]).route]);
    const user = await loadApps();
    await user.selectOptions(screen.getByTestId("token-vdir"), "v2");
    expect(await screen.findByTestId("token-role-editor")).toBeInTheDocument();
  });

  it("mints a token, shows it once, copies it, and clears it on dismiss", async () => {
    const store = tokenStore([]);
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.type(await screen.findByTestId("token-name"), "Photo sync");
    await user.selectOptions(screen.getByTestId("token-expiry"), "never");
    await user.click(screen.getByTestId("token-mint"));

    const panel = await screen.findByTestId("minted-token-panel");
    expect(panel).toHaveTextContent("won't be shown again");
    expect(screen.getByTestId("minted-token")).toHaveTextContent("sf_v1_secret");
    const post = store.calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ vdir: "v1", name: "Photo sync", role: "viewer" });
    expect(post?.body?.expires_at).toBeUndefined();

    await user.click(screen.getByTestId("copy-token"));
    await expect(navigator.clipboard.readText()).resolves.toBe("sf_v1_secret");
    expect(screen.getByTestId("copy-token")).toHaveTextContent("Copied");

    await user.click(screen.getByTestId("dismiss-token"));
    expect(screen.queryByTestId("minted-token-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("sf_v1_secret")).not.toBeInTheDocument();
  });

  it("sends the expiry when a preset is chosen and caps a shared viewer to viewer", async () => {
    const store = tokenStore([]);
    installPbMock(pbMocks("viewer"));
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.selectOptions(await screen.findByTestId("token-vdir"), "v2");
    await user.type(screen.getByTestId("token-name"), "Shared sync");
    await user.selectOptions(screen.getByTestId("token-expiry"), "7");
    await user.click(screen.getByTestId("token-mint"));

    await screen.findByTestId("minted-token-panel");
    const post = store.calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ vdir: "v2", name: "Shared sync", role: "viewer" });
    expect(post?.body?.expires_at).toEqual(expect.any(String));
  });

  it("reports a copy failure without claiming success", async () => {
    const store = tokenStore([]);
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));

    await user.type(await screen.findByTestId("token-name"), "Photo sync");
    await user.click(screen.getByTestId("token-mint"));
    await screen.findByTestId("minted-token-panel");
    await user.click(screen.getByTestId("copy-token"));

    expect(await screen.findByTestId("token-copy-error")).toHaveTextContent("select the token manually");
    expect(screen.getByTestId("copy-token")).toHaveTextContent("Copy token");
  });

  it("does not submit an empty name", async () => {
    const store = tokenStore([]);
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.type(await screen.findByTestId("token-name"), "   ");
    await user.click(screen.getByTestId("token-mint"));
    expect(await screen.findByTestId("token-error")).toHaveTextContent("Give the token a name");
    expect(store.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("revokes a token after confirmation and updates the list", async () => {
    const store = tokenStore([TOKEN]);
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.click(await screen.findByTestId("token-revoke-t1"));
    expect(screen.getByTestId("alert")).toHaveTextContent("Laptop");
    await user.click(screen.getByTestId("token-revoke-confirm"));

    await waitFor(() => expect(store.calls.some((call) => call.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("token-row")).not.toBeInTheDocument());
  });

  it("does not revoke when the confirmation is cancelled", async () => {
    const store = tokenStore([TOKEN]);
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.click(await screen.findByTestId("token-revoke-t1"));
    await user.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("alert")).not.toBeInTheDocument();
    expect(store.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("surfaces a not-found revoke failure", async () => {
    const store = tokenStore([TOKEN], { deleteStatus: 404, deleteMessage: "Token not found" });
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.click(await screen.findByTestId("token-revoke-t1"));
    await user.click(screen.getByTestId("token-revoke-confirm"));
    expect(await screen.findByTestId("state-notfound")).toHaveTextContent("Not found");
  });

  it("surfaces a retryable revoke failure", async () => {
    const store = tokenStore([TOKEN], { deleteStatus: 503, deleteMessage: "unavailable" });
    installPbMock(pbMocks());
    installFetchMock([store.route]);
    const user = await loadApps();

    await user.click(await screen.findByTestId("token-revoke-t1"));
    await user.click(screen.getByTestId("token-revoke-confirm"));
    expect(await screen.findByTestId("state-retryable")).toHaveTextContent("Temporarily unavailable");
  });

  it("navigates back to Settings", async () => {
    installPbMock(pbMocks());
    installFetchMock([tokenStore([]).route]);
    const user = await loadApps();
    await user.click(screen.getByTestId("apps-back"));
    expect(await screen.findByTestId("settings-placeholder")).toBeInTheDocument();
  });
});
