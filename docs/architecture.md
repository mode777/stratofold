# Architecture

High-level architecture of Stratofold. This document resolves the
"architecture considerations (not decisions yet)" from
[`docs/vision.md`](vision.md) into a concrete design; the durable *whys*
live in the ADRs under [`docs/decisions/`](decisions/README.md) and are
referenced throughout. Behavior requirements will be pinned by specs in
`openspec/specs/` — this document describes how the system is shaped, not
verbatim behavior.

## System shape

One Go binary (one process, one port), one SQLite database, N remote SSH
hosts. The SPA is embedded in the binary.

```
                      +--------------------- Docker container ---------------------+
                      |                                                            |
 Browser (SPA) -----> |  Go binary                                                 |
  /      static (SPA) |  +------------------------------------------------------+  |
  /api/   REST API    |  | PocketBase core: users, auth, SQLite, admin UI       |  |
  /files/ streaming   |  | Custom REST API  /api/sf/*                           |  |
                      |  | Streaming file server /files/*                       |  |
                      |  |        |                    |                        |  |
                      |  |        +--- SSH connection -+                        |  |
                      |  |              manager (dial on demand,                |  |
                      |  |              20 min idle TTL, backoff)               |  |
                      |  +----------------------|-------------------------------+  |
                      +-------------------------|----------------------------------+
                                                | SSH/SFTP
                                     +----------+-----------+
                                     |   Remote SSH hosts   |
                                     +----------------------+
```

Stack summary (rationale in the linked ADRs):

| Concern | Choice | ADR |
| ------- | ------ | --- |
| Server language/runtime | Go, single binary, SQLite | [0001](decisions/0001-go-server.md) |
| App framework | PocketBase, embedded as a library | [0002](decisions/0002-pocketbase-embedded.md) |
| Remote file access | `golang.org/x/crypto/ssh` + `github.com/pkg/sftp` | [0003](decisions/0003-ssh-sftp-stack.md) |
| Distribution | One Docker image, SPA via `go:embed` | [0004](decisions/0004-single-docker-image.md) |
| Frontend | React + Vite + TypeScript + Tailwind | [0005](decisions/0005-react-spa-stack.md) |

## Components

### PocketBase core

Embedded PocketBase provides the built-in REST API (`/api/collections/*`,
auth endpoints), the admin UI, token issuance/refresh, and SQLite
persistence. Everything that is plain record CRUD (users, connections,
virtual directories, shares) is expressed as PocketBase collections with
API rules — no custom code. Custom endpoints never collide with built-in
namespaces: all custom routes use the `/api/sf/` prefix (PocketBase itself
owns `/api/files/*` for record attachments).

### Custom REST API — `/api/sf/*`

Covers what PocketBase cannot: operations against remote hosts.

- `POST /api/sf/auth` — authenticates against PocketBase and additionally
  sets the HttpOnly `sf_session` cookie used by `/files/*` (the session
  bridge, ADR 0002). `DELETE /api/sf/auth` clears it.
- `GET /api/sf/users/lookup?email=…` — authenticated, exact-match
  resolution of an email to `{id, email}` for naming share grantees;
  at most one record, no listing/search form (any other query shape is
  `400`). It exists so the SPA can grant a share by email without
  exposing a user directory.
- `POST /api/sf/vdirs/{id}/ls` — directory listing (JSON body
  `{"path": …}`, the vdir root when empty) returning entries with
  name, size, directory flag, and modification time; listing is part
  of the API per the vision.
- `POST /api/sf/vdirs/{id}/mkdir`, `/mv`, `/rm` — remote filesystem
  mutations (`mkdir` creates missing parents and tolerates an existing
  directory; `mv` is an SFTP rename that replaces an existing target
  and detects its own already-applied state on retry; `rm` deletes
  recursively server-side, symlinks as links; deleting a missing path
  is idempotent success).
- `POST /api/sf/vdirs/{id}/links` — mints a session-free, 24-hour link
  for one file (`{"path": …}`); any signed-in reader of the vdir may
  mint. The response is `{url: "/s/<token>", expires_at: …}` and the
  plaintext token is shown only there. See the temporary-links
  subsection below.
- `POST /api/sf/vdirs/{id}/upload?path=…` — streams the request body
  straight to the SFTP writer (PocketBase's default request-body limit
  is unbound on this route); nothing is buffered on the Stratofold
  host. Bytes land under a temporary name next to the target and are
  renamed into place only after the final byte is acknowledged — an
  interrupted upload leaves no file at the target path, and a
  mid-upload disconnect resumes at the last acknowledged offset.
