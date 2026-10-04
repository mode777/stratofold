import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ls } from "./filesApi";
import { pb } from "./pb";
import { SessionProvider, useSession } from "./session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A syntactically valid, unexpired JWT — authStore.isValid decodes the
// payload and rejects anything else as expired.
function fakeJwt(): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ exp })}.sig`;
}

function Probe(): React.ReactElement {
  const { state, userEmail } = useSession();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="email">{userEmail}</span>
    </div>
  );
}

function LoginFormProbe(): React.ReactElement {
  const { state, login, logout } = useSession();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="state">{state}</span>
      {error && <span data-testid="login-error">{error}</span>}
      <button
        type="button"
        data-testid="do-login"
        onClick={() =>
          void login("user@stratofold.test", "pw").catch((e: unknown) =>
            setError(e instanceof Error ? e.message : "failed"),
          )
        }
      >
        Do login
      </button>
      <button type="button" data-testid="do-logout" onClick={() => void logout()}>
        Do logout
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  pb.authStore.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SessionProvider bootstrap", () => {
  it("starts anonymous with no stored session", async () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("validates a persisted store with authRefresh", async () => {
    pb.authStore.save(fakeJwt(), { id: "u1", email: "user@stratofold.test" } as never);
    // pb.collection() returns a fresh object per call — spy on the
    // client's transport instead; authRefresh POSTs auth-refresh.
    const send = vi.spyOn(pb, "send").mockResolvedValue({
      token: fakeJwt(),
      record: { id: "u1", email: "user@stratofold.test" },
    });
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("authenticated"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("email")).toHaveTextContent("user@stratofold.test");
  });

  it("falls back to anonymous when authRefresh rejects", async () => {
    pb.authStore.save(fakeJwt(), { id: "u1", email: "user@stratofold.test" } as never);
    vi.spyOn(pb, "send").mockRejectedValue(Object.assign(new Error("401"), { status: 401 }));
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });
});

describe("login", () => {
  it("posts to /api/sf/auth and enters authenticated state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/auth");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        identity: "user@stratofold.test",
        password: "pw",
      });
      return jsonResponse(200, {
        token: "tok-2",
        record: { id: "u1", email: "user@stratofold.test" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <SessionProvider>
        <LoginFormProbe />
      </SessionProvider>,
    );
    await user.click(screen.getByTestId("do-login"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("authenticated"));
    expect(pb.authStore.token).toBe("tok-2");
  });

  it("stays anonymous and surfaces the error on rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { message: "Invalid credentials" })),
    );
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <LoginFormProbe />
      </SessionProvider>,
    );
    await user.click(screen.getByTestId("do-login"));
    await waitFor(() => expect(screen.getByTestId("login-error")).toHaveTextContent("Invalid credentials"));
    expect(screen.getByTestId("state")).toHaveTextContent("anonymous");
  });
});

describe("logout", () => {
  it("calls DELETE /api/sf/auth and returns to anonymous", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        expect(String(input)).toBe("/api/sf/auth");
        return new Response(null, { status: 200 });
      }
      return jsonResponse(200, { token: "tok-3", record: { id: "u1", email: "e@x.y" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <SessionProvider>
        <LoginFormProbe />
      </SessionProvider>,
    );
    await user.click(screen.getByTestId("do-login"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("authenticated"));

    await user.click(screen.getByTestId("do-logout"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
    expect(pb.authStore.isValid).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sf/auth",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("unauthorized interceptor", () => {
  it("routes an API 401 back to anonymous", async () => {
    // Login first (state authenticated); every other request 401s.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/sf/auth" && init?.method === "POST") {
          return jsonResponse(200, { token: "tok-4", record: { id: "u1", email: "e@x.y" } });
        }
        return jsonResponse(401, {});
      }),
    );

    const user = userEvent.setup();
    render(
      <SessionProvider>
        <LoginFormProbe />
      </SessionProvider>,
    );
    await user.click(screen.getByTestId("do-login"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("authenticated"));

    // An expired-token 401 from a /api/sf call flips the session back.
    await expect(ls("abc", "")).rejects.toMatchObject({ kind: "unauthorized" });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
    expect(pb.authStore.isValid).toBe(false);
  });
});
