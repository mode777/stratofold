// PWA installability (pwa spec): the served shell must link the manifest
// at the site root and carry the install metadata browsers and iOS use.
// Reads the source `index.html` so it guards the committed shell.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the `web/` workspace root (see web/package.json).
const webDir = process.cwd();
const html = readFileSync(resolve(webDir, "index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");

describe("SPA shell install metadata", () => {
  it("links the manifest as a root-relative file, not a hashed asset", () => {
    const link = doc.querySelector('link[rel="manifest"]');
    expect(link?.getAttribute("href")).toBe("/manifest.json");
    // The linked file is a committed public asset, served as-is.
    const manifest = readFileSync(resolve(webDir, "public/manifest.json"), "utf8");
    expect(manifest).toContain('"name"');
  });

  it("sets viewport-fit=cover and the theme color", () => {
    const viewport = doc.querySelector('meta[name="viewport"]');
    expect(viewport?.getAttribute("content")).toContain("viewport-fit=cover");
    expect(
      doc.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ).toBe("#007aff");
  });

  it("links the app icons", () => {
    expect(
      doc
        .querySelector('link[rel="icon"][type="image/svg+xml"]')
        ?.getAttribute("href"),
    ).toBe("/icons/icon.svg");
    expect(
      doc.querySelector('link[rel="icon"][sizes="192x192"]')?.getAttribute("href"),
    ).toBe("/icons/icon-192.png");
  });

  it("declares the iOS web-app metadata", () => {
    expect(
      doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
    ).toBe("/icons/apple-touch-icon.png");
    expect(
      doc
        .querySelector('meta[name="apple-mobile-web-app-capable"]')
        ?.getAttribute("content"),
    ).toBe("yes");
    expect(
      doc
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute("content"),
    ).toBe("default");
    expect(
      doc
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute("content"),
    ).toBe("Stratofold");
  });
});
