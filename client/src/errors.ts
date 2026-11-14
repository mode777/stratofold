// The deterministic error vocabulary shared by every operation. The
// classes mirror the server's documented status mapping so callers can
// branch on `kind` without parsing messages (client-library spec).

export type FailureKind =
  | "unauthorized"
  | "forbidden"
  | "notfound"
  | "conflict"
  | "retryable"
  | "rejected"
  | "server";

/** A configuration or argument problem detected before any request. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** A failed operation, classified by HTTP status (or 0 for network). */
export class StratofoldError extends Error {
  readonly kind: FailureKind;
  readonly status: number;
  /** The current version supplied by a 412 response, when present. */
  readonly version?: string;

  constructor(kind: FailureKind, status: number, message: string, version?: string) {
    super(message);
    this.name = "StratofoldError";
    this.kind = kind;
    this.status = status;
    this.version = version;
  }
}

/** A caller-requested upload abort; not a failure kind. */
export class UploadCanceled extends Error {
  constructor() {
    super("Upload canceled");
    this.name = "UploadCanceled";
  }
}

export function failureKind(status: number): FailureKind {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "notfound";
    case 412:
      return "conflict";
    case 503:
      return "retryable";
    default:
      return status >= 500 ? "server" : "rejected";
  }
}

export function failureFor(
  status: number,
  message: string,
  version?: string,
): StratofoldError {
  return new StratofoldError(failureKind(status), status, message, version);
}

/** A transport failure that never produced an HTTP status. */
export function networkFailure(): StratofoldError {
  return new StratofoldError(
    "retryable",
    0,
    "Network error — the request never completed",
  );
}
