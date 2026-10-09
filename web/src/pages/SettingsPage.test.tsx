import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { ConnectionsPage } from "./ConnectionsPage";
import { VdirsPage } from "./VdirsPage";
import { listOf, installPbMock } from "../test/mockApi";

const mocks = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    state: "authenticated",
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: mocks.logout,
  }),
}));

const MINE = { id: "v1", owner: "u1", name: "Mine", root_path: "/srv", is_public: false, connection: "c1" };

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/connections" element={<ConnectionsPage />} />
        <Route path="/settings/vdirs" element={<VdirsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.logout.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("settings", () => {
  it("shows the account identity, counts, and navigates into each section", async () => {
    installPbMock([
      (path) => (path.includes("/collections/vdirs/records") ? listOf([MINE]) : undefined),
      (path) => (path.includes("/collections/connections/records") ? listOf([]) : undefined),
    ]);
    renderSettings();

    await waitFor(() => expect(screen.getByTestId("settings-page")).toHaveTextContent("owner@stratofold.test"));

    const user = userEvent.setup();
    await user.click(screen.getByTestId("settings-connections"));
    await waitFor(() => expect(screen.getByTestId("connections-page")).toBeInTheDocument());

    await user.click(screen.getByText("Settings"));
    await user.click(await screen.findByTestId("settings-vdirs"));
    await waitFor(() => expect(screen.getByTestId("vdirs-page")).toBeInTheDocument());
  });

  it("confirms before signing out on all devices", async () => {
    installPbMock([
      (path) => (path.includes("/collections/vdirs/records") ? listOf([MINE]) : undefined),
      (path) => (path.includes("/collections/connections/records") ? listOf([]) : undefined),
    ]);
    renderSettings();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("settings-signout"));
    expect(await screen.findByText(/signed out on all devices/)).toBeInTheDocument();
    await user.click(screen.getByTestId("signout-confirm"));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
