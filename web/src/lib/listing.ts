// Pure listing helpers (design D4): sorting and formatting live in
// plain functions so component tests need no server.

import type { LsEntry } from "./filesApi";

export type SortKey = "name" | "size" | "modified";
export type SortDir = "asc" | "desc";

// sortEntries orders entries by key/direction; directories always sort
// before files within the chosen ordering (Drive convention).
export function sortEntries(entries: LsEntry[], key: SortKey, dir: SortDir): LsEntry[] {
  const sorted = [...entries];
  const sign = dir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    switch (key) {
      case "size":
        return sign * (a.size - b.size);
      case "modified":
        return sign * (Date.parse(a.modtime) - Date.parse(b.modtime));
      case "name":
        return sign * a.name.localeCompare(b.name);
    }
  });
  return sorted;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function formatModTime(modtime: string): string {
  const date = new Date(modtime);
  if (Number.isNaN(date.getTime())) return modtime;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// pathSegments splits a virtual path ("docs/sub") into breadcrumb
// segments with their accumulated paths ([["docs","docs"],["sub","docs/sub"]]).
export function pathSegments(path: string): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  let acc = "";
  for (const part of path.split("/")) {
    if (!part) continue;
    acc = acc ? `${acc}/${part}` : part;
    out.push({ name: part, path: acc });
  }
  return out;
}

// joinPath appends one segment to the current virtual path.
export function joinPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name;
}

// parentPath returns the containing virtual path ("" for the root).
export function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

// browseUrl builds the SPA route for a vdir path, segment-encoded.
export function browseUrl(vdirId: string, path: string): string {
  const segments = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `/v/${encodeURIComponent(vdirId)}${segments.length ? "/" + segments.join("/") : ""}`;
}

// previewUrl builds the pushed preview route for a non-media file.
export function previewUrl(vdirId: string, path: string): string {
  const segments = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `/v/${encodeURIComponent(vdirId)}/view${segments.length ? "/" + segments.join("/") : ""}`;
}

// decodeSplat turns a raw splat pathname tail into the virtual path,
// decoding each segment once (React Router does not decode splats).
export function decodeSplat(raw: string): string {
  return raw
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s))
    .join("/");
}
