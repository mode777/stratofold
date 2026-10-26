import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiFailure,
  UploadCanceled,
  filesUrl,
  ls,
  mintFileLink,
  mkdir,
  mv,
  rm,
  setUnauthorizedHandler,
  uploadFile,
} from "./filesApi";

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

describe("ls", () => {
  it("posts the path and parses entries", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/vdirs/abc123/ls");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ path: "docs" });
      return jsonResponse(200, {
        path: "docs",
        entries: [{ name: "a.txt", size: 3, dir: false, modtime: "2026-01-01T00:00:00Z" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = await ls("abc123", "docs");
    expect(entries).toEqual([{ name: "a.txt", size: 3, dir: false, modtime: "2026-01-01T00:00:00Z" }]);
  });

  it("treats an empty path as the vdir root", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ path: "" });
      return jsonResponse(200, { path: "", entries: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(ls("abc123", "")).resolves.toEqual([]);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
    [400, "rejected"],
    [500, "server"],
  ] as const)("maps %i to kind %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { message: "boom" })));
    const err = await ls("abc123", "").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
    expect((err as ApiFailure).status).toBe(status);
    expect((err as ApiFailure).message).toBe("boom");
  });

  it("maps a network-level failure to retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const err = await ls("abc123", "").catch((e: unknown) => e);
    expect((err as ApiFailure).kind).toBe("retryable");
  });

  it("fires the unauthorized handler exactly once on 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, {})));
    await ls("abc123", "").catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("filesUrl", () => {
  it("builds plain /files URLs with encoded segments", () => {
    expect(filesUrl("abc123", "")).toBe("/files/abc123");
    expect(filesUrl("abc123", "docs/sub/a b.txt")).toBe("/files/abc123/docs/sub/a%20b.txt");
    expect(filesUrl("abc123", "weird%20name")).toBe("/files/abc123/weird%2520name");
  });
});

describe("mintFileLink", () => {
  it("posts the path and parses the relative URL and expiry", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/vdirs/v1/links");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ path: "docs/a.txt" });
      return jsonResponse(201, { url: "/s/tok123", expires_at: "2026-10-27T19:00:00Z" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mintFileLink("v1", "docs/a.txt")).resolves.toEqual({
      url: "/s/tok123",
      expiresAt: "2026-10-27T19:00:00Z",
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
    [400, "rejected"],
    [500, "server"],
  ] as const)("maps %i to kind %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { message: "boom" })));
    const err = await mintFileLink("v1", "a.txt").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
  });

  it("rejects a malformed success body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, { url: "/s/x" })));
    const err = await mintFileLink("v1", "a.txt").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe("server");
  });
});

describe("mkdir / mv / rm", () => {
  it("mkdir posts the path and resolves on 204", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/vdirs/v1/mkdir");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ path: "a/b" });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mkdir("v1", "a/b")).resolves.toBeUndefined();
  });

  it("mv posts path and target", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/vdirs/v1/mv");
      expect(JSON.parse(String(init?.body))).toEqual({ path: "a.txt", to: "docs/a.txt" });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mv("v1", "a.txt", "docs/a.txt")).resolves.toBeUndefined();
  });

  it("rm posts the path", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sf/vdirs/v1/rm");
      expect(JSON.parse(String(init?.body))).toEqual({ path: "docs" });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(rm("v1", "docs")).resolves.toBeUndefined();
  });

  it.each([
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
    [400, "rejected"],
    [500, "server"],
  ] as const)("maps %i to kind %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { message: "boom" })));
    const err = await mkdir("v1", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
    expect((err as ApiFailure).status).toBe(status);
    expect((err as ApiFailure).message).toBe("boom");
  });
});

class FakeXHR {
  static instances: FakeXHR[] = [];
  method = "";
  url = "";
  withCredentials = false;
  headers: Record<string, string> = {};
  status = 0;
  statusText = "";
  responseText = "";
  sent: unknown;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    FakeXHR.instances.push(this);
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
  }
  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, body?: unknown) {
    this.status = status;
    this.responseText = body === undefined ? "" : JSON.stringify(body);
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

function installXhrMock(): void {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
}

describe("uploadFile", () => {
  it("streams the raw file, reports progress, and parses the result", async () => {
    installXhrMock();
    const progress: Array<[number, number]> = [];
    const file = new File(["hello"], "a.txt");
    const pending = uploadFile("v1", "docs/a.txt", file, {
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/sf/vdirs/v1/upload?path=docs%2Fa.txt");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers["Content-Type"]).toBe("application/octet-stream");
    expect(xhr.sent).toBe(file);

    xhr.emitProgress(3, 5);
    xhr.respond(200, { path: "docs/a.txt", size: 5 });

    await expect(pending).resolves.toEqual({ path: "docs/a.txt", size: 5 });
    expect(progress).toEqual([[3, 5]]);
  });

  it("falls back to the target path and file size when the body is empty", async () => {
    installXhrMock();
    const file = new File(["abc"], "a.txt");
    const pending = uploadFile("v1", "a.txt", file);
    FakeXHR.instances[0].respond(200);
    await expect(pending).resolves.toEqual({ path: "a.txt", size: 3 });
  });

  it("rejects with UploadCanceled when the signal aborts", async () => {
    installXhrMock();
    const controller = new AbortController();
    const pending = uploadFile("v1", "a.txt", new File(["x"], "a.txt"), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(UploadCanceled);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    installXhrMock();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadFile("v1", "a.txt", new File(["x"], "a.txt"), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(UploadCanceled);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it.each([
    [403, "forbidden"],
    [404, "notfound"],
    [503, "retryable"],
    [500, "server"],
  ] as const)("maps a %i response to kind %s", async (status, kind) => {
    installXhrMock();
    const pending = uploadFile("v1", "a.txt", new File(["x"], "a.txt"));
    FakeXHR.instances[0].respond(status, { message: "boom" });
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe(kind);
    expect((err as ApiFailure).status).toBe(status);
  });

  it("maps a network-level failure to retryable", async () => {
    installXhrMock();
    const pending = uploadFile("v1", "a.txt", new File(["x"], "a.txt"));
    FakeXHR.instances[0].fail();
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe("retryable");
    expect((err as ApiFailure).status).toBe(0);
  });
});
