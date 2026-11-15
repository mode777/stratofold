import { ConfigurationError } from "@stratofold/client";
import { describe, expect, it } from "vitest";

import { applyConnectionString } from "./connection.js";
import { loadConnection, saveConnection, type Stores } from "./config.js";

const CURRENT = {
  baseUrl: "https://old.example.com",
  vdir: "old-vdir",
  token: "sf_v1_old",
};

function encode(payload: unknown): string {
  const json = JSON.stringify(payload);
  const binary = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `sfconn_v1_${binary}`;
}

const VALID = encode({
  v: 1,
  url: "https://files.example.com/",
  vdir: "vdir1",
  token: "sf_v1_secret",
});

class MemoryStore {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  values(): string[] {
    return [...this.map.values()];
  }
}

function stores(): Stores & { local: MemoryStore; session: MemoryStore } {
  return { local: new MemoryStore(), session: new MemoryStore() };
}

describe("applying a connection string", () => {
  it("fills the base URL, vdir, and token", () => {
    expect(applyConnectionString(VALID, CURRENT)).toEqual({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      token: "sf_v1_secret",
    });
  });

  it("leaves the current connection untouched on failure", () => {
    const current = { ...CURRENT };
    expect(() => applyConnectionString("sfconn_v1_bad", current)).toThrow(
      ConfigurationError,
    );
    expect(current).toEqual(CURRENT);
  });

  it("never persists the connection string itself", () => {
    const s = stores();
    saveConnection(applyConnectionString(VALID, CURRENT), s);
    expect(loadConnection(s)).toEqual({
      baseUrl: "https://files.example.com",
      vdir: "vdir1",
      token: "sf_v1_secret",
    });
    expect(s.local.values().join("\n")).not.toContain("sfconn_v1_");
    expect(s.session.values().join("\n")).not.toContain("sfconn_v1_");
  });
});