- Public equivalents of read-only operations (`ls`) exist for virtual
  directories marked public, without authentication; writes require the
  owner's session or an `editor` share on every vdir (public never
  implies write).

All operations resolve through the vdir sandbox before any SSH dial
(sandbox rejections and missing targets are `404`), authorize
before dialing (`401`/`403` never wake a connection), retry
idempotently across connection drops, and map errors
deterministically: not-found family `404`, permission denied `403`,
invalid request shape `400`, retryable/unreachable `503`, anything
else `500`. Create-type operations resolve through a sandbox-checked
partial resolution (deepest existing ancestor + lexical tail), so
fresh paths are created inside the sandbox without weakening
containment.

### Streaming file server — `/files/*`

Serves `GET /files/<vdir-id>/<virtual-path>` (plus the bare
`/files/<vdir-id>` root form) with the properties of a state-of-the-art
static file server: single-range HTTP Range requests (`206`/`416`;
malformed or multi-range headers are ignored and served in full),
`ETag`/`Last-Modified` with `If-None-Match`/`If-Modified-Since`
conditionals (`304`, validators before Range), a built-in deterministic
mime table, and `index.html` resolution for directory URLs
(unslashed directory URLs redirect to the slashed form; no autoindex —
listing stays API-only). Routed through the virtual directory to its
SSH connection and streamed via SFTP offset reads — no host-side
cache, no full-file download before serving; a connection drop
mid-response resumes at the served offset within the same response.
Access is decided before any SSH dial: non-public virtual directories
require the `sf_session` cookie of the vdir's owner or of a user
holding a `viewer`/`editor` share (resolved per request against
`vdirs` + `vdir_shares`, so revocation is immediate); public ones are
served to everyone.

### Temporary file links — `/s/*`

`POST /api/sf/vdirs/{id}/links` creates a `file_links` row that grants
read access to one virtual path for 24 hours, for consumers that cannot
present the session cookie (a Chromecast receiver, a download tool). The
token is 256 bits of cryptographic randomness stored only as a SHA-256
hash; the plaintext appears once in the mint response. `GET`/`HEAD
/s/<token>` is session-free, re-checks the creator's current
`vdirauthz` read access on every request, resolves through the vdir
sandbox, and serves with the same Range/conditional/reconnect paths as
`/files` (`fileserver.StatResolved` + `fileserver.ServeFile`). Every
failure is an indistinguishable `404`; responses are `no-store` with
permissive CORS, and the token is redacted from the request log. An
owner-created link survives un-publishing until expiry; a viewer's link
ends when the share is removed. `/files` access rules are unchanged
([ADR 0010](decisions/0010-expiring-file-links.md)).

### SSH connection manager

Owns the lifecycle of SSH/SFTP connections, keyed by connection record:

- **On demand**: no connection is dialed until the first operation needs
  it.
- **Idle TTL**: connections close after 20 minutes without activity.
- **Reconnect**: on failure, the manager reconnects with exponential
  backoff (base ~1 s, factor 2, cap ~5 min, with jitter). Exact timings
  are tunables, not invariants.
- **Host keys**: the pinned SHA256 fingerprint is optional. When set,
  every connection verifies it and a mismatch aborts permanently; when
  unset, the first successfully authenticated connection captures and
  pins the key (trust on first use, ADR 0007), persisted without dropping
  the live connection.
- **Retry-safe operations**: every operation is designed around the retry
  mechanism (see "Failure and retry model" below). This is an invariant
  all filesystem-touching code must honor.
- Single connection per connection record for now; the manager interface
  is the seam where connection pooling (future extension) plugs in.

### SPA

React + Vite + TypeScript + Tailwind (ADR 0005), living in the `web/`
workspace (`npm run web` / `web:build` / `web:test` / `web:e2e` from the
repo root). It talks to PocketBase's API via the JS SDK for auth and
records, to `/api/sf/*` for listings, and to `/files/*` via plain URLs
(download links and the in-app audio/image/video players). Mobile-first,
responsive, Drive-like; the media players stream their `/files` URL
through the browser's native elements and Range requests. Video also
keeps an open-in-new-tab action for the raw URL.

