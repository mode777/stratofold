import { describe, expect, it } from "vitest";

import { StratofoldClient } from "../src/client.js";
import {
  ConfigurationError,
  StratofoldError,
  UploadCanceled,
} from "../src/errors.js";

type Call = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function fakeFetch(
  handler: (call: Call) => Response | Promise<Response>,
): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init: init ?? {} };
      calls.push(call);
      return handler(call);
    },
  };
}

function client(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<ConstructorParameters<typeof StratofoldClient>[0]> = {},
): StratofoldClient {
  return new StratofoldClient({
    baseUrl: "https://files.example.com",
    vdir: "vdir1",
    token: "sf_v1_secret-token",
    fetch,
    ...overrides,
  });
}

class FakeXhr {
  method = "";
  url = "";
  withCredentials = false;
  status = 0;
  statusText = "";
  responseText = "";
  headers: Record<string, string> = {};
  sent: unknown = null;
  aborts = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborts += 1;
    this.onabort?.();
  }
}

describe("construction and authentication", () => {
  it("requires an absolute http(s) base URL", () => {
    expect(
      () => new StratofoldClient({ baseUrl: "", vdir: "v" }),
    ).toThrow(ConfigurationError);
    expect(
      () => new StratofoldClient({ baseUrl: "/relative", vdir: "v" }),
    ).toThrow(ConfigurationError);
    expect(
      () => new StratofoldClient({ baseUrl: "ftp://files.example.com", vdir: "v" }),
    ).toThrow(ConfigurationError);
    expect(
      () => new StratofoldClient({ baseUrl: "https://files.example.com", vdir: " " }),
    ).toThrow(ConfigurationError);
  });

  it("normalizes trailing slashes on the base URL", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, { entries: [] }));
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com///",
      vdir: "vdir1",
      fetch,
    });
    await c.list("");
    expect(calls[0]?.url).toBe("https://files.example.com/api/sf/vdirs/vdir1/ls");
  });

  it("sends the token only in the Authorization header", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, { entries: [] }),
    );
    const c = client(fetch);
    await c.list("docs");
    const call = calls[0]!;
    expect(call.url).not.toContain("sf_v1_secret-token");
    expect(String(call.init.body)).not.toContain("sf_v1_secret-token");
    const headers = call.init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer sf_v1_secret-token");
    expect(call.init.credentials).toBe("omit");
  });

  it("omits the Authorization header in public mode", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, { entries: [] }),
    );
    const c = client(fetch, { token: undefined });
    await c.list("");
    const headers = calls[0]!.init.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });
});

describe("error classification", () => {
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notfound"],
    [412, "conflict"],
    [400, "rejected"],
    [503, "retryable"],
    [500, "server"],
  ];

  it.each(cases)("maps %i to %s", async (status, kind) => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(status, { message: `status ${status}` }),
    );
    const c = client(fetch);
    const error = await c.list("").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StratofoldError);
    expect((error as StratofoldError).kind).toBe(kind);
    expect((error as StratofoldError).status).toBe(status);
    expect(calls).toHaveLength(1);
  });

  it("maps a transport failure to retryable with status 0", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("failed to fetch");
    });
    const c = client(fetch);
    const error = await c.list("").catch((e: unknown) => e);
    expect((error as StratofoldError).kind).toBe("retryable");
    expect((error as StratofoldError).status).toBe(0);
  });

  it("never retries a failed request", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(503, {}));
    const c = client(fetch);
    await expect(c.list("")).rejects.toBeInstanceOf(StratofoldError);
    expect(calls).toHaveLength(1);
  });
});

