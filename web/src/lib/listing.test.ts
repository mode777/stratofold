import { describe, expect, it } from "vitest";
import { normalizeVirtualPath } from "./listing";

describe("normalizeVirtualPath", () => {
  it("keeps plain relative paths", () => {
    expect(normalizeVirtualPath("docs")).toBe("docs");
    expect(normalizeVirtualPath("docs/sub")).toBe("docs/sub");
    expect(normalizeVirtualPath("")).toBe("");
  });

  it("collapses redundant separators", () => {
    expect(normalizeVirtualPath("/docs//sub/")).toBe("docs/sub");
    expect(normalizeVirtualPath("//")).toBe("");
  });

  it("folds current-directory segments", () => {
    expect(normalizeVirtualPath("./docs/./sub")).toBe("docs/sub");
    expect(normalizeVirtualPath(".")).toBe("");
  });

  it("folds parent-directory segments", () => {
    expect(normalizeVirtualPath("docs/sub/../other")).toBe("docs/other");
    expect(normalizeVirtualPath("docs/../docs")).toBe("docs");
    expect(normalizeVirtualPath("a/../..")).toBeNull();
  });

  it("refuses paths that escape above the root", () => {
    expect(normalizeVirtualPath("..")).toBeNull();
    expect(normalizeVirtualPath("../docs")).toBeNull();
    expect(normalizeVirtualPath("docs/../../other")).toBeNull();
  });
});
