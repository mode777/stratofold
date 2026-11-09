import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, setUnauthorizedHandler } from "./filesApi";
import { listTokens, mintToken, revokeToken } from "./tokensApi";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

const TOKEN = {
  id: "t1",
  name: "laptop",
  vdir: "v1",
  vdir_name: "Mine",
  role: "viewer" as const,
  token_hint: "sf_v1_abcdef…1234",
  expires_at: "2026-12-01T00:00:00Z",
  last_used_at: null,
  created: "2026-11-01T00:00:00Z",
};

describe("listTokens", () => {
  it("gets the list and parses metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/sf/tokens");
      return jsonResponse(200, { tokens: [TOKEN] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(listTokens()).resolves.toEqual([TOKEN]);
  });

  it.each([
    [400, "rejected"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
  ] as const)("maps %i to kind %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { message: "boom" })));
    const err = await listTokens().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
    expect((err as ApiFailure).status).toBe(status);
  });
});

describe("mintToken", () => {
  it("posts the scope and parses the one-time token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/tokens");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        vdir: "v1",
        name: "laptop",
        role: "editor",
        expires_at: "2026-12-01T00:00:00Z",
      });
      return jsonResponse(201, { ...TOKEN, role: "editor", token: "sf_v1_secret" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      mintToken({ vdir: "v1", name: "laptop", role: "editor", expires_at: "2026-12-01T00:00:00Z" }),
    ).resolves.toMatchObject({ id: "t1", token: "sf_v1_secret", role: "editor" });
  });

  it("rejects a malformed success body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, { ...TOKEN })));
    const err = await mintToken({ vdir: "v1", name: "laptop", role: "viewer" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe("server");
  });

  it.each([
    [400, "rejected"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
  ] as const)("maps %i to kind %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { message: "boom" })));
    const err = await mintToken({ vdir: "v1", name: "x", role: "viewer" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
  });
});

describe("revokeToken", () => {
  it("deletes the token and resolves on 204", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/tokens/t1");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(revokeToken("t1")).resolves.toBeUndefined();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
  ] as const)("maps %i to kind %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { message: "boom" })));
    const err = await revokeToken("t1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
  });
});