describe("listening and reading", () => {
  it("lists the root and nested paths", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, {
        entries: [
          {
            name: "a.txt",
            size: 3,
            dir: false,
            modtime: "2026-01-01T00:00:00Z",
            version: "v1-listed",
          },
        ],
      }),
    );
    const c = client(fetch);
    const entries = await c.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("a.txt");
    expect(entries[0]?.version).toBe("v1-listed");
    expect(calls[0]?.url).toBe("https://files.example.com/api/sf/vdirs/vdir1/ls");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ path: "" });

    await c.list("docs/sub");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ path: "docs/sub" });
  });

  it("reads through the file server and forwards range headers", async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response("hello", {
          status: 206,
          headers: { "Content-Range": "bytes 0-4/10" },
        }),
    );
    const c = client(fetch);
    const resp = await c.read("docs/a.txt", {
      headers: { Range: "bytes=0-4" },
    });
    expect(resp.status).toBe(206);
    expect(await resp.text()).toBe("hello");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/files/vdir1/docs/a.txt",
    );
    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get("Range")).toBe("bytes=0-4");
    expect(headers.get("Authorization")).toBe("Bearer sf_v1_secret-token");
  });

  it("encodes virtual path segments without normalizing them", async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(200));
    const c = client(fetch);
    await c.read("a b/../c#d.txt");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/files/vdir1/a%20b/../c%23d.txt",
    );
  });

  it("maps a missing read to notfound", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(404, { message: "Not found" }));
    const c = client(fetch);
    const error = await c.read("missing").catch((e: unknown) => e);
    expect((error as StratofoldError).kind).toBe("notfound");
  });

  it("discovers token scope without returning the plaintext", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, {
        id: "tok1",
        name: "laptop",
        vdir: { id: "vdir1", name: "Home" },
        role: "viewer",
        expires_at: "2026-11-10T00:00:00Z",
        last_used_at: null,
        token_hint: "…abcd",
      }),
    );
    const c = client(fetch);
    const info = await c.tokenInfo();
    expect(calls[0]?.url).toBe("https://files.example.com/api/sf/tokens/me");
    expect(info.vdir).toEqual({ id: "vdir1", name: "Home" });
    expect(info.role).toBe("viewer");
    expect(info.tokenHint).toBe("…abcd");
    expect(JSON.stringify(info)).not.toContain("secret-token");
  });

  it("maps an invalid token to unauthorized", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(401, { message: "Invalid or expired token" }),
    );
    const c = client(fetch);
    const error = await c.tokenInfo().catch((e: unknown) => e);
    expect((error as StratofoldError).kind).toBe("unauthorized");
  });
});

describe("stat", () => {
  it("posts one path and returns the metadata", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, {
        path: "docs/a.txt",
        name: "a.txt",
        kind: "file",
        size: 12,
        mtime: "2026-01-01T00:00:00Z",
        version: "v1-stat",
      }),
    );
    const c = client(fetch);
    const info = await c.stat("docs/a.txt");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/stat",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      path: "docs/a.txt",
    });
    expect(info.kind).toBe("file");
    expect(info.version).toBe("v1-stat");
  });

  it("defaults to the vdir root", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, {
        path: "",
        name: "Home",
        kind: "directory",
        size: 0,
        mtime: "2026-01-01T00:00:00Z",
        version: "v1-root",
      }),
    );
    const c = client(fetch);
    const info = await c.stat();
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ path: "" });
    expect(info.kind).toBe("directory");
    expect(info.size).toBe(0);
  });

  it("forwards the caller signal", async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, {
        path: "",
        name: "Home",
        kind: "directory",
        size: 0,
        mtime: "2026-01-01T00:00:00Z",
        version: "v1-root",
      }),
    );
    const c = client(fetch);
    await c.stat("", { signal: controller.signal });
    expect(calls[0]?.init.signal).toBe(controller.signal);
  });

  it("maps a missing path to notfound", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(404, { message: "Not found" }),
    );
    const c = client(fetch);
    await expect(c.stat("missing")).rejects.toMatchObject({
      kind: "notfound",
      status: 404,
    });
  });
});

describe("mutations", () => {
  it("creates a nested directory with the expected shape", async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const c = client(fetch);
    await c.mkdir("a/b/c");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/mkdir",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ path: "a/b/c" });
  });

  it("moves a path with both paths in the body", async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const c = client(fetch);
    await c.move("old.txt", "new.txt");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/mv",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      path: "old.txt",
      to: "new.txt",
    });
  });

  it("removes a path", async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(204));
    const c = client(fetch);
    await c.remove("docs");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ path: "docs" });
  });

  it("surfaces a rejected mutation without retrying", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(403, { message: "Forbidden" }),
    );
    const c = client(fetch);
    await expect(c.remove("docs")).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls).toHaveLength(1);
  });
});