Video playback can hand the stream to a Chromecast through the official
Cast Web Sender SDK, loaded lazily when a video player opens. A root
`CastProvider` owns the session across navigation and the in-app cast
indicator; a signed-in cast mints a 24-hour `/s/<token>` link (ADR 0010)
and an anonymous public cast uses the plain `/files` URL. The Default
Media Receiver is used as-is (ADR 0011); the local player keeps the
cookie-authenticated URL and pauses while the TV plays.

The SPA is an **installable PWA with no offline capability** (ADR 0009):
`web/public/manifest.json` (served as `application/json`) and the
committed icon set under `web/public/icons/` make it installable and
launchable standalone; `web/index.html` links them and carries the iOS
Add to Home Screen metadata, and Settings offers an install action only
while Chromium's `beforeinstallprompt` is available. It registers no
service worker and caches nothing, so an installed app always requires
the network.

Shipped screens and routes:

- `/login` — the only screen an unauthenticated visitor sees; posts to
  `/api/sf/auth`, then loads the returned token into the PocketBase SDK
  auth store (record API) while the response's `sf_session` cookie
  drives `/files/*`. Logout calls `DELETE /api/sf/auth` and clears the
  store. A `401` from any API call routes back to login.
- `/` — redirects to the first available vdir (empty state when none).
- `/v/:vdirId/*` — browse: breadcrumbs, list/grid toggle, sorting by
  name/size/modified, virtualized rendering (TanStack Virtual) for
  large directories, per-entry download links and media new-tab links,
  plus write actions gated by the user's role on the vdir (owner or
  `editor`): new folder, rename, move, delete, and multi-file upload.
- `/connections`, `/vdirs` — create/edit/delete the user's own
  connections and vdirs over the record API; secrets are write-only
  (never returned by the server, empty on edit = unchanged); the host-key
  fingerprint is optional (empty = pinned on first connection, trust on
  first use) and a connection's remote directory seeds the root path of
  new vdirs; vdir binding offers only the user's own connections.
- A vdir's owner manages shares in a dialog: grant `viewer`/`editor` by
  email (resolved through `/api/sf/users/lookup`), change the role, or
  revoke.

The vdir switcher separates "My vdirs" from "Shared with me" (the
`vdirs` read rule already exposes shared vdirs) and marks public ones.
Write actions and the in-app upload manager are the shipped `web-ui` /
`upload-queue` behavior; the browser queue is in-memory and survives
in-app navigation only (see the Upload flow).

## Data model (PocketBase collections)

| Collection | Fields (sketch) | Notes |
| ---------- | --------------- | ----- |
| `users` | PocketBase auth collection | built-in |
| `connections` | owner, label, host, port, username, auth method (`password`\|`key`), password, private key, key passphrase, host-key fingerprint (optional), remote directory | owner-only CRUD via API rules; secrets sealed at rest (AES-256-GCM, key in `_params`) and absent from every API response; host key pinned when supplied, otherwise captured on first successful use (ADR 0007); `remote_dir` is a record-only default for new vdir root paths |
| `vdirs` | owner, connection (rel), name, root path, is public | owner-only CRUD; reads (list/view) extend to users holding a share (back-relation rule, multi-match `?=`); a vdir must reference an own connection (rule-guarded on create and rebind); unique(owner, name); `is_public` grants anonymous read-only access |
| `vdir_shares` | vdir (rel, cascade), user (rel, cascade), role (`viewer`/`editor`), unique(vdir, user) | owner-managed via API rules; the grantee sees their own shares; drives both the record-API read extension and the `/api/sf` + `/files` middleware |
| `file_links` | vdir (rel, cascade), path (virtual), created_by (rel, cascade), token_hash (unique), expires_at | rows are created/read only by the custom mint and `/s/` routes; record rules are unset (superuser-only); tokens live only as a SHA-256 hash; fixed 24h expiry, creator access re-checked per redemption |

Every path operation through a vdir goes through one internal seam:
lexical anchoring under the vdir root, then a server-side walk that
follows symlinks and requires the resolved location to stay inside the
resolved root — operations target the resolved path, and any rejection
happens before a connection is dialed.

Access enforcement happens twice, on purpose:

- Record CRUD (creating connections/vdirs, editing shares) is enforced by
  PocketBase API rules (owner manages; shared users get read access to
  the vdirs shared with them and to their own share records).
