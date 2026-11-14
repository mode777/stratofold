// Public request and response shapes for @stratofold/client.

/** One directory entry from the filesystem API. */
export type LsEntry = {
  name: string;
  size: number;
  dir: boolean;
  modtime: string;
  /** Opaque content version; the ETag is its quoted form. */
  version: string;
};

/** Single-path metadata from the filesystem API. */
export type StatEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number;
  mtime: string;
  /** Opaque content version; the ETag is its quoted form. */
  version: string;
};

/** The non-secret scope of the configured bearer token. */
export type TokenInfo = {
  id: string;
  name: string;
  vdir: { id: string; name: string };
  role: "viewer" | "editor";
  expiresAt: string | null;
  lastUsedAt: string | null;
  tokenHint: string;
};

/** A minted, session-free media URL and its expiry. */
export type TemporaryUrl = {
  url: string;
  expiresAt: string;
};

/** The result of a completed upload. */
export type UploadResult = {
  path: string;
  size: number;
};

/** Bodies the upload transport accepts. */
export type UploadBody = Blob | File | ArrayBuffer;

export type UploadOptions = {
  /** Called with transferred and total bytes when the browser reports them. */
  onProgress?: (loaded: number, total: number) => void;
  /** Aborts the in-flight upload; rejects with UploadCanceled. */
  signal?: AbortSignal;
  /**
   * Strong conditional upload: the unquoted version from `stat`/`ls`,
   * or `"*"` to require that the target exists. Omit for create-or-replace.
   */
  ifVersion?: string;
};

export type StatOptions = {
  /** Aborts the request; the signal is forwarded to fetch. */
  signal?: AbortSignal;
};

export type ReadOptions = {
  /**
   * Extra request headers forwarded verbatim — for example `Range` or
   * `If-None-Match`. The client adds only the authorization header.
   */
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type StratofoldOptions = {
  /** Absolute server address, for example `https://files.example.com`. */
  baseUrl: string;
  /** The vdir id the token (or the public vdir) is scoped to. */
  vdir: string;
  /** Optional bearer token; omit for public mode. */
  token?: string;
  /** Test seam; defaults to the global fetch. */
  fetch?: FetchLike;
  /** Test seam; defaults to `new XMLHttpRequest()`. */
  createXhr?: () => XMLHttpRequest;
};
