import { describe, expect, it } from "vitest";

import { clearToken, loadConnection, saveConnection, type Stores } from "./config.js";

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
}

function stores(): Stores {
  return { local: new MemoryStore(), session: new MemoryStore() };
}

describe("connection store", () => {
  it("starts empty", () => {
    expect(loadConnection(stores())).toEqual({
      baseUrl: "",
      token: "",
      vdir: "",
    });
  });

  it("keeps the token in session storage and the rest in local storage", () => {
    const s = stores();
    saveConnection(
      { baseUrl: "https://files.example.com", token: "sf_v1_secret", vdir: "v1" },
      s,
    );
    expect(s.session.getItem("sf-test-client.token")).toBe("sf_v1_secret");
    expect(s.local.getItem("sf-test-client.baseUrl")).toBe(
      "https://files.example.com",
    );
    expect(s.local.getItem("sf-test-client.vdir")).toBe("v1");
    expect(loadConnection(s)).toEqual({
      baseUrl: "https://files.example.com",
      token: "sf_v1_secret",
      vdir: "v1",
    });
  });

  it("trims values and removes emptied keys", () => {
    const s = stores();
    saveConnection(
      { baseUrl: "  https://files.example.com  ", token: "  tok  ", vdir: " v1 " },
      s,
    );
    expect(loadConnection(s)).toEqual({
      baseUrl: "https://files.example.com",
      token: "tok",
      vdir: "v1",
    });

    saveConnection({ baseUrl: "", token: "", vdir: "" }, s);
    expect(loadConnection(s)).toEqual({ baseUrl: "", token: "", vdir: "" });
  });

  it("clears only the token", () => {
    const s = stores();
    saveConnection({ baseUrl: "https://x.example", token: "tok", vdir: "v1" }, s);
    clearToken(s);
    expect(loadConnection(s)).toEqual({
      baseUrl: "https://x.example",
      token: "",
      vdir: "v1",
    });
  });
});
