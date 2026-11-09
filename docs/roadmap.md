# Roadmap

The high-level work broken into individual OpenSpec changes, ordered
**highest risk first** — risk meaning "could invalidate the architecture or
the core promise", not "most code". The core promise: stream tens of
gigabytes directly to/from SSH hosts through virtual directories, with
Drive-like UX.

Each item below is one future change proposal (created via the
`openspec-propose` skill when work starts). The spec names pre-assigned
here are what the proposal must declare. Process rules: `openspec/config.yaml`.

## Baseline validation (every change)

- `npx openspec validate --all --strict` must pass (docs and specs).
- Each proposal's tasks include its named verification harness (per
  `openspec/config.yaml` rules) — the strategies below are that harness.
- Backend verification needs a **throwaway SSH/SFTP server fixture**
  (dockerized OpenSSH with a seeded dataset, including a sparse multi-GB
  file). Built once in change 1, reused by every later change.

## Risk ledger

| # | Risk | Why it matters | Retired by |
| - | ---- | -------------- | ---------- |
| R1 | Mid-stream disconnect: transfers restart or corrupt | Breaks "tens of GB" promise | 1 |
| R2 | Single-channel SFTP throughput too low | Core promise | 1 |
| R3 | PocketBase token vs cookie for `/files/*`, streaming timeouts | File access for browsers breaks | 2 |
| R4 | Path traversal escaping the virtual directory root | Security hole | 3 |
| R5 | Large uploads buffered in RAM/disk on the host | Violates "stream, don't cache" | 5 |
| R6 | Retry mechanism partially applies or duplicates mutations | Data integrity | 1, 5 |
| R7 | SPA upload queue can't reliably upload in background | Vision's UX promise | 8 |
| R8 | Third-party access credential leaks or is over-broad | A frontend-only site cannot keep a secret; an unscoped bearer token is full-account access | 10, 11 |

## Changes, in order

### 1. `add-sftp-streaming-core` — connection manager + resumable SFTP streams

Highest risk: everything else assumes transfers survive disconnects and
run at line rate over one SFTP channel.

- **Goal**: internal Go capability — on-demand SSH connections, 20 min
  idle TTL, exponential backoff reconnect, offset-based reads/writes,
  error classification (retryable vs permanent).
- **Specs**: `ssh-connection-management`, `sftp-streaming`.
- **ADRs**: 0001, 0003.
- **Out of scope**: virtual directories, HTTP surface (change 3+).
- **Validation**:
  - Integration tests against the SSH fixture: byte-exact reads/writes at
    offsets; checksum equality after read and write paths.
  - Chaos/resume test: kill the SSH connection at random offsets
    repeatedly; after backoff and resume, final checksum must match
    (retires R1, R6 for streams).
  - Throughput gate: streaming throughput within a fixed margin (e.g.
    ≥80%, tunable) of raw `scp`/`dd` on loopback (retires R2).
  - Memory assertion: no transfer buffers the whole file in RAM
    (instrument peak memory with a multi-GB sparse file).
  - Unit: backoff timing (base/factor/cap/jitter), idle-TTL eviction,
    error classification table.

### 2. `add-auth-session-bridge` — PocketBase embed, login, cookie bridge

Retires the vision's explicitly flagged "research early" risk (R3).

- **Goal**: embedded PocketBase, `users` collection, custom `/api/sf/auth`
  route that returns the PB token *and* sets the HttpOnly `sf_session`
  cookie; in-process cookie validation middleware; streaming routes clear
  per-request deadlines.
- **Specs**: `auth-session`.
- **ADRs**: 0001, 0002.
- **Out of scope**: `/files/*` itself (change 4), sharing (change 6).
- **Validation**:
  - httptest suite: login sets HttpOnly/SameSite/Secure cookie; private
    resource denies anonymous, accepts valid cookie; expired/invalidated
    tokens rejected; logout clears.
  - Route-collision assertion: no `/api/sf/*` route shadows a PocketBase
    built-in namespace.
  - Long-request test: a streaming request outlives the default HTTP
    timeouts (deadlines actually cleared).
  - Manual: cookie honored by a plain `<video>` tag (no JS auth header).

### 3. `add-virtual-directory-sandbox` — vdirs as isolated roots

Security-critical: every later path operation rides on this sandbox (R4).

