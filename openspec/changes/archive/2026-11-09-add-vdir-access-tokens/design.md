# Design

## Context

See `proposal.md` — Why. The relevant current state:

- `internal/fsapi` and `internal/fileserver` authenticate private
  requests only from the `sf_session` cookie; `internal/filelinks` mints
  links only from that cookie. There is no header-based credential.
- Access is resolved per request through `internal/vdirauthz`
  (`None` / `Viewer` / `Editor` / `Owner` plus `is_public`), with no
  cached grants, so share removal already applies to the next request.
- PocketBase's global CORS middleware defaults to `AllowOrigins: "*"`,
  does not allow credentials, and echoes requested headers on preflight.
  A cross-origin `Authorization` request is therefore transport-possible
  today; only the handlers ignore the header. Response headers such as
  `Content-Range` and `ETag` still need `Access-Control-Expose-Headers`.
- PocketBase impersonation is superuser-only and returns an unscoped auth
  token; its token key rotation signs out every device. It is not a user
  API key.
- `file_links` is the existing opaque-token precedent: 256-bit random
  tokens, SHA-256 at rest, no record-API rules, expiry checked per
  request, creator access re-checked on redemption.

## Goals / Non-Goals

**Goals:**

- One shared credential/authorization seam for the cookie and bearer
  paths, so `/api/sf/*`, `/files`, and link minting cannot drift.
- A token that is narrow by construction: one user, one vdir, one role
  cap, optional expiry, immediate revocation, and no secret in a URL.
- Session-only token management, with a bearer-only introspection route
  so a client can discover its scope.
- No behavior change for requests that do not send `Authorization`.

**Non-Goals:**

- Per-visitor consent, OAuth, refresh tokens, and the client library
  (changes 12–13 and 11).
- Multi-vdir or subpath-scoped tokens, origin allowlists as a security
  boundary, the iframe bridge, and token rotation.
- Changing the 24-hour link TTL or allowing tokens in link URLs.

## Decisions

**D1 — Tokens are opaque database-backed credentials, not PocketBase
tokens.** A `vdir_tokens` collection stores one row per credential:
`user` (relation to users, cascade), `vdir` (relation to vdirs,
cascade), `name` (text, required, 1–100 characters), `role` (select:
`viewer`/`editor`), `token_hash` (text, required, unique index),
`token_hint` (text, required), `expires_at` (date, optional),
`last_used_at` (date, optional), plus PocketBase's `created`/`updated`.
Indexes cover `user`, `vdir`, and `expires_at`. Record API rules are
unset, so the collection is superuser-only; the custom routes are the
only client surface. Token generation is 32 bytes of `crypto/rand`,
base64url-encoded with an `sf_v1_` prefix; only the SHA-256 hex hash and
a hint (`sf_v1_` + six characters + `…` + last four) are stored.
Revocation deletes the row; expiry is checked on every request.

Alternatives: (a) PocketBase impersonation token — rejected, superuser
only, unscoped, and revocable only by rotating the token key; (b) store
plaintext — rejected, a DB read hands out live grants; (c) a stateless
HMAC-signed token — rejected, no per-token revocation and the payload
would expose scope; (d) record-API-created tokens — rejected, the record
API would have to store or return the plaintext and would expose token
rows to list rules.

**D2 — A shared `internal/requestauth` seam resolves the credential and
the vdir decision; `internal/vdirtokens` owns token storage.** The
existing `authbridge.RequireSession` only understands the cookie. Adding
bearer parsing separately to `fsapi`, `fileserver`, and `filelinks`
would create three subtly different precedence and error rules. The new
`requestauth.FromRequest` returns an identity (user record, optional
token record); `requestauth.AuthorizeVdir` applies `vdirauthz` and maps
failures to response-ready `401`/`403`. `fsapi` and `fileserver` stop
reading cookies directly; `filelinks` uses the returned credential to
record the minting token.

Precedence: if `Authorization` contains a `Bearer` credential, it is
authoritative. An invalid/expired/revoked bearer is `401` even when a
valid cookie is also present. Without a bearer, a present cookie is
validated; an invalid cookie is `401`. With neither, the request is
anonymous. A non-Bearer `Authorization` scheme is ignored.

Alternatives: (a) extend `authbridge.RequireSession` to accept bearer —
rejected, it is middleware for session-only routes and mixing token
management would let a bearer manage tokens; (b) duplicate helpers per
handler — rejected, drift; (c) put token parsing in `vdirauthz` —
rejected, that package is the pure access decision seam and must not
depend on HTTP credentials.

