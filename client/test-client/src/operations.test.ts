import type { StratofoldClient } from "@stratofold/client";
import { describe, expect, it, vi } from "vitest";

import { formatError, performOperation } from "./operations.js";

function fakeClient(overrides: Record<string, unknown> = {}): StratofoldClient {
  const base = {
    list: vi.fn(async () => [
      { name: "a.txt", size: 3, dir: false, modtime: "2026-01-01T00:00:00Z" },
      { name: "docs", size: 0, dir: true, modtime: "2026-01-01T00:00:00Z" },
    ]),
    read: vi.fn(
      async () =>
        new Response("hello", {
          status: 206,
          headers: { "Content-Length": "5", "Content-Range": "bytes 0-4/10" },
        }),
    ),
    mkdir: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    upload: vi.fn(async (path: string) => ({ path, size: 3 })),
    tokenInfo: vi.fn(async () => ({
      id: "tok1",
      name: "laptop",
      vdir: { id: "v1", name: "Home" },
      role: "viewer" as const,
      expiresAt: null,
      lastUsedAt: null,
      tokenHint: "…abcd",
    })),
    temporaryUrl: vi.fn(async () => ({
      url: "https://files.example.com/s/link",
      expiresAt: "2026-11-10T00:00:00Z",
    })),
    fileUrl: vi.fn((path: string) => `https://files.example.com/files/v1/${path}`),
  };
  return { ...base, ...overrides } as unknown as StratofoldClient;
}

describe("operation dispatch", () => {
  it("lists entries", async () => {
    const client = fakeClient();
    const result = await performOperation(client, { kind: "list", path: "" });
    expect(client.list).toHaveBeenCalledWith("");
    expect(result.summary).toContain("2 entries");
    expect(result.summary).toContain("a.txt");
  });

  it("forwards a range on read and returns the response", async () => {
    const client = fakeClient();
    const result = await performOperation(client, {
      kind: "read",
      path: "a.txt",
      range: "bytes=0-4",
    });
    expect(client.read).toHaveBeenCalledWith("a.txt", {
      headers: { Range: "bytes=0-4" },
    });
    expect(result.response).toBeInstanceOf(Response);
    expect(result.summary).toContain("HTTP 206");
    expect(result.summary).toContain("bytes 0-4/10");
  });

  it("passes no headers when no range is set", async () => {
    const client = fakeClient();
    await performOperation(client, { kind: "read", path: "a.txt" });
    expect(client.read).toHaveBeenCalledWith("a.txt", { headers: undefined });
  });

  it("dispatches mkdir, move, and remove", async () => {
    const client = fakeClient();
    await performOperation(client, { kind: "mkdir", path: "d" });
    await performOperation(client, { kind: "move", from: "a", to: "b" });
    await performOperation(client, { kind: "remove", path: "d" });
    expect(client.mkdir).toHaveBeenCalledWith("d");
    expect(client.move).toHaveBeenCalledWith("a", "b");
    expect(client.remove).toHaveBeenCalledWith("d");
  });

  it("passes upload hooks through and reports the result", async () => {
    const client = fakeClient();
    const onProgress = vi.fn();
    const controller = new AbortController();
    const result = await performOperation(
      client,
      { kind: "upload", path: "up.bin", body: new Blob(["abc"]) },
      { onProgress, signal: controller.signal },
    );
    expect(client.upload).toHaveBeenCalledWith("up.bin", expect.any(Blob), {
      onProgress,
      signal: controller.signal,
    });
    expect(result.summary).toBe("upload up.bin: 3 byte(s)");
  });

  it("summarizes token scope", async () => {
    const client = fakeClient();
    const result = await performOperation(client, { kind: "scope" });
    expect(result.summary).toContain("vdir Home (v1)");
    expect(result.summary).toContain("role viewer");
  });

  it("returns a minted temporary URL", async () => {
    const client = fakeClient();
    const result = await performOperation(client, {
      kind: "temporaryUrl",
      path: "a.txt",
    });
    expect(result.temporaryUrl).toBe("https://files.example.com/s/link");
    expect(result.summary).toContain("until 2026-11-10");
  });

  it("builds a plain file URL without a request", async () => {
    const client = fakeClient();
    const result = await performOperation(client, {
      kind: "fileUrl",
      path: "a.txt",
    });
    expect(result.summary).toBe("https://files.example.com/files/v1/a.txt");
  });
});

describe("error formatting", () => {
  it("shows kind and status", () => {
    const error = Object.assign(new Error("Forbidden"), {
      name: "StratofoldError",
      kind: "forbidden",
      status: 403,
    });
    expect(formatError(error)).toBe("StratofoldError [forbidden 403]: Forbidden");
  });

  it("falls back to name and message", () => {
    expect(formatError(new Error("boom"))).toBe("Error: boom");
    expect(formatError("raw")).toBe("raw");
  });
});
