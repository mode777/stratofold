import { describe, expect, it } from "vitest";

import { StratofoldClient } from "./client.js";
import { parseConnectionString } from "./connectionString.js";
import { ConfigurationError } from "./errors.js";

type Call = { url: string; init: RequestInit };

const VALID = {
  v: 1,
  url: "https://files.example.com",
  vdir: "vdir1",
  token: "sf_v1_secret-token",
};

function encode(payload: unknown): string {
  return `sfconn_v1_${base64Url(JSON.stringify(payload))}`;
}

function encodeRaw(text: string): string {
  return `sfconn_v1_${base64Url(text)}`;
}

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeFetch(): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}

class FakeXhr {
  url = "";
  withCredentials = false;
  status = 200;
  statusText = "OK";
  responseText = JSON.stringify({ path: "a.txt", size: 1 });
  headers: Record<string, string> = {};
  sent: unknown = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(_method: string, url: string): void {
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.sent = body;
    this.onload?.();
  }

  abort(): void {
    this.onabort?.();
  }
}

describe("parseConnectionString", () => {
  it("returns the facts and normalizes a trailing slash", () => {
    expect(
      parseConnectionString(encode({ ...VALID, url: "https://files.example.com/" })),
    ).toEqual({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      token: "sf_v1_secret-token",
    });
  });

  it.each([
    ["not a string", 42, /must be a string/],
    ["wrong prefix", "sfconn_v2_abc", /must start with/],
    ["empty payload", "sfconn_v1_", /base64url/],
    ["bad alphabet", "sfconn_v1_@@@@", /base64url/],
    ["bad base64 length", "sfconn_v1_A", /base64url/],
    ["bad utf-8", "sfconn_v1__w", /UTF-8/],
    ["bad json", encodeRaw("not json"), /JSON/],
    ["array payload", encode([1, 2]), /JSON object/],
    ["wrong version", encode({ ...VALID, v: 2 }), /version/],
    ["missing version", encode({ url: VALID.url, vdir: VALID.vdir, token: VALID.token }), /version/],
    ["empty vdir", encode({ ...VALID, vdir: " " }), /vdir/],
    ["empty token", encode({ ...VALID, token: "" }), /token/],
  ])("rejects %s", (_name, value, pattern) => {
    expect(() => parseConnectionString(value)).toThrow(ConfigurationError);
    expect(() => parseConnectionString(value)).toThrow(pattern as RegExp);
  });

  it.each([
    ["relative url", "files.example.com"],
    ["wrong scheme", "ftp://files.example.com"],
    ["credentials", "https://user@files.example.com"],
    ["path", "https://files.example.com/sub"],
    ["query", "https://files.example.com?x=1"],
    ["fragment", "https://files.example.com#frag"],
  ])("rejects a %s", (_name, url) => {
    expect(() => parseConnectionString(encode({ ...VALID, url }))).toThrow(
      ConfigurationError,
    );
  });
});

describe("StratofoldClient.fromConnectionString", () => {
  it("builds a client from the embedded facts", async () => {
    const { fetch, calls } = fakeFetch();
    const client = StratofoldClient.fromConnectionString(encode(VALID), {
      fetch,
    });
    expect(client.baseUrl).toBe("https://files.example.com");
    expect(client.vdir).toBe("vdir1");

    await client.list("");
    expect(calls[0]?.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/ls",
    );
    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer sf_v1_secret-token");
  });

  it("makes no request until an operation runs", () => {
    const { fetch, calls } = fakeFetch();
    StratofoldClient.fromConnectionString(encode(VALID), { fetch });
    expect(calls).toHaveLength(0);
  });

  it("overrides the embedded base URL only", async () => {
    const { fetch, calls } = fakeFetch();
    const client = StratofoldClient.fromConnectionString(encode(VALID), {
      baseUrl: "https://other.example.com/",
      fetch,
    });
    expect(client.baseUrl).toBe("https://other.example.com");
    expect(client.vdir).toBe("vdir1");

    await client.list("");
    expect(calls[0]?.url).toBe(
      "https://other.example.com/api/sf/vdirs/vdir1/ls",
    );
    const headers = calls[0]?.init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer sf_v1_secret-token");
  });

  it("forwards a createXhr override", async () => {
    const fake = new FakeXhr();
    const client = StratofoldClient.fromConnectionString(encode(VALID), {
      createXhr: () => fake as unknown as XMLHttpRequest,
    });
    const result = await client.upload("a.txt", new ArrayBuffer(1));
    expect(result).toEqual({ path: "a.txt", size: 1 });
    expect(fake.url).toBe(
      "https://files.example.com/api/sf/vdirs/vdir1/upload?path=a.txt",
    );
    expect(fake.headers.Authorization).toBe("Bearer sf_v1_secret-token");
  });

  it("rejects a malformed value before any request", () => {
    const { fetch, calls } = fakeFetch();
    expect(() =>
      StratofoldClient.fromConnectionString("sfconn_v2_bad", { fetch }),
    ).toThrow(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it("never puts the connection string or token in a URL", async () => {
    const value = encode(VALID);
    const { fetch, calls } = fakeFetch();
    const client = StratofoldClient.fromConnectionString(value, { fetch });
    await client.list("");
    await client.read("a.txt");

    const urls = calls.map((call) => call.url).join("\n");
    expect(urls).not.toContain(value);
    expect(urls).not.toContain("sfconn_v1_");
    expect(urls).not.toContain("sf_v1_secret-token");
  });
});
