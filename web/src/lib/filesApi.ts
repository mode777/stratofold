// Typed wrappers over the /api/sf/* filesystem surface (design D4).
// Every failure maps into the API's deterministic error classes
// (filesystem-api spec) as a discriminated kind so the UI can render
// distinct states: 401 → unauthorized, 403 → forbidden, 404 →
// notfound, 503 → retryable (with a retry action), 400/500 →
// rejected/server. No automatic client-side retries anywhere.

export type LsEntry = {
  name: string;
  size: number;
  dir: boolean;
  modtime: string;
};

export type FailureKind =
  | "unauthorized"
  | "forbidden"
  | "notfound"
  | "retryable"
  | "rejected"
  | "server";

export class ApiFailure extends Error {
  readonly kind: FailureKind;
  readonly status: number;

  constructor(kind: FailureKind, status: number, message: string) {
    super(message);
    this.name = "ApiFailure";
    this.kind = kind;
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

// setUnauthorizedHandler registers the single interceptor target
// (design D4): any 401 from any sfFetch call routes the user back to
// login via the session provider.
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// notifyUnauthorized fires the registered interceptor for 401s that
// arrive outside sfFetch (PocketBase SDK record calls).
export function notifyUnauthorized(): void {
  onUnauthorized?.();
}

// failureFor maps an HTTP status to the failure kind (the API's
// deterministic classes) — shared by the fetch wrappers and the
// PocketBase SDK record layer.
export function failureFor(status: number, message: string): ApiFailure {
  if (status === 401) notifyUnauthorized();
  return new ApiFailure(failureKind(status), status, message);
}

function failureKind(status: number): FailureKind {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "notfound";
    case 503:
      return "retryable";
    default:
      return status >= 500 ? "server" : "rejected";
  }
}

async function errorMessage(resp: Response): Promise<string> {
  try {
    const data = (await resp.json()) as { message?: string };
    if (data.message) return data.message;
  } catch {
    // fall through to the status text
  }
  return resp.statusText || `Request failed (${resp.status})`;
}

export async function sfFetch(path: string, init?: RequestInit): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    // A network-level failure (connection dropped before a status) is
    // the retryable class — surfacing 503 semantics client-side.
    throw new ApiFailure("retryable", 0, "Network error — the request never completed");
  }
  if (resp.ok) return resp;
  const kind = failureKind(resp.status);
  if (kind === "unauthorized") onUnauthorized?.();
  throw new ApiFailure(kind, resp.status, await errorMessage(resp));
}

// ls lists one directory through the vdir sandbox (empty path = root).
export async function ls(vdirId: string, path: string): Promise<LsEntry[]> {
  const resp = await sfFetch(`/api/sf/vdirs/${encodeURIComponent(vdirId)}/ls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = (await resp.json()) as { entries?: LsEntry[] };
  return data.entries ?? [];
}

// mkdir creates a directory (including missing parents) through the
// vdir sandbox; the server answers 204 on success.
export async function mkdir(vdirId: string, path: string): Promise<void> {
  await sfFetch(`/api/sf/vdirs/${encodeURIComponent(vdirId)}/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

// mv renames/moves a source virtual path to a target within the vdir
// (replacing an existing file target); 204 on success.
export async function mv(vdirId: string, path: string, to: string): Promise<void> {
  await sfFetch(`/api/sf/vdirs/${encodeURIComponent(vdirId)}/mv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, to }),
  });
}

// rm deletes a path recursively through the vdir sandbox; 204 on
// success.
export async function rm(vdirId: string, path: string): Promise<void> {
  await sfFetch(`/api/sf/vdirs/${encodeURIComponent(vdirId)}/rm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export type UploadResult = { path: string; size: number };

export type UploadOptions = {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
};

// UploadCanceled distinguishes a user abort from a failure so the queue
// can mark the item canceled rather than failed.
export class UploadCanceled extends Error {
  constructor() {
    super("Upload canceled");
    this.name = "UploadCanceled";
  }
}

// uploadFile streams a file to the target path through the vdir
// sandbox using XMLHttpRequest — the one browser transport that both
// reports upload progress and supports abort (design D1/D7). The body
// is the raw file, the target path travels in the query string, and
// failures reuse the same deterministic error classes as every other
// call.
export function uploadFile(
  vdirId: string,
  path: string,
  file: File | Blob,
  { onProgress, signal }: UploadOptions = {},
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCanceled());
      return;
    }

    const xhr = new XMLHttpRequest();
    const url = `/api/sf/vdirs/${encodeURIComponent(vdirId)}/upload?path=${encodeURIComponent(path)}`;
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        let result: UploadResult = { path, size: file.size };
        try {
          const data = JSON.parse(xhr.responseText) as Partial<UploadResult>;
          result = { path: data.path ?? path, size: data.size ?? file.size };
        } catch {
          // A bodyless 2xx still counts as success; the caller has the
          // target path and size already.
        }
        resolve(result);
        return;
      }
      reject(failureFor(xhr.status, xhr.statusText || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiFailure("retryable", 0, "Network error — the upload never completed"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadCanceled());
    };

    xhr.send(file);
  });
}

// filesUrl builds the plain /files/<vdir-id>/<virtual-path> URL for a
// vdir path — the download/media address that works with the session
// cookie alone.
export function filesUrl(vdirId: string, path: string): string {
  const segments = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `/files/${encodeURIComponent(vdirId)}${segments.length ? "/" + segments.join("/") : ""}`;
}