- Remote filesystem operations (`/api/sf/*`, `/files/*`) are enforced by
  server middleware that resolves the requesting user against `vdirs` +
  `vdir_shares` per request (`viewer` = browse + download, `editor` = +
  upload/move/delete, owner outranks shares). Public vdirs bypass auth
  for read-only operations; writes always require owner or `editor` on
  that vdir. Both surfaces resolve through one shared seam
  (`internal/vdirauthz`) so they cannot drift, and because grants are
  never cached, removing a share or un-publishing applies to the next
  request even with a still-valid cookie.

## Failure and retry model

Because connections drop, the operation layer — not individual call sites
— owns retries:

- **Idempotent operations** (`ls`, `stat`, `mkdir`, `mv`, `rm`): retried
  automatically while the connection manager is in backoff/reconnect;
  the request may wait for the reconnection or fail with a retryable
  error, but never partially apply.
- **Streams** (upload, download): never restarted from byte zero.
  Downloads re-establish the SFTP read at the last served offset
  (clients transparently issue Range requests). Uploads resume from the
  last acknowledged offset via `WriteAt` within a single request; the
  SPA's upload manager restarts a canceled or failed upload from zero
  (see the Upload flow). A stream that cannot resume fails loudly
  rather than corrupting the target file.
- All SFTP errors are classified as *retryable* (network/EOF) or
  *permanent* (permission, not found) — permanent errors are never
  retried.

## Key flows

**Login** — SPA posts to `/api/sf/auth`; response carries the PocketBase
token (held by the JS SDK for `/api/*`) and sets the HttpOnly `sf_session`
cookie (consumed by `/files/*` and shareable download links).

**Browse** — SPA lists virtual directories (PocketBase records), lists a
directory via `/api/sf/.../ls`, renders entries; every file is a plain
`/files/...` URL.

**Stream a video** — a video entry opens the in-app player at
`/v/<vdir-id>/view/...`, which streams the file's plain
`/files/<vdir-id>/movie.mp4` URL through a native video element; the
element issues Range requests and each is served by an SFTP `ReadAt` at
the requested offset. The context menu's open-in-new-tab action still
reaches the raw URL in the browser's own player.

**Upload** — the SPA's in-app upload manager queues selected files and
streams each as a request body to `/api/sf/.../upload`, which writes to
SFTP as bytes arrive; progress comes from the transport's upload events.
The queue is in-memory, FIFO, one upload at a time, and survives in-app
navigation (only a reload or tab close ends it). "Pause" stops
dispatching (an active upload finishes or is canceled); "cancel" aborts
the request and the server discards its temp, publishing nothing;
re-enqueueing a canceled or failed item restarts from byte zero (no
cross-request resume protocol — within a single request the server still
resumes across SSH drops). Failures are classified: retryable
(network/`503`) is auto-retried a bounded number of times and then
offered an explicit retry; permanent (`403`/`404`/`400`/`500`) fails
immediately with no retry storm.

**Connection drop mid-transfer** — manager enters backoff and reconnects;
transfer resumes at its offset per the retry model above.

## Deployment

Single Docker image (ADR 0004): Node stage builds the SPA → Go stage
embeds it (`go:embed`) and cross-compiles a static binary → Alpine runtime
image. The binary serves the embedded SPA on the same HTTP listener as the
API: real files are served as-is, extensionless client routes fall back to
`index.html`, and the server-owned `/api/*`, `/files/*`, and `/_/*`
namespaces never fall back (a miss there is a server 404, not the shell).
One port, one SQLite volume. TLS termination is expected to be
external (reverse proxy); the `sf_session` cookie is set `Secure` when the
request is HTTPS.

The image is built and published only by CI: pushing a `v*` release tag
runs `.github/workflows/release-image.yaml`, which builds `linux/amd64`,
runs the browser E2E suite against the built image, checks an image-size
budget, and pushes `harbor.alexklingenbeck.de/my/stratofold:<version>`
(ADR 0006). There is no local Docker build path.

## Non-goals / future extensions

Explicitly out of scope for now (design seams exist, no commitments):

- Connection pools (more than one connection per SSH host)
- Offline behavior and any service worker: the app is installable but
  deliberately caches nothing (ADR 0009)
- Service-worker-backed uploads that survive tab close
- Horizontal scaling / multi-node (SQLite, single node)
- Protocols other than SSH/SFTP
- Server-side remote copy optimization (currently streams through the
  server)
