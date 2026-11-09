import {
  ConfigurationError,
  StratofoldError,
  UploadCanceled,
  failureFor,
  networkFailure,
} from "./errors.js";
import type {
  FetchLike,
  LsEntry,
  ReadOptions,
  StratofoldOptions,
  TemporaryUrl,
  TokenInfo,
  UploadBody,
  UploadOptions,
  UploadResult,
} from "./types.js";
import {
  apiUrl,
  fileUrl,
  normalizeBaseUrl,
  resolveServerUrl,
} from "./url.js";

/**
 * A typed client for one vdir, authenticated by a vdir-scoped bearer
 * token or — with no token — by public read access.
 *
 * The server address is always explicit; the token travels only in the
 * `Authorization` header and never in a URL.
 */
export class StratofoldClient {
  readonly baseUrl: string;
  readonly vdir: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly createXhr: () => XMLHttpRequest;

  constructor(options: StratofoldOptions) {
    if (options === null || typeof options !== "object") {
      throw new ConfigurationError("options are required");
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (typeof options.vdir !== "string" || options.vdir.trim() === "") {
      throw new ConfigurationError("vdir is required");
    }
    this.vdir = options.vdir.trim();
    if (options.token !== undefined && options.token !== null) {
      if (typeof options.token !== "string") {
        throw new ConfigurationError("token must be a string");
      }
      this.token = options.token.trim();
    } else {
      this.token = "";
    }
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.createXhr =
      options.createXhr ??
      (() => {
        if (typeof XMLHttpRequest === "undefined") {
          throw new ConfigurationError(
            "XMLHttpRequest is unavailable; inject createXhr",
          );
        }
        return new XMLHttpRequest();
      });
  }

  /** Lists one directory; the empty path lists the vdir root. */
  async list(path = ""): Promise<LsEntry[]> {
    const resp = await this.requestJson(apiUrl(this.baseUrl, this.vdir, "ls"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = (await resp.json()) as { entries?: LsEntry[] };
    return data.entries ?? [];
  }

  /**
   * Fetches a file and resolves to the raw response. Extra headers
   * (range, conditional) are forwarded; the caller owns the body.
   */
  async read(path: string, options: ReadOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers ?? {});
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    let resp: Response;
    try {
      resp = await this.fetchImpl(fileUrl(this.baseUrl, this.vdir, path), {
        method: "GET",
        headers,
        credentials: "omit",
        signal: options.signal,
      });
    } catch {
      throw networkFailure();
    }
    if (!resp.ok) throw await errorFromResponse(resp);
    return resp;
  }

  /** Creates a directory, including missing parents. */
  async mkdir(path: string): Promise<void> {
    await this.mutation("mkdir", { path });
  }

  /** Renames or moves a source path to a target inside the vdir. */
  async move(from: string, to: string): Promise<void> {
    await this.mutation("mv", { path: from, to });
  }

  /** Removes a path recursively. */
  async remove(path: string): Promise<void> {
    await this.mutation("rm", { path });
  }

  /**
   * Uploads a body to one target path, reporting progress and honoring
   * the caller's abort signal. No retry and no cross-request resume.
   */
  upload(
    path: string,
    body: UploadBody,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    if (typeof path !== "string" || path === "") {
      return Promise.reject(
        new ConfigurationError("A target path is required"),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(new UploadCanceled());
    }

    return new Promise<UploadResult>((resolve, reject) => {
      const xhr = this.createXhr();
      const url = `${apiUrl(this.baseUrl, this.vdir, "upload")}?path=${encodeURIComponent(path)}`;
      xhr.open("POST", url);
      xhr.withCredentials = false;
      if (this.token) xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      const onAbort = () => xhr.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => options.signal?.removeEventListener("abort", onAbort);

      if (options.onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            options.onProgress?.(event.loaded, event.total);
          }
        };
      }

      xhr.onload = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          let result: UploadResult = { path, size: bodySize(body) };
          try {
            const data = JSON.parse(xhr.responseText) as Partial<UploadResult>;
            result = {
              path: data.path ?? path,
              size: data.size ?? result.size,
            };
          } catch {
            // A bodyless 2xx is still a success.
          }
          resolve(result);
          return;
        }
        reject(failureFor(xhr.status, xhr.statusText || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => {
        cleanup();
        reject(networkFailure());
      };
      xhr.onabort = () => {
        cleanup();
        reject(new UploadCanceled());
      };

      xhr.send(body);
    });
  }

  /**
   * Mints a session-free, expiring media URL for one file. Requires a
   * token; public mode rejects locally without a request.
   */
  async temporaryUrl(path: string): Promise<TemporaryUrl> {
    if (!this.token) {
      throw new StratofoldError(
        "unauthorized",
        401,
        "A token is required to mint a temporary URL",
      );
    }
    const resp = await this.requestJson(
      apiUrl(this.baseUrl, this.vdir, "links"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      },
    );
    const data = (await resp.json()) as { url?: string; expires_at?: string };
    if (!data.url || !data.expires_at) {
      throw new StratofoldError("server", resp.status, "Invalid link response");
    }
    return {
      url: resolveServerUrl(this.baseUrl, data.url),
      expiresAt: data.expires_at,
    };
  }

  /** Builds the plain /files URL; no request and no credential. */
  fileUrl(path: string): string {
    return fileUrl(this.baseUrl, this.vdir, path);
  }

  /** Resolves the token's vdir, role, and expiry from the server. */
  async tokenInfo(): Promise<TokenInfo> {
    const resp = await this.requestJson(`${this.baseUrl}/api/sf/tokens/me`, {
      method: "GET",
    });
    const data = (await resp.json()) as {
      id: string;
      name: string;
      vdir: { id: string; name: string };
      role: "viewer" | "editor";
      expires_at: string | null;
      last_used_at: string | null;
      token_hint: string;
    };
    return {
      id: data.id,
      name: data.name,
      vdir: data.vdir,
      role: data.role,
      expiresAt: data.expires_at,
      lastUsedAt: data.last_used_at,
      tokenHint: data.token_hint,
    };
  }

  private async mutation(
    operation: string,
    body: Record<string, string>,
  ): Promise<void> {
    await this.requestJson(apiUrl(this.baseUrl, this.vdir, operation), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async requestJson(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        ...init,
        headers,
        credentials: "omit",
      });
    } catch {
      throw networkFailure();
    }
    if (!resp.ok) throw await errorFromResponse(resp);
    return resp;
  }
}

function bodySize(body: UploadBody): number {
  return typeof body === "object" && "size" in body
    ? Number(body.size)
    : Number((body as ArrayBuffer).byteLength);
}

async function errorFromResponse(resp: Response): Promise<StratofoldError> {
  let message = resp.statusText || `Request failed (${resp.status})`;
  try {
    const data = (await resp.json()) as { message?: string };
    if (data.message) message = data.message;
  } catch {
    // use the status text
  }
  return failureFor(resp.status, message);
}
