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

## Connect an app

This walkthrough takes a vdir you can already open to a client that has
made its first verified request. Only the token steps happen in the
Stratofold UI; everything else is your app.

### 1. Mint an app token

You need a virtual directory you own or one shared with you. The role
you have on that vdir is the ceiling for the token.

1. Open **Settings → Connected apps** and find **New access token**.
2. Pick the **Virtual directory**, give the token a **Name** that
   identifies the app, and choose a role:
   - **Viewer** — browse and download only.
   - **Editor** — also upload, rename, move, and delete. The editor
     option appears only when your own access allows writes.
3. Set **Expiry** to Never, 7, 30, 90, or 365 days, then select
   **Create token**.
4. Copy the token from the **Token created** panel. It is shown once
   and cannot be recovered; if you lose it, revoke it and mint another.

The same screen is described from the account holder's side in
[Connecting an app](../docs/using-stratofold.md#connecting-an-app-access-tokens).

### 2. Construct and verify the client

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

const scope = await client.tokenInfo();
console.log(scope.vdir.name, scope.role, scope.expiresAt);
```

`baseUrl` is the server origin, `vdir` is the id the token is bound to,
and `token` is the plaintext you just copied. `tokenInfo()` returns the
token's non-secret scope — `id`, `name`, `vdir` (`id` and `name`),
`role`, `expiresAt`, `lastUsedAt`, and `tokenHint` — and never the
plaintext token. Running it once at startup turns a wrong, expired, or
revoked credential into an explicit `unauthorized` error before the app
does any work.

### 3. Make the first request

```ts
import { StratofoldClient } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

const entries = await client.list("");
```

An empty path lists the vdir root. The token's role caps what the
client can do; the server enforces it on every request:

| Operation | `viewer` | `editor` |
| --- | :---: | :---: |
| `list`, `read`, `fileUrl`, `temporaryUrl` | yes | yes |
| `mkdir`, `move`, `remove`, `upload` | no | yes |

For a public vdir and a read-only app, omit `token` entirely; see
[Public mode](#public-mode).

### 4. Token lifetime and revocation

Access is re-resolved on every request. The effective permission is the
lower of the token's role and your current access to the vdir, so the
token never outlives the grant it was minted from: removing your share,
changing your role, deleting the vdir or your user, or letting the
token expire ends access on the next request, and an `editor` token
stops writing if your share is downgraded to `viewer`.

Revoke a token from the same **Settings → Connected apps** list; it
stops working immediately. **Last used** helps you find credentials
that nothing is using anymore.

### 5. Keep the token private

A token shipped in a public bundle, a static page, or an app store
build is public. Mint a token per consumer, scope it to the vdir it
needs, give it the smallest role (`viewer` for read-only), set an
expiry where possible, and revoke it when it is no longer used. Never
put a token in a URL: native media elements cannot send headers, which
is exactly what the minted `temporaryUrl` links are for. Serve the
instance over HTTPS.

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

`list(path)` returns `{ name, size, dir, modtime, version }` entries; an
empty path lists the vdir root.

`stat(path, options)` returns one path's metadata without listing its
parent: `{ path, name, kind, size, mtime, version }`. An empty path is
the vdir root; directories report `kind: "directory"` and `size: 0`.
`version` is the opaque content validator shared by `list`, `stat`, the
file server's `ETag` (its quoted form), and conditional upload.

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

const info = await client.stat("photos/one.jpg");
console.log(info.kind, info.size, info.version);

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

For an editor-style save, pass the `version` from `stat`/`list` as
`ifVersion`. The server re-checks it at publish time, so a change made
while the body was streaming is caught instead of overwritten. A stale
version rejects with `kind: "conflict"` and, when the server supplies
it, the current `version` on the error so the caller can resync.

```ts
import { StratofoldClient, StratofoldError } from "@stratofold/client";

const client = new StratofoldClient({
  baseUrl: "https://files.example.com",
  vdir: "vdir-id",
  token: "sf_v1_…",
});

const info = await client.stat("notes.md");
try {
  await client.upload("notes.md", new Blob(["new content"]), {
    ifVersion: info.version,
  });
} catch (error) {
  if (error instanceof StratofoldError && error.kind === "conflict") {
    console.log("changed on the server; current version", error.version);
  } else {
    throw error;
  }
}
```

`ifVersion: "*"` requires only that the target exists. Omitting
`ifVersion` keeps the create-or-replace behavior, and the client never
retries a rejected upload.

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
| `412` | `conflict` (with the current `version` when supplied) |
| `400` (and other `4xx`) | `rejected` |
| `503` | `retryable` |
| other `5xx` | `server` |
| no status (network) | `retryable`, status `0` |

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

Releases publish `@stratofold/client` to npm from
`.github/workflows/release-client.yaml` on the same `v*` tag as the
server image. The client workflow runs independently of the image
pipeline.

Before tagging:

1. Set `version` in `client/package.json` to the release version. The
   tag must match it exactly: `v0.2.0` publishes `0.2.0`.
2. Run the package gates:
   ```bash
   (cd client && npm test)
   (cd client && npm run typecheck:readme)
   (cd client && node scripts/check-pack.mjs)
   ```
   `check-pack.mjs` runs `npm pack --dry-run --json` and fails if the
   tarball contains anything outside `dist/`, `README.md`, and
   `package.json`, or declares runtime dependencies.
3. Push the `v*` tag.

The workflow re-runs those gates, skips with a success notice when the
version is already on npm, and otherwise publishes with
`npm publish --access public` under the default `latest` tag. It uses
npm trusted publishing (OIDC), so there is no `NPM_TOKEN` secret;
provenance is generated automatically.

### First publish and trusted-publisher setup

The package must exist on npm before a trusted publisher can be added.
For the one-time bootstrap:

1. Sign in with `npm login`, confirm the version, and publish manually
   once:
   ```bash
   (cd client && npm publish --access public)
   ```
   This is the only manual publish; later releases use OIDC.
2. On npmjs.com, open the package settings and add a trusted publisher:
   - Organization/user: `mode777`
   - Repository: `stratofold`
   - Workflow filename: `release-client.yaml`
   - Explicitly allow direct `npm publish` (new entries default to
     staged publishing only).
3. Validate the trusted publisher with a real OIDC publish inside npm's
   two-day window: bump to a new version and push the matching tag. If
   the window lapses, delete and recreate the trusted-publisher entry.

Claim the `@stratofold` npm scope before the first publish.

`prepack` builds `dist/` so the tarball always matches the sources.
