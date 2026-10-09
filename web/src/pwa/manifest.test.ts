// PWA installability (pwa spec): the web app manifest must carry the
// members browsers require for installation and reference real icon
// assets on disk. Reads the source files directly rather than the built
// output, so it also guards the committed assets.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the `web/` workspace root (see web/package.json).
const publicDir = resolve(process.cwd(), "public") + "/";
const manifestPath = `${publicDir}manifest.json`;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name?: string;
  short_name?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  prefer_related_applications?: boolean;
  icons?: ManifestIcon[];
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

describe("web app manifest", () => {
  it("declares the browser-required installability members", () => {
    expect(manifest.name ?? manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.prefer_related_applications).not.toBe(true);
  });

  it("uses the iOS design-token theme and background colors", () => {
    expect(manifest.theme_color).toBe("#007aff");
    expect(manifest.background_color).toBe("#f2f2f7");
  });

  it("declares 192px and 512px icons", () => {
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("declares a 512px maskable icon", () => {
    const maskable = (manifest.icons ?? []).filter((icon) =>
      (icon.purpose ?? "").split(/\s+/).includes("maskable"),
    );
    expect(maskable.some((icon) => icon.sizes === "512x512")).toBe(true);
  });

  it("references icon files that exist and are valid PNG/SVG", () => {
    const icons = manifest.icons ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      const file = publicDir + icon.src.replace(/^\//, "");
      const bytes = readFileSync(file);
      if (icon.type === "image/png") {
        expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      } else if (icon.type === "image/svg+xml") {
        expect(bytes.toString("utf8")).toContain("<svg");
      } else {
        throw new Error(`unexpected icon type: ${icon.type}`);
      }
    }
  });

  it("ships an apple-touch-icon for iOS home-screen installs", () => {
    const bytes = readFileSync(`${publicDir}icons/apple-touch-icon.png`);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });
});
