import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientResponseError } from "pocketbase";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharingPage } from "./SharingPage";
import { installFetchMock, installPbMock, jsonResponse, listOf, type SendHandler } from "../test/mockApi";

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: "authenticated",
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const VDIR = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };

type Call = { method: string; path: string; body: Record<string, unknown> };

function shareStore(initial: Record<string, unknown>[], createError?: Response) {
  let records = [...initial];
  const calls: Call[] = [];
  const handler: SendHandler = (path, options) => {
    if (!path.includes("/collections/vdir_shares/records")) return undefined;
    const method = options.method ?? "GET";
    const body = (options.body ?? {}) as Record<string, unknown>;
    calls.push({ method, path, body });
    switch (method) {
      case "GET":
        return listOf(records);
      case "POST": {
        if (createError) {
          throw Object.assign(new Error("Value must be unique."), {
            status: 400,
            response: { message: "Value must be unique." },
          });
        }
        const record = { id: `s-${records.length + 1}`, ...body };
        records = [...records, record];
        return record;
      }
      case "PATCH":
        return {};
      case "DELETE": {
        const id = path.split("/").pop();
        records = records.filter((r) => r.id !== id);
        return true;
      }
      default:
        return undefined;
    }
  };
  return { handler, calls };
}

function lookupRoute(email: string, found: boolean) {
  return (url: string) => {
    if (url.startsWith("/api/sf/users/lookup")) {
      const asked = decodeURIComponent(url.split("email=")[1] ?? "");
      if (found && asked === email) return jsonResponse(200, { id: "u2", email });
      return jsonResponse(404, { message: "No user with this email" });
    }
    return undefined;
  };
}

