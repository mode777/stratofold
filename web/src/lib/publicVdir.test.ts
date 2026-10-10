import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiFailure } from "./filesApi";
import { fetchPublicVdirMeta } from "./publicVdir";
import { installFetchMock, jsonResponse } from "../test/mockApi";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchPublicVdirMeta", () => {
  it("returns the vdir's name and public marker on 200", async () => {
    installFetchMock([
      (url) =>
        url === "/api/sf/vdirs/v1/meta"
          ? jsonResponse(200, { name: "Public", is_public: true })
          : undefined,
    ]);

    await expect(fetchPublicVdirMeta("v1")).resolves.toEqual({
      name: "Public",
      is_public: true,
    });
  });

  it("maps 404 (non-public or unknown) to the not-found failure class", async () => {
    installFetchMock([
      (url) => (url === "/api/sf/vdirs/v1/meta" ? jsonResponse(404, { message: "Not found." }) : undefined),
    ]);

    const err = await fetchPublicVdirMeta("v1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe("notfound");
    expect((err as ApiFailure).status).toBe(404);
  });

  it("propagates retryable failures from a network-level drop", async () => {
    installFetchMock([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    const err = await fetchPublicVdirMeta("v1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).kind).toBe("retryable");
  });
});
