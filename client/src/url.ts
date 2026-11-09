import { ConfigurationError } from "./errors.js";

/** Validates an absolute http(s) base URL and strips trailing slashes. */
export function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ConfigurationError("baseUrl is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ConfigurationError(`baseUrl must be an absolute URL: ${baseUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigurationError("baseUrl must use http or https");
  }
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Percent-encodes each virtual path segment and drops empty segments.
 * The path is never normalized: `..` stays a literal segment and the
 * server-side sandbox remains the authority on resolution.
 */
export function encodeVirtualPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function apiUrl(baseUrl: string, vdir: string, operation: string): string {
  return `${baseUrl}/api/sf/vdirs/${encodeURIComponent(vdir)}/${operation}`;
}

export function fileUrl(baseUrl: string, vdir: string, path: string): string {
  const encoded = encodeVirtualPath(path);
  const root = `${baseUrl}/files/${encodeURIComponent(vdir)}`;
  return encoded.length > 0 ? `${root}/${encoded}` : root;
}

/** Resolves a server-relative link (for example `/s/<token>`) to absolute. */
export function resolveServerUrl(baseUrl: string, url: string): string {
  return new URL(url, baseUrl + "/").toString();
}
