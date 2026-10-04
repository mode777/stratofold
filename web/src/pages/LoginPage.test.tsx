import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { pb } from "../lib/pb";
import {
  authRefresh,
  collectionList,
  installFetchMock,
  installPbMock,
  jsonResponse,
} from "../test/mockApi";

const OWNER = { id: "u1", email: "owner@stratofold.test" };

function fakeJwt(): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${enc({ alg: "none" })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );
}

async function signIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByTestId("login-submit"));
}

beforeEach(() => {
  localStorage.clear();
  pb.authStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("login screen", () => {
  it("shows only the login form to an unauthenticated visitor", async () => {
    installFetchMock([]);
    renderApp();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.queryByText("Connections")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vdir-switcher")).not.toBeInTheDocument();
  });

  it("enters the application on valid credentials", async () => {
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [])]);
    installFetchMock([
      (url, init) =>
        url === "/api/sf/auth" && init?.method === "POST"
          ? jsonResponse(200, { token: fakeJwt(), record: OWNER })
          : undefined,
    ]);

    renderApp();
    await signIn("owner@stratofold.test", "correct");

    await waitFor(() => expect(screen.getByText("Connections")).toBeInTheDocument());
    expect(screen.queryByTestId("login-error")).not.toBeInTheDocument();
  });

  it("stays on the login screen with an error on invalid credentials", async () => {
    installFetchMock([
      (url, init) =>
        url === "/api/sf/auth" && init?.method === "POST"
          ? jsonResponse(400, { message: "Invalid credentials" })
          : undefined,
    ]);

    renderApp();
    await signIn("owner@stratofold.test", "wrong");

    await waitFor(() => expect(screen.getByTestId("login-error")).toHaveTextContent("Invalid credentials"));
    expect(screen.queryByText("Connections")).not.toBeInTheDocument();
  });

  it("returns to login when a session is rejected during use", async () => {
    const MINE = { id: "v1", owner: "u1", name: "Mine", root_path: "/x", is_public: false, connection: "c1" };
    pb.authStore.save(fakeJwt(), OWNER as never);
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [MINE])]);
    // Every /api/sf call 401s (expired/invalidated session).
    installFetchMock([
      (url) => (url.startsWith("/api/sf/") ? jsonResponse(401, { message: "Invalid or expired session" }) : undefined),
    ]);

    renderApp();
    await waitFor(() => expect(screen.getByText("Connections")).toBeInTheDocument());

    // The app's home redirects into a browse, whose ls 401 flips the
    // session back to the login screen.
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument(), { timeout: 3000 });
    expect(pb.authStore.isValid).toBe(false);
  });
});

describe("logout", () => {
  it("calls DELETE /api/sf/auth and returns to login with no stored credentials", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    pb.authStore.save(fakeJwt(), OWNER as never);
    installPbMock([authRefresh(OWNER), collectionList("vdirs", [])]);
    installFetchMock([
      (url, init) => {
        calls.push({ url, method: init?.method });
        if (url === "/api/sf/auth" && init?.method === "DELETE") {
          return new Response(null, { status: 200 });
        }
        return undefined;
      },
    ]);

    renderApp();
    await waitFor(() => expect(screen.getByText("Connections")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByTestId("logout"));

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(calls).toContainEqual({ url: "/api/sf/auth", method: "DELETE" });
    expect(pb.authStore.isValid).toBe(false);
    expect(pb.authStore.token).toBe("");
  });
});
