import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VdirsPage } from "./VdirsPage";
import { VdirFormPage } from "./VdirFormPage";
import { SharingPage } from "./SharingPage";
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

function vdirStore(initial: Record<string, unknown>[]) {
  let records = [...initial];
  const calls: Call[] = [];
  const handler: SendHandler = (path, options) => {
    if (!path.includes("/collections/vdirs/records")) return undefined;
    const method = options.method ?? "GET";
    const body = (options.body ?? {}) as Record<string, unknown>;
    calls.push({ method, path, body });
    switch (method) {
      case "GET":
        return listOf(records);
      case "POST": {
        const record = { id: `v-${records.length + 1}`, ...body };
        records = [...records, record];
        return record;
      }
      case "PATCH": {
        const id = path.split("/").pop();
        records = records.map((r) => (r.id === id ? { ...r, ...body } : r));
        return {};
      }
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

const CONNECTIONS = [
  { id: "c1", label: "Box A", host: "a", port: 22, username: "u", auth_method: "password", host_key_fingerprint: "f", remote_dir: "/home/" },
  { id: "c2", label: "Box B", host: "b", port: 22, username: "u", auth_method: "password", host_key_fingerprint: "f" },
];

function connectionsHandler(): SendHandler {
  return (path) => (path.includes("/collections/connections/records") ? listOf(CONNECTIONS) : undefined);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/settings/vdirs"]}>
      <Routes>
        <Route path="/settings/vdirs" element={<VdirsPage />} />
        <Route path="/settings/vdirs/:id" element={<VdirFormPage />} />
        <Route path="/settings/vdirs/:id/sharing" element={<SharingPage />} />
        <Route path="/settings" element={<div>settings destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("vdirs management", () => {
  it("lists only own vdirs and creates one on an own connection", async () => {
    const own = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };
    const foreign = { id: "v2", owner: "u2", name: "NotMine", root_path: "/x", is_public: false, connection: "c2" };
    const store = vdirStore([own, foreign]);
    installPbMock([store.handler, connectionsHandler(), (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined)]);

    renderPage();
    await waitFor(() => expect(screen.getByTestId("vdir-row")).toBeInTheDocument());
    expect(screen.getByTestId("vdirs-page")).not.toHaveTextContent("NotMine");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-vdir"));
    await user.type(await screen.findByLabelText("Name"), "NewVdir");
    await user.type(screen.getByLabelText("Root Path"), "/data");
    await user.selectOptions(screen.getByTestId("v-connection"), "c2");
    await user.click(screen.getByTestId("vdir-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      owner: "u1",
      name: "NewVdir",
      root_path: "/data",
      connection: "c2",
      is_public: false,
    });
  });

  it("prefills the root path from the selected connection's remote directory", async () => {
    const store = vdirStore([]);
    installPbMock([store.handler, connectionsHandler(), (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined)]);
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-vdir"));
    await user.type(await screen.findByLabelText("Name"), "Prefilled");
    await user.selectOptions(screen.getByTestId("v-connection"), "c1");
    const root = screen.getByLabelText("Root Path") as HTMLInputElement;
    expect(root.value).toBe("/home/");

    await user.clear(root);
    await user.type(root, "/custom");
    await user.selectOptions(screen.getByTestId("v-connection"), "c2");
    expect(root.value).toBe("/custom");

    await user.click(screen.getByTestId("vdir-save"));
    await waitFor(() => expect(store.calls.some((c) => c.method === "POST")).toBe(true));
    expect(store.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      owner: "u1",
      root_path: "/custom",
      connection: "c2",
    });
  });

  it("offers only the user's own connections for binding", async () => {
    installPbMock([
      (path) => (path.includes("/collections/vdirs/records") ? listOf([]) : undefined),
      connectionsHandler(),
      (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined),
    ]);
    renderPage();

    await userEvent.setup().click(screen.getByTestId("new-vdir"));
    const select = await screen.findByTestId("v-connection");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options[0]).toBe("Choose a connection");
    expect(options.slice(1)).toEqual(["Box A", "Box B"]);
  });

  it("toggles is_public and shows the public marking after save", async () => {
    const own = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };
    const store = vdirStore([own]);
    installPbMock([store.handler, connectionsHandler(), (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined)]);

    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("vdir-row"));
    await user.click(await screen.findByTestId("v-public"));
    await user.click(screen.getByTestId("vdir-save"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(store.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ is_public: true });
    await waitFor(() => expect(screen.getByTestId("vdir-row")).toHaveTextContent("Public"));
  });

  it("deletes a vdir after confirmation and drops it from the list", async () => {
    const own = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };
    const store = vdirStore([own]);
    installPbMock([store.handler, connectionsHandler(), (path) => (path.includes("/collections/vdir_shares/records") ? listOf([]) : undefined)]);

    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("vdir-row"));
    await user.click(await screen.findByTestId("delete-vdir"));
    await user.click(await screen.findByTestId("delete-vdir-confirm"));

    await waitFor(() => expect(store.calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("vdir-row")).not.toBeInTheDocument());
  });
});
