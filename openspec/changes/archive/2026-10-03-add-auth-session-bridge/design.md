# Design — `add-auth-session-bridge`

## Context

The repo currently has no HTTP surface: change 1 delivered the SSH/SFTP
core as internal packages (`internal/sshconn`, `internal/sftpreadwrite`,
`internal/ssherr`) with no `main` package. This change introduces the
application server: PocketBase embedded as a library (ADR 0002) inside
the single Go binary (ADR 0001). The session-bridge shape — `sf_session`
cookie carrying the PocketBase token, validated in-process; custom
routes under `/api/sf/`; deadlines cleared for streaming routes — is
prescribed by ADR 0002 and `docs/architecture.md`; this design decides
the remaining mechanics. Motivation and scope: see proposal.md.

## Goals / Non-Goals

**Goals:**

- A runnable single binary serving PocketBase built-ins + `/api/sf/*`
  on one port, with SQLite persistence.
- A session bridge that is thin over PocketBase: no parallel session
  store, no custom token format.
- Middleware and deadline-clearing primitives that changes 4–6 can
  consume unchanged.

**Non-Goals:**

- Any filesystem route (`/files/*`, `/api/sf/*/ls|mv|rm|upload`).
- Per-device session tracking; sharing/authorization semantics; SPA.

## Decisions

### D1 — Bootstrap: `cmd/stratofold` with `pocketbase.New()`

The first `main` package lives at `cmd/stratofold/main.go` and embeds
PocketBase via its library API, binding custom routes in an
`OnServe`-phase hook. The SSH manager stays standalone (wiring to PB
records is change 3).

*Rejected:* root-level `main.go` — works, but `cmd/` keeps the root
clean and matches Go convention for future binaries (none planned).
*Rejected:* running PocketBase as a separate process — violates ADR
0001/0002 (one binary, one process, in-process cookie validation
requires library embedding).

### D2 — Cookie carries the PocketBase auth token; no parallel session store

`sf_session` holds the raw PocketBase auth token. Validation middleware
resolves it in-process via PocketBase's auth-record token lookup
(signature + expiry verified by PocketBase itself, record loaded for the
handler). Cookie lifetime equals the PocketBase auth-token duration
(default, tunable via PocketBase settings).

*Rejected:* opaque session id + server-side session table — a second
source of truth to keep consistent with token expiry/refresh; the bridge
is meant to be thin (ADR 0002).
*Rejected:* a separate long-lived "session token" distinct from the API
token — two lifetimes to reconcile and a bespoke token format to secure.

### D3 — Logout rotates the user's token key

PocketBase tokens are stateless JWTs keyed by the auth record's token
key. `DELETE /api/sf/auth` regenerates that key, which invalidates *all*
of the user's outstanding tokens at once — cookie and any held API
token, satisfying the spec's "invalid after logout" requirement without
new state. This is the same mechanism PocketBase uses on password
change, so it is idiomatic.

*Rejected:* per-session revocation table — per-device logout is not a
current product need; adding a session table now duplicates PocketBase
for one scenario. Revisit only if a real per-device requirement appears
(possible with sharing, change 6).
*Accepted trade-off:* logout is all-devices. Recorded as a known
limitation.

### D4 — Cookie attributes: HttpOnly, SameSite=Lax, Secure-on-HTTPS

`Secure` is set when `r.TLS != nil` **or** `X-Forwarded-Proto: https`
(deployment expects external TLS termination per `docs/architecture.md`).
SameSite=Lax so top-level navigations to shareable `/files/...` links
still carry the cookie for logged-in users, while cross-site POSTs do
not.

*Rejected:* SameSite=Strict — degrades the shareable-link story that
motivates the cookie in the first place. *Rejected:* dropping
`X-Forwarded-Proto` handling — behind a reverse proxy `r.TLS` is always
nil, silently producing non-Secure cookies in the primary deployment.
*Accepted trade-off:* a directly-reached HTTP server could be fooled by
a spoofed `X-Forwarded-Proto` into omitting `Secure`; such a deployment
has no TLS to protect anyway.

### D5 — Streaming deadline clearing as reusable middleware

A small middleware wraps handlers with `http.NewResponseController`,
clearing read/write deadlines (`SetReadDeadline(time.Time{})`, same for
write) and is applied to routes designated as streaming. Server-level
timeouts are set generously at bind time; `ReadHeaderTimeout` stays
modest (slowloris protection). Change 4 applies the same middleware to
`/files/*`.

For the long-request test, the embedded server is started with an
artificially short write timeout and a temporary streaming route bound
in test setup only — the shipped binary carries no test routes, and the
test proves deadline clearing without multi-minute wall-clock waits.

*Rejected:* zeroing all server timeouts unconditionally — loses the
protection for non-streaming routes (auth, admin UI) for no gain.
*Rejected:* hand-rolled hijacked-connection streaming — unnecessary;
`ResponseController` exists for exactly this.

### D6 — Route-collision assertion as a standing test

The test suite enumerates the routes registered under `/api/sf/`,
asserts every one is inside that prefix, and probes representative
PocketBase built-in endpoints (users auth endpoint, `/api/files/*`
record-attachment path, admin endpoints) to prove they still behave as
built-ins. PocketBase itself rejects conflicting route registrations;
the test pins the namespace discipline ADR 0002 requires so future
changes cannot erode it.

*Rejected:* relying on code review for namespace discipline — the
roadmap explicitly asks for an assertion, and the cost is one test.

### D7 — `users` collection stays stock PocketBase

The built-in `users` auth collection is used as-is (token durations and
signup policy are PocketBase settings, adjustable by the admin without
code). No migrations in this change.

*Rejected:* a custom `sf_users` collection or extra fields — nothing in
the auth bridge needs them; adding fields later is a forward-only
migration. Signup policy is revisited when the SPA lands (changes 7–8).

## Risks / Trade-offs

- [PocketBase API churn across versions] → pin the exact dependency
  version in `go.mod`; bump deliberately per ADR 0002's accepted cost.
  The bridge touches a narrow API surface (app bootstrap, route
  binding, token lookup, token-key rotation) to keep bumps cheap.
- [SDK refresh vs cookie staleness] → the JS SDK will refresh its token
  via built-ins while the cookie holds the earlier token; both stay
  valid until natural expiry, and client-initiated logout must call
  `DELETE /api/sf/auth` (not only discard the SDK token). Documented
  for the SPA change (7); no server action now.
- [All-devices logout (D3)] → accepted; noted in code and here as a
  known limitation.
- [Deadline-clearing test measuring the wrong thing] → test asserts on
  an explicitly configured short server timeout rather than defaults,
  so a regression (middleware not applied) fails the test instead of
  silently passing on generous defaults.

## Migration Plan

None required — first HTTP surface; SQLite file is created on first
run. Rollback is reverting the change; no data formats are introduced
beyond PocketBase's own schema.

## Open Questions

- Exact PocketBase version to pin (latest stable at implementation
  start). Deferrable: the design targets its stable library API, not a
  version-specific behavior.
