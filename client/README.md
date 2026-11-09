# @stratofold/client

Typed, zero-dependency browser client for **one** Stratofold virtual
directory, authenticated by a vdir-scoped bearer token — or used in
public mode, where no token is needed.

The package talks to the Stratofold server over HTTPS with header-only
authentication: the token is sent as `Authorization: Bearer …` and never
appears in a URL, query, or body.

## Install

```bash
npm install @stratofold/client
```

The published package has no runtime dependencies. Bundlers can use the
ESM entry; a plain page can load `dist/stratofold.min.js` and use the
`Stratofold` global.

## Construction

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

const entries = await client.list("docs");
console.log(entries);
```

`baseUrl` must be an absolute `http`/`https` URL; there is no inferred
or default server. `vdir` is required. Omit `token` for public mode.

If you only know the server and the token, discover the scope first:

```ts
import { StratofoldClient } from "@stratofold/client";

const scope = await new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "placeholder",
  token: "sf_v1_…",
}).tokenInfo();

console.log(scope.vdir.id, scope.vdir.name, scope.role, scope.expiresAt);
```

The response contains the vdir, role, expiry, last use, and a non-secret
hint — never the plaintext token.

## Operations

### Listing and reading

`list(path)` returns `{ name, size, dir, modtime }` entries; an empty
path lists the vdir root.

`read(path, options)` returns the raw `Response` from the file server,
so you can stream it, copy it to a blob, or read a range. Extra headers
are forwarded verbatim.

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

const listing = await client.list("photos");

const full = await client.read("photos/one.jpg");
const blob = await full.blob();

const partial = await client.read("photos/one.jpg", {
  headers: { Range: "bytes=0-1023" },
});
console.log(partial.status, partial.headers.get("Content-Range"));
```

### Mutations

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

await client.mkdir("2026/November");
await client.move("draft.txt", "2026/November/draft.txt");
await client.remove("old");
```

Each call sends exactly one request; the client never retries a
mutation. The server's own retry model makes each operation
complete-or-nothing.

### Uploads

`upload` accepts a `Blob`, `File`, or `ArrayBuffer` and reports
transferred/total bytes when the browser can. Abort through an
`AbortSignal`; a canceled upload rejects with `UploadCanceled`.

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

const controller = new AbortController();
const result = await client.upload(
  "backup.tar",
  new Blob(["…"]),
  {
    onProgress: (loaded, total) => console.log(loaded, total),
    signal: controller.signal,
  },
);
console.log(result.path, result.size);
```

There is no cross-request resume: a canceled or failed upload restarts
from byte zero if the caller retries. The server still resumes within a
single request when the SSH connection drops.

### URLs

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

// Plain file-server URL: no request, no credential.
const plain = client.fileUrl("photos/one.jpg");

// Session-free, 24-hour media URL for <img> or <video>.
const link = await client.temporaryUrl("photos/one.jpg");
console.log(link.url, link.expiresAt);
```

`temporaryUrl` requires a token and rejects locally with
`kind: "unauthorized"` when none is configured; it never sends an
anonymous request. The minted URL contains a link token, not your bearer
token.

## Public mode

Omit the token to read a public vdir. Requests carry no `Authorization`
header and no cookies, so `list`, `read`, and `fileUrl` work
anonymously. Token-only operations (`temporaryUrl`) reject locally;
mutations are still sent and the server decides (`401`/`403`).

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "public-vdir-id",
});

const files = await client.list("");
const url = client.fileUrl(files[0]?.name ?? "");
```

## Errors

Every failure is a `StratofoldError` with `kind`, `status`, and the
server message. A configuration problem throws `ConfigurationError`
before any request. Upload cancellation is the separate
`UploadCanceled` class.

```ts
import {
  StratofoldClient,
  StratofoldError,
  UploadCanceled,
} from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

try {
  await client.list("");
} catch (error) {
  if (error instanceof UploadCanceled) {
    console.log("canceled");
  } else if (error instanceof StratofoldError) {
    console.log(error.kind, error.status, error.message);
  } else {
    throw error;
  }
}
```

| Status | `kind` |
| --- | --- |
| `401` | `unauthorized` |
| `403` | `forbidden` |
| `404` | `notfound` |
| `400` (and other `4xx`) | `rejected` |
| `503` | `retryable` |
| other `5xx` | `server` |
| no status (network) | `retryable`, status `0` |

## Token audience

A token shipped in a public bundle, a static page, or an app store
build is public. Mint a token per consumer, scope it to the vdir it
needs, give it the smallest role (`viewer` for read-only), set an
expiry where possible, and revoke it in **Settings → Connected apps**
when it is no longer used. Never put a token in a URL: native media
elements cannot send headers, which is exactly what the minted
`temporaryUrl` links are for.

## Test client

A static, frontend-only test client is deployed to GitHub Pages at
<https://mode777.github.io/stratofold/>. It has no default server and no
bundled token: enter the base URL and token at runtime (or leave the
token empty for a public vdir). It exercises every operation and shows
each result or error class.

The same app runs locally against any instance:

```bash
npm --prefix client run build
npm --prefix client/test-client install
npm --prefix client/test-client run dev
```

For local convenience only, `client/test-client/.env.local` may set
`VITE_SF_BASE_URL`, `VITE_SF_TOKEN`, and `VITE_SF_VDIR`; it is
gitignored and is read only in development. A production build refuses
to run when any of those values is set, so a local token can never be
embedded in a deployable bundle.

## Deployment

`.github/workflows/client-pages.yaml` builds the package, then the test
client with the `/stratofold/` base path, scans the bundle for
`sf_v1_` strings, and deploys the static output with the official
GitHub Pages actions. Enable Pages once in the repository settings
(Source: GitHub Actions). No repository secret is involved.

## Publishing

Publishing is not automated. When the package is ready:

```bash
npm --prefix client test
npm --prefix client pack --dry-run
npm --prefix client publish --access public
```

`prepack` builds `dist/` so the tarball always matches the sources.
Claim the `@stratofold` npm scope before the first publish.
