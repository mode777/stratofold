import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pb } from "./pb";
import { canWrite, effectiveRoleForVdir, type VdirRecord } from "./records";
import { collectionList, installPbMock } from "../test/mockApi";

const VDIR: VdirRecord = {
  id: "v1",
  owner: "u1",
  name: "Mine",
  root_path: "/srv",
  is_public: false,
  connection: "c1",
};

beforeEach(() => {
  pb.authStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("effectiveRoleForVdir", () => {
  it("is owner when the record's owner matches", async () => {
    installPbMock([]);
    await expect(effectiveRoleForVdir(VDIR, "u1")).resolves.toBe("owner");
  });

  it("is editor for an editor share", async () => {
    installPbMock([collectionList("vdir_shares", [{ id: "s1", vdir: "v1", user: "u2", role: "editor" }])]);
    await expect(effectiveRoleForVdir(VDIR, "u2")).resolves.toBe("editor");
  });

  it("is viewer for a viewer share", async () => {
    installPbMock([collectionList("vdir_shares", [{ id: "s1", vdir: "v1", user: "u2", role: "viewer" }])]);
    await expect(effectiveRoleForVdir(VDIR, "u2")).resolves.toBe("viewer");
  });

  it("is none without a share", async () => {
    installPbMock([collectionList("vdir_shares", [])]);
    await expect(effectiveRoleForVdir(VDIR, "u2")).resolves.toBe("none");
  });

  it("is none for an anonymous user on someone else's vdir", async () => {
    installPbMock([]);
    await expect(effectiveRoleForVdir(VDIR, "")).resolves.toBe("none");
  });
});

describe("canWrite", () => {
  it("grants only owner and editor", () => {
    expect(canWrite("owner")).toBe(true);
    expect(canWrite("editor")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite("none")).toBe(false);
  });
});
