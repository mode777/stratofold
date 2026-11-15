import { ConfigurationError } from "./errors.js";
import { normalizeBaseUrl } from "./url.js";

// Connection strings are opaque, versioned values minted with an app
// token (ADR 0016). They are deliberately not URLs: the payload carries
// the plaintext token, so it must never enter a URL, query, or fragment.

/** The only recognized connection-string prefix and payload version. */
const CONNECTION_PREFIX = "sfconn_v1_";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The facts carried by a valid connection string. */
export type ConnectionStringParts = {
  baseUrl: string;
  vdir: string;
  token: string;
};

/**
 * Decodes and validates an `sfconn_v1_` connection string locally.
 * Throws `ConfigurationError` for a wrong prefix or version, bad
 * base64url, invalid JSON, or a missing/invalid field. Makes no request.
 */
export function parseConnectionString(value: unknown): ConnectionStringParts {
  if (typeof value !== "string") {
    throw new ConfigurationError("connection string must be a string");
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith(CONNECTION_PREFIX)) {
    throw new ConfigurationError(
      `connection string must start with ${CONNECTION_PREFIX}`,
    );
  }
  const encoded = trimmed.slice(CONNECTION_PREFIX.length);
  if (!BASE64URL.test(encoded)) {
    throw new ConfigurationError(
      "connection string payload is not valid base64url",
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(decodeBase64Url(encoded));
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(
      "connection string payload is not valid JSON",
    );
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ConfigurationError(
      "connection string payload must be a JSON object",
    );
  }
  const payload = data as Record<string, unknown>;
  if (payload.v !== 1) {
    throw new ConfigurationError(
      "connection string payload version must be 1",
    );
  }

  return {
    baseUrl: parseOrigin(payload.url),
    vdir: requiredString(payload.vdir, "vdir"),
    token: requiredString(payload.token, "token"),
  };
}

function decodeBase64Url(encoded: string): string {
  const padded =
    encoded.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (encoded.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ConfigurationError(
      "connection string payload is not valid base64url",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ConfigurationError(
      "connection string payload is not valid UTF-8",
    );
  }
}

function parseOrigin(value: unknown): string {
  const raw = requiredString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigurationError(
      "connection string url must be an absolute URL",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigurationError(
      "connection string url must use http or https",
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ConfigurationError(
      "connection string url must not contain credentials",
    );
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new ConfigurationError(
      "connection string url must not contain a path",
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new ConfigurationError(
      "connection string url must not contain a query or fragment",
    );
  }
  return normalizeBaseUrl(raw);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(
      `connection string ${field} must be a non-empty string`,
    );
  }
  return value.trim();
}
