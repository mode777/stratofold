import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPage } from "./ConnectionsPage";
import { ConnectionFormPage } from "./ConnectionFormPage";
import { listOf, installPbMock, type SendHandler } from "../test/mockApi";

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: "authenticated",
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

type Call = { method: string; path: string; body: Record<string, unknown> };

function recordCollection(initial: Record<string, unknown>[]) {
  let records = [...initial];
  const calls: Call[] = [];
  const handler: SendHandler = (path, options) => {
    if (!path.includes("/collections/connections/records")) return undefined;
    const method = options.method ?? "GET";
    const body = (options.body ?? {}) as Record<string, unknown>;
    calls.push({ method, path, body });
    switch (method) {
      case "GET":
        return listOf(records);
      case "POST": {
        const record = { id: `c-${records.length + 1}`, ...body };
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

function renderConnections() {
  return render(
    <MemoryRouter initialEntries={["/settings/connections"]}>
      <Routes>
        <Route path="/settings/connections" element={<ConnectionsPage />} />
        <Route path="/settings/connections/:id" element={<ConnectionFormPage />} />
        <Route path="/settings" element={<div>settings destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("connections management", () => {
  it("creates a password connection with the typed secret", async () => {
    const store = recordCollection([]);
    installPbMock([store.handler]);
    renderConnections();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-connection"));
    await user.type(await screen.findByLabelText("Label"), "Box");
    await user.type(screen.getByLabelText("Host"), "ssh.example.com");
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText(/^Password/), "s3cret");
    await user.type(screen.getByLabelText(/Host key fingerprint/), "SHA256:abc");
    await user.click(screen.getByTestId("connection-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      owner: "u1",
      label: "Box",
      host: "ssh.example.com",
      username: "alice",
      auth_method: "password",
      password: "s3cret",
      host_key_fingerprint: "SHA256:abc",
    });
    await waitFor(() => expect(screen.getByTestId("connection-row")).toBeInTheDocument());
  });

  it("creates a key connection with the private key material", async () => {
    const store = recordCollection([]);
    installPbMock([store.handler]);
    renderConnections();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-connection"));
    await user.type(await screen.findByLabelText("Label"), "Keybox");
    await user.type(screen.getByLabelText("Host"), "h");
    await user.type(screen.getByLabelText("Username"), "u");
    await user.click(screen.getByTestId("c-auth-key"));
    await user.type(screen.getByLabelText(/^Private Key/), "-----BEGIN KEY-----");
    await user.type(screen.getByLabelText(/Key Passphrase/), "pass");
    await user.click(screen.getByTestId("connection-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      owner: "u1",
      auth_method: "key",
      private_key: "-----BEGIN KEY-----",
      key_passphrase: "pass",
    });
  });

  it("never renders a stored secret and preserves it when the edit leaves it empty", async () => {
    const existing = {
      id: "c1",
      label: "Box",
      host: "h",
      port: 22,
      username: "u",
      auth_method: "password",
      host_key_fingerprint: "SHA256:x",
      password: "SHOULD-NEVER-RENDER",
    };
    const store = recordCollection([existing]);
    installPbMock([store.handler]);
    renderConnections();

    await userEvent.setup().click(await screen.findByTestId("connection-row"));

    const passwordInput = await screen.findByLabelText(/^Password/);
    expect((passwordInput as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("SHOULD-NEVER-RENDER");
    expect(passwordInput).toHaveAttribute("placeholder", "••••••••");

    await userEvent.setup().click(screen.getByTestId("connection-save"));
    await waitFor(() => expect(store.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(store.calls.find((c) => c.method === "PATCH")!.body).not.toHaveProperty("password");
  });

  it("deletes a connection after confirmation and drops it from the list", async () => {
    const store = recordCollection([
      { id: "c1", label: "Box", host: "h", port: 22, username: "u", auth_method: "password", host_key_fingerprint: "f" },
    ]);
    installPbMock([store.handler]);
    renderConnections();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("connection-row"));
    await user.click(await screen.findByTestId("delete-connection"));
    await user.click(await screen.findByTestId("delete-connection-confirm"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("connection-row")).not.toBeInTheDocument());
  });

  it("creates a connection without a fingerprint and with a remote directory", async () => {
    const store = recordCollection([]);
    installPbMock([store.handler]);
    renderConnections();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-connection"));
    await user.type(await screen.findByLabelText("Label"), "Box");
    await user.type(screen.getByLabelText("Host"), "ssh.example.com");
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText(/^Password/), "s3cret");
    await user.type(screen.getByLabelText("Remote directory"), "/home/");
    await user.click(screen.getByTestId("connection-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      owner: "u1",
      host_key_fingerprint: "",
      remote_dir: "/home/",
    });
    await waitFor(() => expect(within(screen.getByTestId("connection-row")).getByText(/\/home\//)).toBeInTheDocument());
  });
});