- **Goal**: `connections` + `vdirs` collections (PB records + API rules),
  lexical path resolution that pins all access under the vdir root,
  owner-only management.
- **Specs**: `virtual-directories`.
- **ADRs**: 0002, 0003.
- **Validation**:
  - Traversal test table: `../`, URL-encoded dots, absolute paths, null
    bytes, redundant segments, backslashes — all resolve inside the root
    or are rejected.
  - Remote symlink escape attempt (SFTP realpath/readlink) is detected
    and rejected.
  - Authz matrix: owner vs non-owner for record CRUD and connection use.
  - Integration: listing/serving through a vdir root actually maps to the
    remote subfolder.

### 4. `add-streaming-file-server` — `/files/*` with Range, mime, index.html

The user-visible read path and the vision's "state-of-the-art file
server".

- **Goal**: `GET /files/<vdir-id>/<virtual-path>` with HTTP Range,
  ETag/Last-Modified/304s, mime types, `index.html` resolution; auth
  middleware (cookie) for non-public vdirs; streaming via SFTP offset
  reads.
- **Specs**: `file-server`.
- **ADRs**: 0002, 0003.
- **Out of scope**: public/shared semantics beyond "is_public bypasses
  auth" (change 6); listing stays API-only.
- **Validation**:
  - Range test matrix: start-end, suffix, open-ended, invalid → 416;
    byte-exact slices vs source checksums.
  - Conditional requests: If-None-Match / If-Modified-Since → 304.
  - Content: correct mime for a type table; `index.html` served for
    directory URLs where present.
  - Mid-transfer reconnect: kill SFTP during a Range response; a client
    Range retry succeeds (R1 at the HTTP layer).
  - Golden curl matrix script over the whole matrix, kept in-repo.

### 5. `add-filesystem-api` — `/api/sf/*` listings, mutations, uploads

The write path; the retry model proves itself on mutating operations (R5,
R6 remainder).

- **Goal**: `ls`, `mkdir`, `mv`, `rm`, `upload` endpoints as sketched in
  `docs/architecture.md`; uploads stream request body → SFTP with
  temp-name-then-rename atomicity; idempotent ops retry through
  reconnection.
- **Specs**: `filesystem-api`.
- **ADRs**: 0003.
- **Validation**:
  - Integration: each operation against the SSH fixture, including nested
    paths and recursive rm.
  - Retry tests: injected disconnect during ls/mv/rm is retried
    transparently, never partially applied (idempotency per operation);
    upload disconnect resumes at last offset (R5/R6).
  - Upload memory ceiling: peak process RAM stays flat for a multi-GB
    upload (no host buffering).
  - Atomicity: interrupted upload leaves no file at the target path.
  - Concurrency: parallel operations pipeline over the single SFTP
    channel without interleaving corruption.

### 6. `add-sharing-and-public-access` — shares, roles, public vdirs

Turns single-owner storage into the Drive-like sharing product.

- **Goal**: `vdir_shares` with `viewer`/`editor` roles; public vdirs allow
  anonymous browse + download; enforcement in both PB API rules and the
  `/api/sf/*` + `/files/*` middleware; sharing UI comes later with the SPA.
- **Specs**: `sharing-access-control` (extends `file-server`,
  `filesystem-api` rules).
- **Validation**:
  - Full permission matrix (anonymous / other user / viewer / editor /
    owner) × (ls, download, upload, mv, rm) × (API, /files) — table-driven
    tests.
  - Public vdir: anonymous listing and download work; write is impossible.
  - Revocation is immediate: removing a share or un-publishing takes
    effect on the next request, even with a still-valid cookie.
  - `openspec validate --all --strict` (rules live in spec deltas).

### 7. `add-web-ui-browsing` — SPA skeleton, login, browse, download

Frontend foundation on the now-stable API surface.

- **Goal**: Vite/React/TS/Tailwind app (ADR 0005) embedded-ready; login
  via PB SDK + `/api/sf/auth`; Drive-like browse views (list/grid,
  virtualized), downloads and `<video>` playback via `/files/*`.
- **Specs**: `web-ui`.
- **ADRs**: 0004, 0005.
- **Validation**:
  - Component tests (Vitest + Testing Library): render, sort, navigate;
    virtualization handles 10k+ fake entries.
  - E2E (Playwright) against dev server + SSH fixture: login → browse →
    download; video play with Range requests visible in the network log.
  - Mobile-viewport smoke (mobile-first claim) and keyboard navigation
    basics.
  - `openspec validate --all --strict`.