**D3 — Bearer access is the smaller of the token role and the user's
current grant; public access alone does not keep a token alive.**
`AuthorizeVdir` resolves `d := vdirauthz.Resolve(app, vd, userID)`. For
cookie/anonymous requests it keeps today's rules (`d.CanRead()` for
reads, `d.CanWrite()` for writes). For a bearer token it requires the
token's vdir to match, then requires `d.Access >= Viewer` for reads and
`d.Access >= Editor` for writes, and additionally requires the token
role to be `editor` for writes. A `viewer` token is therefore read-only
even for an owner; an `editor` token cannot write after its user is
downgraded to viewer; a token on a public vdir still dies when its user
loses the underlying grant, while anonymous public reads remain
available without a token.

Status mapping: no credential is `401` "Authentication required";
invalid/expired/revoked bearer or invalid cookie is `401`; a valid token
on another vdir, or a user without a sufficient grant, is `403`.
Authorization happens before any SSH dial, preserving the existing
rejected-requests-never-dial invariant.

Alternatives: (a) token grants independent of shares — rejected, it
would outlive share removal and create a second authorization system;
(b) token embeds the vdir id in its plaintext so the server can skip
lookup — rejected, the opaque hash lookup is cheap and introspection
already exposes the scope; (c) allow a bad bearer to fall back to a
valid cookie — rejected, it hides credential mistakes and makes the
precedence ambiguous.

**D4 — Token management is session-only; introspection is bearer-only.**
`POST /api/sf/tokens`, `GET /api/sf/tokens`, and
`DELETE /api/sf/tokens/{id}` bind `authbridge.RequireSession`; a bearer
cannot mint, list, or revoke. `GET /api/sf/tokens/me` is the inverse: it
accepts only a bearer and returns `{id, name, vdir: {id, name}, role,
expires_at, last_used_at, token_hint}`. List responses contain the same
metadata for the requester's own tokens, never a hash or plaintext.

Mint validates the vdir exists, the requester has `d.Access >= Viewer`,
and the requested role does not exceed that access (`editor` requires
`d.Access >= Editor`). The name is required; `expires_at` is optional and
must be in the future. A successful mint returns `201` with the
plaintext token and metadata; that is the only response containing it.
Revoking another user's token is `404`; revoking an absent own token is
`204` (idempotent). This keeps a stolen token from escalating its own
lifecycle.

Alternatives: (a) bearer may manage tokens — rejected, a stolen token
could mint replacements or revoke the user's other tokens; (b) expose
the collection through the record API — rejected, it risks plaintext
and accidental listing; (c) return the vdir id inside the token format
instead of `me` — rejected, opaque tokens plus introspection are
simpler and do not leak scope into the credential.

**D5 — `/files` accepts bearer headers on non-public vdirs; native media
uses token-minted `/s` links.** Browsers cannot attach an
`Authorization` header to `<img>`, `<video>`, or a download element, so
the SDK uses the header for `fetch`/XHR and mints a short-lived `/s`
link for native media URLs. Tokens are never accepted in a query
parameter or path. `/files` on a public vdir is unchanged and ignores
the header. PocketBase's global CORS handles origin, methods, and
preflight header echoing; a small middleware on the `/files` group adds
`Access-Control-Expose-Headers` for `Accept-Ranges`, `Content-Length`,
`Content-Range`, `Content-Type`, `ETag`, `Last-Modified`, and
`Content-Disposition`.

Alternatives: (a) `/files?access_token=` — rejected, leaks into logs,
history, referrers, and caches; (b) a service worker to add headers —
rejected, no service worker and no offline behavior by design; (c)
proxy native media through a blob URL — rejected for large files and
streaming.

**D6 — Links minted by a token are bound to it.** `file_links` gains a
nullable `minted_by_token` relation to `vdir_tokens` with cascade
delete. Mint uses the shared credential result and records the token id
when the request was bearer-authenticated. Redemption additionally
requires the source token to exist, be unexpired, belong to the link
creator, and still be scoped to the link's vdir; otherwise it is `404`.
Cookie-minted links have an empty relation and keep their current
creator-access behavior. Deleting or expiring a token therefore ends its
links instead of leaving a 24-hour window after revocation.