describe("upload", () => {
  it("reports progress, headers, and the final target", async () => {
    const xhr = new FakeXhr();
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      token: "sf_v1_secret-token",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const progress: Array<[number, number]> = [];
    const result = c.upload("docs/a.txt", new Blob(["abc"]), {
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/upload?path=docs%2Fa.txt",
    );
    expect(xhr.headers.Authorization).toBe("Bearer sf_v1_secret-token");
    expect(xhr.headers["Content-Type"]).toBe("application/octet-stream");
    expect(xhr.headers["If-Match"]).toBeUndefined();
    expect(xhr.withCredentials).toBe(false);

    xhr.upload.onprogress?.(
      { lengthComputable: true, loaded: 2, total: 3 } as ProgressEvent,
    );
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ path: "docs/a.txt", size: 3 });
    xhr.onload?.();

    await expect(result).resolves.toEqual({ path: "docs/a.txt", size: 3 });
    expect(progress).toEqual([[2, 3]]);
  });

  it("sends a quoted If-Match for ifVersion", async () => {
    const xhr = new FakeXhr();
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const pending = c.upload("a.txt", new Blob(["abc"]), {
      ifVersion: "v1-current",
    });
    expect(xhr.headers["If-Match"]).toBe('"v1-current"');
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ path: "a.txt", size: 3 });
    xhr.onload?.();
    await expect(pending).resolves.toEqual({ path: "a.txt", size: 3 });
  });

  it("sends * verbatim", async () => {
    const xhr = new FakeXhr();
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const pending = c.upload("a.txt", new Blob(["abc"]), { ifVersion: "*" });
    expect(xhr.headers["If-Match"]).toBe("*");
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ path: "a.txt", size: 3 });
    xhr.onload?.();
    await pending;
  });

  it("surfaces a stale version as a conflict with the current version", async () => {
    const xhr = new FakeXhr();
    let sends = 0;
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const send = xhr.send.bind(xhr);
    xhr.send = (body) => {
      sends += 1;
      send(body);
    };
    const pending = c.upload("a.txt", new Blob(["abc"]), {
      ifVersion: "v1-old",
    });
    xhr.status = 412;
    xhr.statusText = "Precondition Failed";
    xhr.responseText = JSON.stringify({
      message: "Precondition failed",
      version: "v1-current",
    });
    xhr.onload?.();
    await expect(pending).rejects.toMatchObject({
      kind: "conflict",
      status: 412,
      version: "v1-current",
    });
    expect(sends).toBe(1);
  });

  it("rejects an invalid ifVersion before creating a request", async () => {
    let xhrs = 0;
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => {
        xhrs += 1;
        return new FakeXhr() as unknown as XMLHttpRequest;
      },
    });
    await expect(
      c.upload("a.txt", new Blob(["abc"]), { ifVersion: '"quoted"' }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(xhrs).toBe(0);
  });

  it("rejects with UploadCanceled when the caller aborts", async () => {
    const xhr = new FakeXhr();
    const controller = new AbortController();
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const pending = c.upload("a.txt", new Blob(["abc"]), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(UploadCanceled);
    expect(xhr.aborts).toBe(1);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const xhr = new FakeXhr();
    const controller = new AbortController();
    controller.abort();
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    await expect(
      c.upload("a.txt", new Blob(["abc"]), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(UploadCanceled);
    expect(xhr.sent).toBeNull();
  });

  it("maps a failed upload without retrying", async () => {
    const xhr = new FakeXhr();
    let sends = 0;
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const send = xhr.send.bind(xhr);
    xhr.send = (body) => {
      sends += 1;
      send(body);
    };
    const pending = c.upload("a.txt", new Blob(["abc"]));
    xhr.status = 503;
    xhr.statusText = "Unavailable";
    xhr.onload?.();
    await expect(pending).rejects.toMatchObject({ kind: "retryable", status: 503 });
    expect(sends).toBe(1);
  });

  it("maps a transport error to retryable with status 0", async () => {
    const xhr = new FakeXhr();
    const c = new StratofoldClient({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      createXhr: () => xhr as unknown as XMLHttpRequest,
    });
    const pending = c.upload("a.txt", new Blob(["abc"]));
    xhr.onerror?.();
    await expect(pending).rejects.toMatchObject({ kind: "retryable", status: 0 });
  });
});

describe("URL forms", () => {
  it("mints an absolute temporary URL without the token", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(201, {
        url: "/s/link-token",
        expires_at: "2026-11-10T00:00:00Z",
      }),
    );
    const c = client(fetch);
    const link = await c.temporaryUrl("docs/a.txt");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/links",
    );
    expect(link.url).toBe("https://files.example.com/s/link-token");
    expect(link.url).not.toContain("sf_v1_secret-token");
    expect(link.expiresAt).toBe("2026-11-10T00:00:00Z");
  });

  it("builds a plain file URL without a request", () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(200));
    const c = client(fetch);
    expect(c.fileUrl("docs/a b.txt")).toBe(
      "https://files.example.com/files/vdir1/docs/a%20b.txt",
    );
    expect(c.fileUrl("")).toBe("https://files.example.com/files/vdir1");
    expect(calls).toHaveLength(0);
  });

  it("rejects a temporary URL without a token before any request", async () => {
    const { fetch, calls } = fakeFetch(() => emptyResponse(200));
    const c = client(fetch, { token: undefined });
    const error = await c.temporaryUrl("a.txt").catch((e: unknown) => e);
    expect((error as StratofoldError).kind).toBe("unauthorized");
    expect((error as StratofoldError).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