### 8. `add-web-ui-file-management` — Drive-like operations + background uploads

Retires R7 — the last vision promise without a proven mechanism.

- **Goal**: upload/download/move/rename/delete/mkdir in the UI; in-app
  upload-manager queue that keeps uploading across navigation; progress,
  pause/cancel, error surfaces distinguishing retryable vs permanent
  failures.
- **Specs**: `web-ui` (delta), `upload-queue`.
- **Validation**:
  - Unit: queue service (ordering, retry on transient failure, dedupe,
    cancel).
  - E2E: upload small + large file with progress; **navigate away
    mid-upload, upload still completes** (the R7 acceptance test);
    move/rename/delete/mkdir flows; permanent-failure error surfaced
    without retry storm.
  - `openspec validate --all --strict`.

### 9. `add-docker-packaging` — single image, embed, ship

Last: packages what the earlier changes proved, adds nothing new
conceptually.

- **Goal**: multi-stage Dockerfile (Node → Go `CGO_ENABLED=0` with
  `go:embed` → Alpine); one port, SQLite volume; SPA served by the binary
  (ADR 0004).
- **Specs**: `deployment`.
- **Validation**:
  - Full Playwright suite executed against the container image, not the
    dev server.
  - Persistence: SQLite volume survives container restart.
  - Graceful shutdown: in-flight requests drained or failed cleanly.
  - Image size budget gate (e.g. < 100 MB, tunable) recorded in CI.

### 10. `add-vdir-access-tokens` — vdir-scoped bearer access for third-party apps

Option B from the 2026-11 exploration: a user mints a read-only or
read/write token bound to exactly one vdir and hands it to a client.
This is the credential primitive the client library (change 11) rides
on. PocketBase impersonation is explicitly rejected: it is
superuser-only, unscoped, and revocable only by rotating the user's
token key (which signs out every device).

- **Goal**: a `vdir_tokens` collection (`user`, `vdir`, `role`, `name`,
  `token_hash`, `token_prefix`/last4, `expires_at`, `last_used_at`) with
  no record-API rules; mint/list/revoke under `/api/sf/tokens` using the
  existing `sf_session` cookie; accept `Authorization: Bearer sf_v1_…`
  on the `/api/sf/vdirs/*` filesystem routes, `/files` for non-public
  vdirs, and the `/s` mint route. A token's effective access is
  `min(token role, vdirauthz.Resolve(user, vdir))`, re-resolved on every
  request, so share removal, role changes, un-publishing, and deletion
  take effect immediately. The owner or a share holder may mint a token
  capped at their current role; tokens never outlive the grant. Tokens
  are stored only as SHA-256 hashes and shown once at mint. Private
  media URLs come from `/s`; tokens never appear in a URL, and a link
  minted by a token is revoked when that token is revoked (links record
  the minting token id). Settings gets a "Connected apps" screen to
  name, expire, list, and revoke tokens and show last use.
- **Specs**: `vdir-access-tokens` (new); deltas to `filesystem-api`,
  `file-server`, `file-links`, `web-ui`.
- **ADRs**: 0012 — scoped capability tokens for third-party access.
- **Out of scope**: per-visitor consent/OAuth (change 12), multi-vdir
  tokens, subpath scopes, token-bound origin allowlists as a security
  boundary, and the iframe bridge.
- **Validation**:
  - Go auth matrix: cookie vs bearer; valid/expired/revoked; token used
    on the wrong vdir; read-only token cannot write; `editor` token on a
    `viewer` share still cannot write; anonymous public access unchanged;
    every denial happens before an SSH dial.
  - Revocation: deleting the token, the vdir, the user, or the user's
    share ends access on the next request; token plaintext never appears
    in the database, API responses, or request logs.
  - Media: a bearer-minted `/s` link serves Range/conditional requests;
    revoking the minting token kills that link immediately.
  - CORS: a preflight from a foreign `Origin` allows `Authorization`,
    and the SDK-readable headers (`Content-Range`, `ETag`, …) are
    exposed.
  - Component tests for the Settings mint/list/revoke screen;
    `openspec validate --all --strict`.

### 11. `add-client-library` — typed browser SDK + static test client

The integration surface for frontend-only sites. It consumes change
10's scoped bearer tokens and adds no authorization semantics of its own.

