import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../components/ShareDialog";
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
  return { handler, calls, get records() { return records; } };
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("share dialog", () => {
  it("grants a viewer share by resolving the email to a user id", async () => {
    const store = shareStore([]);
    installPbMock([store.handler]);
    installFetchMock([lookupRoute("grantee@stratofold.test", true)]);

    render(<ShareDialog vdir={VDIR} onClose={vi.fn()} onChanged={vi.fn()} />);
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

  it("changes a share's role", async () => {
    const store = shareStore([{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]);
    installPbMock([store.handler]);
    installFetchMock([]);

    render(<ShareDialog vdir={VDIR} onClose={vi.fn()} onChanged={vi.fn()} />);
    const row = await screen.findByTestId("share-row");
    await userEvent.setup().selectOptions(within(row).getByTestId("share-role-s1"), "editor");

    await waitFor(() => expect(store.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(store.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ role: "editor" });
  });

  it("revokes a share", async () => {
    const store = shareStore([{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }]);
    installPbMock([store.handler]);
    installFetchMock([]);

    render(<ShareDialog vdir={VDIR} onClose={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.setup().click(await screen.findByTestId("share-revoke-s1"));

    await waitFor(() => expect(screen.queryByTestId("share-row")).not.toBeInTheDocument());
    expect(store.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("rejects a self-share before submission", async () => {
    const store = shareStore([]);
    const lookup = installFetchMock([lookupRoute("owner@stratofold.test", true)]);
    installPbMock([store.handler]);

    render(<ShareDialog vdir={VDIR} onClose={vi.fn()} onChanged={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "owner@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent("yourself"));
    expect(lookup).not.toHaveBeenCalled();
    expect(store.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("surfaces the server's duplicate rejection", async () => {
    const store = shareStore([], jsonResponse(400, { message: "Value must be unique." }));
    installPbMock([store.handler]);
    installFetchMock([lookupRoute("grantee@stratofold.test", true)]);

    render(<ShareDialog vdir={VDIR} onClose={vi.fn()} onChanged={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "grantee@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent("unique"));
    expect(screen.queryByTestId("share-row")).not.toBeInTheDocument();
  });

  it("reports an unknown email as an error without creating a share", async () => {
    const store = shareStore([]);
    installPbMock([store.handler]);
    installFetchMock([lookupRoute("nobody@stratofold.test", false)]);

    render(<ShareDialog vdir={VDIR} onClose={vi.fn()} onChanged={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Share with (email)"), "nobody@stratofold.test");
    await user.click(screen.getByTestId("s-grant"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toBeInTheDocument());
    expect(store.calls.some((c) => c.method === "POST")).toBe(false);
  });
});
