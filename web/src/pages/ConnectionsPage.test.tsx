import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPage } from "./ConnectionsPage";
import { listOf, installPbMock, type SendHandler } from "../test/mockApi";

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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connections management", () => {
  it("creates a password connection with the typed secret", async () => {
    const store = recordCollection([]);
    installPbMock([store.handler]);
    render(<ConnectionsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-connection"));
    await user.type(screen.getByLabelText("Label"), "Box");
    await user.type(screen.getByLabelText("Host"), "ssh.example.com");
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText(/^Password/), "s3cret");
    await user.type(screen.getByLabelText("Host key fingerprint"), "SHA256:abc");
    await user.click(screen.getByTestId("connection-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    const created = store.calls.find((c) => c.method === "POST")!.body;
    expect(created).toMatchObject({
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
    render(<ConnectionsPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-connection"));
    await user.type(screen.getByLabelText("Label"), "Keybox");
    await user.type(screen.getByLabelText("Host"), "h");
    await user.type(screen.getByLabelText("Username"), "u");
    await user.selectOptions(screen.getByTestId("c-auth"), "key");
    await user.type(screen.getByLabelText(/^Private key/), "-----BEGIN KEY-----");
    await user.type(screen.getByLabelText(/Key passphrase/), "pass");
    await user.type(screen.getByLabelText("Host key fingerprint"), "SHA256:def");
    await user.click(screen.getByTestId("connection-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
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
      // Even if a secret somehow appeared in a record, the form must
      // not surface it; the real server never returns secrets at all.
      password: "SHOULD-NEVER-RENDER",
    };
    const store = recordCollection([existing]);
    installPbMock([store.handler]);
    render(<ConnectionsPage />);

    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("connection-row")).getByText("Edit"));

    const passwordInput = await screen.findByLabelText(/^Password/);
    expect((passwordInput as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("SHOULD-NEVER-RENDER");
    expect(passwordInput).toHaveAttribute("placeholder", "••••••••");

    // Save without typing a secret: the PATCH body omits it.
    await user.click(screen.getByTestId("connection-save"));
    await waitFor(() => expect(store.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(store.calls.find((c) => c.method === "PATCH")!.body).not.toHaveProperty("password");
  });

  it("deletes a connection and drops it from the list", async () => {
    const store = recordCollection([
      { id: "c1", label: "Box", host: "h", port: 22, username: "u", auth_method: "password", host_key_fingerprint: "f" },
    ]);
    installPbMock([store.handler]);
    render(<ConnectionsPage />);

    await waitFor(() => expect(screen.getByTestId("connection-row")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByTestId("delete-connection-c1"));

    await waitFor(() => expect(screen.queryByTestId("connection-row")).not.toBeInTheDocument());
    expect(store.calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});