- **Goal**: a zero-dependency TypeScript package (`@stratofold/client`)
  with ESM and IIFE builds plus bundled types; `list`, `read`, `upload`
  (progress/abort), `mkdir`, `move`, `remove`, `temporaryUrl`,
  `fileUrl`, `tokenInfo`, and the SPA's deterministic error classes.
  Explicit server base URL and header-only auth; private media via
  minted `/s` URLs. A private, frontend-only static test client in
  `client/test-client/` is deployed to GitHub Pages and exercises the
  built package from a real foreign origin. The server hosts no client
  copy and gains no new route. Docs state the token-audience rule: a
  token shipped in a public bundle is public.
- **Specs**: `client-library` (new).
- **ADRs**: 0013 — client distribution (npm source of truth, no
  instance-hosted embed, static test client is verification-only).
- **Out of scope**: npm publishing from CI, React/Vue wrappers, a
  central `cdn.stratofold.app`, Node upload progress, offline
  behavior, and the per-visitor connect flow (change 12).
- **Validation**:
  - Unit: every operation against a fake fetch/XHR; error mapping;
    upload progress/abort; `temporaryUrl` expiry and no token in the
    URL; public mode; the README snippets type-check.
  - Bundle: ESM + IIFE smoke tests, zero runtime dependencies, types
    compile, `npm pack --dry-run` contains only `dist` and the README.
  - Cross-origin E2E on the verification server: the test client on a
    second origin lists, uploads, range-reads, redeems a temporary link
    cookieless, browses a public vdir, and no request URL carries the
    token.
  - `openspec validate --all --strict`.

## Conditional follow-ons

Not scheduled. Start only when a concrete integration needs them; neither
is a prerequisite for changes 10–11.

### 12. `add-app-connect-flow` — per-visitor authorization

Trigger: a multi-user third-party site where each visitor connects their
own account (Option C from the exploration).

- **Goal**: a device-code flow first (site shows a short code, the user
  approves vdir/role at Stratofold, the site polls for a scoped token),
  with the popup + `postMessage` handshake as a later UX upgrade. The
  user's existing `sf_session` authorizes the approval; the resulting
  credential is a change-10 token bound to that user and vdir.
- **Specs**: `app-connect-flow` (new); deltas to `vdir-access-tokens`,
  `web-ui`.
- **ADRs**: 0014 — connect flow and consent.
- **Out of scope**: registered OAuth clients and refresh tokens (change
  13), iframe bridge, and third-party cookie reliance.
- **Validation**: device-code matrix (expiry, single use, approval,
  denial, scope display, revoke before poll, no token in the activation
  URL); component tests for the approval screen; cross-origin E2E.

### 13. `add-oauth-pkce` — standard third-party app authorization

Trigger: an ecosystem of independent third-party apps, or integrations
that need standard refresh/rotation semantics.

- **Goal**: authorization-code + PKCE public clients, client
  registration, redirect-URI allowlists, short-lived access tokens,
  rotating refresh tokens with reuse detection, and standard revocation.
- **Specs**: `oauth-pkce` (new); deltas to `vdir-access-tokens`,
  `web-ui`, `deployment`.
- **ADRs**: 0015 — OAuth 2.1 public-client profile.
- **Out of scope**: confidential clients, dynamic client registration,
  and acting as a general identity provider.
- **Validation**: PKCE/redirect-URI/state matrices, refresh rotation and
  reuse detection, revocation, consent-scope tests, cross-origin E2E.

## Sequencing notes

- 1 → 2 → 3 are strictly sequential (each builds on the previous seam).
- 4, 5, 6 can partially parallelize after 3 (read path / write path /
  authz), but 6 touches both.
- 7 needs the API of 4–5; 8 builds on 7; 9 is last.
- 10 is the first post-core change: it builds on the vdir/authz seams
  from 3 and 6 and the `/s` machinery from the expiring-links change.
- 11 builds on 10 and the existing SPA-facing API (4, 5); it adds no
  server route (there is no `/embed`; the package ships via npm).
- 12 and 13 are gated follow-ons: do not start them until the trigger
  in each entry is real. Option B (10 + 11) is the chosen first step and
  does not depend on them.
- Start each change with the `openspec-propose` skill; archive with
  `openspec-archive-change` so specs under `openspec/specs/` stay the
  source of truth.