function renderSharing() {
  return render(
    <MemoryRouter initialEntries={["/settings/vdirs/v1/sharing"]}>
      <Routes>
        <Route path="/settings/vdirs/:id/sharing" element={<SharingPage />} />
        <Route path="/settings/vdirs/:id" element={<div>vdir form</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function vdirHandler(): SendHandler {
  return (path) => (path.includes("/collections/vdirs/records") ? listOf([VDIR]) : undefined);
}

// vdirStore is a stateful vdir record transport: PATCH applies the body
// so the page's refetch observes the new public name, and an optional
// error models the server's duplicate-name rejection.
function vdirStore(initial: Record<string, unknown>, patchError?: unknown) {
  let vdir = { ...initial };
  const calls: Call[] = [];
  const handler: SendHandler = (path, options) => {
    if (!path.includes("/collections/vdirs/records")) return undefined;
    const method = options.method ?? "GET";
    if (method === "GET") return listOf([vdir]);
    if (method === "PATCH") {
      const body = (options.body ?? {}) as Record<string, unknown>;
      calls.push({ method, path, body });
      if (patchError) throw patchError;
      vdir = { ...vdir, ...body };
      return vdir;
    }
    return undefined;
  };
  return { handler, calls };
}

function duplicateNameError(): ClientResponseError {
  return new ClientResponseError({
    status: 400,
    response: {
      code: 400,
      message: "Failed to update record.",
      data: {
        public_slug: {
          code: "validation_not_unique",
          message: "This public name is already taken.",
        },
      },
    },
  });
}

function renderWithVdirs(handlers: SendHandler[]) {
  installPbMock([...handlers, (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined)]);
  installFetchMock([]);
  return render(
    <MemoryRouter initialEntries={["/settings/vdirs/v1/sharing"]}>
      <Routes>
        <Route path="/settings/vdirs/:id/sharing" element={<SharingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sharing page", () => {
  it("grants a viewer share by resolving the email to a user id", async () => {
    const store = shareStore([]);
    installPbMock([vdirHandler(), store.handler]);
    installFetchMock([lookupRoute("grantee@stratofold.test", true)]);

    renderSharing();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "grantee@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      vdir: "v1",
      user: "u2",
      role: "viewer",
    });
    await waitFor(() => expect(screen.getByTestId("share-row")).toBeInTheDocument());
  });

  it("grants an editor share when the editor role is selected", async () => {
    const store = shareStore([]);
    installPbMock([vdirHandler(), store.handler]);
    installFetchMock([lookupRoute("grantee@stratofold.test", true)]);

    renderSharing();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "grantee@stratofold.test");
    await user.click(screen.getByTestId("s-role-editor"));
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({ role: "editor" });
  });

  it("changes a share's role", async () => {
    const store = shareStore([{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]);
    installPbMock([vdirHandler(), store.handler]);
    installFetchMock([]);

    renderSharing();
    const row = await screen.findByTestId("share-row");
    await userEvent.setup().selectOptions(within(row).getByTestId("share-role-s1"), "editor");

    await waitFor(() => expect(store.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(store.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ role: "editor" });
  });

  it("revokes a share", async () => {
    const store = shareStore([{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]);
    installPbMock([vdirHandler(), store.handler]);
    installFetchMock([]);

    renderSharing();
    await userEvent.setup().click(await screen.findByTestId("share-revoke-s1"));

    await waitFor(() => expect(screen.queryByTestId("share-row")).not.toBeInTheDocument());
    expect(store.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("rejects a self-share before submission", async () => {
    const store = shareStore([]);
    const lookup = installFetchMock([lookupRoute("owner@stratofold.test", true)]);
    installPbMock([vdirHandler(), store.handler]);

    renderSharing();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "owner@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent("yourself"));
    expect(lookup).not.toHaveBeenCalled();
    expect(store.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("surfaces the server's duplicate rejection", async () => {
    const store = shareStore([], jsonResponse(400, { message: "Value must be unique." }));
    installPbMock([vdirHandler(), store.handler]);
    installFetchMock([lookupRoute("grantee@stratofold.test", true)]);

    renderSharing();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "grantee@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent("unique"));
    expect(screen.queryByTestId("share-row")).not.toBeInTheDocument();
  });

  it("reports an unknown email as an error without creating a share", async () => {
    const store = shareStore([]);
    installPbMock([vdirHandler(), store.handler]);
    installFetchMock([lookupRoute("nobody@stratofold.test", false)]);

    renderSharing();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "nobody@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument());
    expect(store.calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("sharing page public link", () => {
  function vdirRecord(isPublic: boolean) {
    return { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: isPublic, connection: "c1" };
  }

  function renderWith(isPublic: boolean) {
    installPbMock([
      (path) => (path.includes("/collections/vdirs/records") ? listOf([vdirRecord(isPublic)]) : undefined),
      (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined),
    ]);
    installFetchMock([]);
    return render(
      <MemoryRouter initialEntries={["/settings/vdirs/v1/sharing"]}>
        <Routes>
          <Route path="/settings/vdirs/:id/sharing" element={<SharingPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the absolute browse link with a working copy action for a public vdir", async () => {
    renderWith(true);

    const link = await screen.findByTestId("public-link");
    expect(link).toHaveTextContent(`${window.location.origin}/v/v1`);
    expect(screen.getByTestId("public-link-copy")).toBeInTheDocument();

    // user-event stubs the navigator clipboard; reading it back
    // asserts the copy action really published the URL.
    await userEvent.setup().click(screen.getByTestId("public-link-copy"));

    await waitFor(() => expect(screen.getByTestId("public-link-copied")).toBeInTheDocument());
    await expect(navigator.clipboard.readText()).resolves.toBe(`${window.location.origin}/v/v1`);
  });

  it("states that no public link exists for a non-public vdir", async () => {
    renderWith(false);

    await screen.findByTestId("public-link-section");
    expect(screen.getByTestId("public-link-none")).toBeInTheDocument();
    expect(screen.queryByTestId("public-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-link-copy")).not.toBeInTheDocument();
  });
});

describe("sharing page public name", () => {
  const BASE = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", connection: "c1" };

  it("claims a lowercase name and shows the pretty public link", async () => {
    const store = vdirStore({ ...BASE, is_public: true });
    renderWithVdirs([store.handler]);

    const input = await screen.findByTestId("public-name-input");
    await userEvent.setup().type(input, "My-Folder");
    expect(input).toHaveValue("my-folder");

    await userEvent.setup().click(screen.getByTestId("public-name-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(store.calls.find((c) => c.method === "PATCH")!.body).toEqual({ public_slug: "my-folder" });
    await waitFor(() =>
      expect(screen.getByTestId("public-link")).toHaveTextContent(`${window.location.origin}/apps/my-folder`),
    );
  });

  it("changes and releases an existing name", async () => {
    const store = vdirStore({ ...BASE, is_public: true, public_slug: "old-name" });
    renderWithVdirs([store.handler]);

    const input = await screen.findByTestId("public-name-input");
    await waitFor(() => expect(input).toHaveValue("old-name"));
    await userEvent.setup().clear(input);
    await userEvent.setup().type(input, "new-name");
    await userEvent.setup().click(screen.getByTestId("public-name-save"));

    await waitFor(() =>
      expect(store.calls.find((c) => c.method === "PATCH")!.body).toEqual({ public_slug: "new-name" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("public-link")).toHaveTextContent(`${window.location.origin}/apps/new-name`),
    );

    await userEvent.setup().click(screen.getByTestId("public-name-remove"));
    await waitFor(() =>
      expect(store.calls[store.calls.length - 1].body).toEqual({ public_slug: "" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("public-link")).toHaveTextContent(`${window.location.origin}/v/v1`),
    );
  });

  it("refuses invalid input before sending an update", async () => {
    const store = vdirStore({ ...BASE, is_public: true });
    renderWithVdirs([store.handler]);

    const input = await screen.findByTestId("public-name-input");
    await userEvent.setup().type(input, "a");
    await userEvent.setup().click(screen.getByTestId("public-name-save"));

    await waitFor(() => expect(screen.getByTestId("public-name-error")).toHaveTextContent("2–63"));
    expect(store.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("surfaces a duplicate name without changing the link", async () => {
    const store = vdirStore({ ...BASE, is_public: true, public_slug: "mine" }, duplicateNameError());
    renderWithVdirs([store.handler]);

    const input = await screen.findByTestId("public-name-input");
    await waitFor(() => expect(input).toHaveValue("mine"));
    await userEvent.setup().clear(input);
    await userEvent.setup().type(input, "taken");
    await userEvent.setup().click(screen.getByTestId("public-name-save"));

    await waitFor(() =>
      expect(screen.getByTestId("public-name-error")).toHaveTextContent("already taken"),
    );
    expect(screen.getByTestId("public-link")).toHaveTextContent(`${window.location.origin}/apps/mine`);
  });

  it("describes a name on a private vdir as reserved", async () => {
    const store = vdirStore({ ...BASE, is_public: false, public_slug: "reserved-name" });
    renderWithVdirs([store.handler]);

    await screen.findByTestId("public-name-reserved");
    expect(screen.getByTestId("public-name-reserved")).toHaveTextContent("reserved");
    expect(screen.getByTestId("public-link-reserved")).toHaveTextContent("/apps/reserved-name");
    expect(screen.queryByTestId("public-link")).not.toBeInTheDocument();
  });

  it("offers the control only to the vdir owner", async () => {
    const store = vdirStore({ ...BASE, owner: "u2", is_public: true });
    renderWithVdirs([store.handler]);

    await screen.findByTestId("public-link-section");
    expect(screen.queryByTestId("public-name-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-name-input")).not.toBeInTheDocument();
  });
});