Alternatives: (a) rely only on the creator-access recheck — rejected, a
revoked token's links would survive up to 24 hours because the user may
still have access; (b) copy the token hash onto the link — rejected, a
relation gives cascade delete and a single source of truth.

**D7 — "Connected apps" is a global Settings screen.** The SPA adds
`/settings/apps` and a Settings row. It lists the user's tokens with
name, vdir, role, hint, expiry, and last use; mints with a vdir select
(own and shared vdirs), a required name, a role capped by the effective
role, and an expiry preset (7/30/90/365 days or never); shows the
plaintext once in a dismissible panel with a copy action; and revokes
with confirmation. The list never calls the record API; it uses the
custom session routes through the existing `sfFetch` error mapping.

Alternatives: (a) put token creation only inside the vdir sharing screen
— rejected, the user has no single place to review or revoke all
credentials; (b) show the plaintext token again on later views —
rejected, it would require storing recoverable secrets; (c) a token
management screen available to anonymous visitors — rejected, Settings
is authenticated.

**D8 — Opportunistic expiry sweep and throttled last-use audit.**
Expired token rows are swept best effort on mint/list (like
`file_links`), using record deletes so the `file_links` cascade runs.
Correctness never depends on the sweep because expiry is checked on
every request. `last_used_at` is updated best effort after a successful
bearer request, at most once per five minutes per token, with a direct
SQLite update so it does not churn `updated` or fail the request.
Alternatives: (a) update every request — rejected, write amplification on
a read path; (b) no last-use audit — rejected, the UI needs it to spot
stale credentials; (c) a scheduler — deferred, a sweep on mint/list is
enough at this scale.

**D9 — Two additive migrations and no route namespace change.**
`1770000006_vdir_tokens.go` creates the collection and indexes;
`1770000007_file_links_minted_by_token.go` adds the nullable relation.
No backfill. The routes live under `/api/sf/tokens`, satisfying the
custom-route namespace invariant; `/files` keeps its route shape; no SPA
reserved-prefix change is needed because `/api` is already reserved.
Alternatives: one migration for both — rejected, separate migrations are
clearer to review and roll back; a new top-level namespace — rejected,
custom API routes belong under `/api/sf/`.

**D10 — The durable decision goes into ADR 0012.** The ADR records the
opaque user+vdir token model, the role-cap/revocation rule, session-only
management, and the rejection of PocketBase impersonation and unscoped
tokens. It is written during apply and indexed in
`docs/decisions/README.md`.

## Risks / Trade-offs

- **Token theft** (XSS on the client site, browser storage, logs) →
  single-vdir scope, role cap, optional expiry, immediate revoke,
  hash-at-rest, HTTPS guidance, and no token in URLs. A bearer token is
  still a bearer secret; the client library must document that a token
  in a public bundle is public.
- **No-expiry tokens** → the UI offers an explicit "Never" choice and
  shows the risk; revocation is one click, and last use makes stale
  tokens visible. A short default could be added without a spec change.
- **CORS `*`** → any origin can use a stolen token. Origin allowlists are
  not a security boundary (non-browser clients ignore them), so the
  containment is scope, expiry, and revocation. Documented in hosting.
- **Last-used write amplification** → throttled to once per five minutes
  and best effort; a failed audit update never fails the request.
- **Viewer-minted tokens** → viewers can already read the bytes; a
  viewer token adds no write and dies with the share. It can mint `/s`
  links, which are read-only and token-bound.
- **Migration rollback** → dropping `vdir_tokens` invalidates every
  outstanding token and, through the relation, its links; cookie and
  public access are unaffected.
- **Header precedence change** → no existing custom-route client sends
  `Authorization`, so the only observable change is for new bearer
  clients; a bad bearer with a good cookie is intentionally rejected.
- **Public vdir semantics** → public reads stay anonymous and token-free;
  a token on a public vdir still requires the user's grant, so
  un-publishing/removing a share cannot leave a private token alive.

## Migration Plan

1. Apply the two additive migrations; existing rows get a null
   `minted_by_token` and remain valid cookie-minted links.
2. Register the token routes and the shared auth seam; deploy with the
   SPA in the same binary (no separate frontend release).
3. Rollback removes the routes and drops the collection/relation; all
   tokens and token-minted links become invalid, while cookie, public,
   and cookie-minted link behavior is unchanged.

## Open Questions

None. Expiry presets, the exact last-use throttle, and the one-time
token panel layout are implementation details that do not change the
specs or the approach.
