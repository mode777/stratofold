# Proposal — `add-auth-session-bridge`

## Why

Stratofold's file access is browser-native: `<video>`, `<img>`, and
shareable download links speak plain URLs, not bearer tokens, while
PocketBase authenticates with tokens. ADR 0002 resolves this with a
session bridge — but it is flagged "research early" (roadmap risk R3)
because it also touches PocketBase's HTTP defaults, which could kill
long-running streams. Everything from `/files/*` (change 4) onward rides
on this working, so the bridge must exist and be proven before the file
server is built.

## What Changes

- PocketBase is embedded as a Go library (ADR 0002) and becomes the
  application server: one process, one port, SQLite persistence, the
  built-in `users` auth collection, and the admin UI — the first HTTP
  surface of the binary.
- Custom route `POST /api/sf/auth` authenticates a user against
  PocketBase and returns the PocketBase auth token *and* sets the
  HttpOnly `sf_session` cookie; `DELETE /api/sf/auth` clears both the
  cookie and the token server-side (logout).
- An in-process cookie-validation middleware (`sf_session` → auth
  record via PocketBase token lookup) that protected routes will use —
  `/files/*` consumes it in change 4, sharing enforcement in change 6.
- Streaming-route deadline handling: routes that stream clear
  per-request read/write deadlines (`http.NewResponseController`) and
  server timeouts are configured generously, so a long transfer cannot
  be killed by framework defaults (the R3 timeout half).
- Route-namespace guarantee: all custom routes live under `/api/sf/`
  and none shadows a PocketBase built-in namespace (PocketBase owns
  `/api/files/*` for record attachments).

## Capabilities

### New Capabilities

- `auth-session`: the session bridge between PocketBase token auth and
  browser-native cookie auth — login/logout routes, `sf_session` cookie
  issuance/validation/clearing, cookie attributes, protection of
  non-public resources, and deadline handling for streaming routes.

### Modified Capabilities

None — no existing capability's requirements change; the existing
`sftp-streaming` and `ssh-connection-management` specs are untouched.

## Impact

- New dependency: `github.com/pocketbase/pocketbase` (pinned version),
  which brings its pure-Go SQLite driver — `CGO_ENABLED=0` is preserved
  (ADR 0001).
- New server bootstrap: the module gains its first `main` package and
  HTTP wiring; a running binary now serves HTTP (PocketBase + custom
  routes) on one port.
- New internal package(s) for the auth bridge and middleware; the SSH
  connection manager from change 1 stays standalone (wiring to
  PocketBase records is change 3).
- Verification additions: an httptest suite over the bridge, a
  route-collision assertion, and a long-request test; the existing
  fixture/gates are unaffected.
- ADRs: **No new ADR — 0001** (single Go binary) **and 0002**
  (PocketBase embedded, session bridge, deadline clearing) **already
  record the durable decisions this change implements.** Affected
  docs: `docs/architecture.md` (PocketBase core + custom API sections
  already describe this behavior; update only if implementation
  diverges) and `AGENTS.md` (dev workflow gains run/superuser-setup
  steps).

## Non-goals

- No `/files/*` routes (change 4) — the cookie middleware and deadline
  handling are built and tested here as reusable pieces, not wired to
  file serving.
- No `connections`/`vdirs` collections, no virtual directories, no
  wiring of the SSH manager to PocketBase records (change 3).
- No sharing, roles, or public-vdir semantics (change 6).
- No SPA or login UI (changes 7–8) — auth is exercised over HTTP
  directly.
- No token-refresh or password-reset customization — PocketBase
  built-ins are used as-is.
