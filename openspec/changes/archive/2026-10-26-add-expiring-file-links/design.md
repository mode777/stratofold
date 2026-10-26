# Design

## Context

See `proposal.md` — Why. The pieces this design builds on:

- `/files/*` serves a vdir either because `is_public` is set or because the
  request carries a valid `sf_session` cookie whose user owns or holds a
  share on the vdir (`internal/fileserver/fileserver.go`). There is no
  per-file token, signed URL, or expiry anywhere.
- Access is resolved per request through `internal/vdirauthz` (`None` /
  `Viewer` / `Editor` / `Owner` plus `is_public`); nothing is cached, so
  share removal applies to the next request.
- `internal/fileserver` already owns the byte-serving semantics: sandbox
  resolution via `internal/vdir`, SFTP stat, `ETag`/`Last-Modified`/
  `If-None-Match`/`If-Modified-Since`, single-range parsing, the mime
  table, and mid-response reconnect through `sftpreadwrite`.
- Custom API routes live under `/api/sf/`; file routes (`/files/*`) live
  outside it. The SPA catch-all in `internal/webassets` treats `/api`,
  `/files`, and `/_` as reserved prefixes.
- The SPA knows whether a user is signed in (`useSession`) and whether the
  browsed vdir is public (`publicMode` or the vdir record); the context
  menu already copies absolute public `/files` URLs and reports "Copied"
  only after a successful clipboard write.
- PocketBase request logs record request URLs, so a token in a path is a
  logging concern, not just a transport concern.

## Goals / Non-Goals

**Goals:**

- A per-file read grant that needs no session, is bounded to 24 hours,
  and can be invalidated before expiry by losing access.
- Identical representation behavior to `/files` (Range, conditionals,
  content headers, reconnect) with no duplication of that logic.
- A URL that a Chromecast Default Media Receiver can fetch directly:
  no cookie, no custom headers, permissive CORS, no shared caching.
- No change to `/files`' access rules and no new way to write.

**Non-Goals:**

- Link management (listing/revoking active links), client-selected TTLs,
  directories, bulk minting, and a configurable public base URL.
- The video player and Cast integration; they consume this capability in
  later changes.

## Decisions

**D1 — Store links as `file_links` records with an opaque random token,
not as stateless signed URLs.** The record is the revocation handle: deleting
it, deleting the vdir/user, or losing the creator's share ends the grant.
A stateless HMAC token can only be revoked by rotating a key, and its
payload exposes the vdir id and path. Alternatives: (a) permanent public
vdir — rejected, exposes the whole tree; (b) HMAC-signed
`/files/...?sig=` — rejected for revocation granularity and path
disclosure; (c) record-API-created links — rejected because the record API
would have to return or store the plaintext token and would expose links
to list rules.

**D2 — Tokens are 256-bit random values, stored only as a SHA-256 hash.**
The mint response is the only place the plaintext token appears. A DB
dump, admin-UI record view, or accidental list API therefore yields no
working links. SHA-256 (not a password KDF) is appropriate because the
token is high-entropy. Alternatives: (a) store plaintext — simpler, but a
single read of the table hands out live grants; (b) keyed HMAC hash — no
gain over SHA-256 here, and it adds key management.

**D3 — Redemption is a separate `/s/<token>` route outside `/files` and
`/api`.** This keeps the `file-server` contract ("public or `sf_session`")
exactly as it is and makes the token route's behavior explicit. The route
is registered before the SPA catch-all, `/s` joins
`webassets.reservedPrefixes`, and the collision test asserts it stays out
of `/api/`. Alternatives: (a) `/files/<vdir>/<path>?token=` — rejected,
it complicates the `/files` auth matrix (cookie + token precedence) and
still puts the path in the media URL; (b) `/api/sf/links/<token>/content`
— rejected, media URLs do not belong in the API namespace and would
inherit API error/body conventions.

**D4 — Minting requires a session and current read access; any reader may
mint.** The handler resolves the cookie user and calls
`vdirauthz.Resolve(...).CanRead()`; anonymous requests are `401`, readers
without a grant on a non-public vdir are `403`. Viewers are allowed
because they can already download the bytes, and the link is one-file,
expiring, and tied to their access. Minting does **not** dial SSH or stat
the path: it stores the virtual path, and redemption resolves it through
the sandbox and requires a regular file. This keeps mint a SQLite-only
operation and avoids a new existence oracle. Alternatives: (a)
owner/editor only — rejected because a viewer could not cast a video
shared with them; (b) stat at mint — rejected for the extra dial and the
fail-fast value it does not add (redemption already returns `404`).

**D5 — Redemption re-checks the creator's current access.** The record
stores `created_by`; each redemption resolves that user against the vdir
and current shares. Removing the share ends the link on the next request,
matching the existing revocation invariant. An owner-created link
survives un-publishing because the owner still reads the vdir — the link
is a separate grant, not a side effect of publicness. A pure bearer link
(no creator check) was rejected: it would outlive share removal until
expiry, contradicting the product's immediate-revocation contract.

**D6 — The TTL is a fixed server constant of 24 hours.** No client
parameter, no sliding renewal. A link minted for a cast near the end of
its life can fail on a later Range request; minting a fresh link per cast
bounds that. Alternatives: (a) per-request `ttl` — rejected for abuse
surface and spec complexity; (b) sliding expiry on use — rejected, it
turns an active download into a permanent grant; (c) env/flag
configuration — deferred to a deployment change if a real need appears.

**D7 — Reuse the file server's serve path; do not duplicate it.** Extract
the existing `statResolved` + `serveFile` pair into an exported helper
(e.g. `fileserver.ServeResolved`) that the link handler calls after its
own authorization and directory rejection. The helper gains a
`HEAD` short-circuit so a HEAD request computes headers without reading
the file. Alternatives: (a) copy the handler — rejected, Range/conditional/
reconnect fixes would drift; (b) redirect to `/files` — rejected, a
redirect cannot carry the grant and would leak the vdir/path; (c) a new
generic streaming package — deferred until a third caller exists.

**D8 — Link responses carry `Cache-Control: no-store` and permissive CORS
with an `OPTIONS` handler.** The receiver fetches the URL from a different
origin; Google's Cast guidance flags CORS as a common failure, and some
paths use XHR/MSE. Allowed headers include `Range`, `If-Range`,
`If-None-Match`, and `If-Modified-Since`; exposed headers include
`Content-Range`, `Content-Length`, `Accept-Ranges`, `ETag`, and
`Last-Modified`. No credentials are required or read. `Content-Disposition:
inline` supplies the linked file's basename so a download is not named
after the token. Alternatives: (a) no CORS — rejected, cast risk; (b)
`Cache-Control: private` — rejected, a shared cache could still hold a
capability URL; (c) no disposition — rejected, token-named downloads.

**D9 — The token segment is redacted from PocketBase's request log.** A
`/s/` middleware rewrites the logged path (after the token has been
resolved) so the server's own `_logs` never retain a reusable link. This
is best-effort for the app; reverse-proxy access logs are a hosting-doc
concern (operators should redact or disable them for `/s/`). Alternatives:
(a) accept tokens in `_logs` — rejected, the log store is long-lived; (b)
disable request logging globally — rejected, it removes unrelated
observability.

**D10 — `file_links` is a PocketBase collection with no record-API
rules.** Fields: `vdir` (relation, cascade), `path` (text, required),
`created_by` (relation to users, cascade), `token_hash` (text, required,
unique index), `expires_at` (date, required, indexed). Nil rules mean
only superusers can reach the records through the record API; the custom
routes are the only client surface. Expired rows are swept opportunistically
on mint (a bounded delete) rather than with a new scheduler. Alternatives:
(a) plain SQLite table — possible, but collections give cascade deletes,
migration bookkeeping, and admin visibility consistent with the other
records; (b) per-link `revoked` flag — unnecessary, deleting the row is
revocation; (c) cron cleanup — deferred, a mint-time sweep bounds growth.

**D11 — The SPA derives the temporary-link affordance from session state
and publicness, and the mint/copy goes through a callback.** `BrowsePage`
passes `canMintLink = session.state === "authenticated" && !isPublic`.
The menu shows **Copy 24-hour link** only for that case and files; the
action calls an injected async `onCopyTemporaryLink` (owned by the page)
that mints, prefixes `window.location.origin`, and writes to the
clipboard, with the existing "Copied"/silent-failure pattern. Public
vdirs keep **Copy public link**; anonymous public visitors cannot mint
(no session), so the two actions never compete on the same file.
Alternatives: (a) let `ContextMenu` call the API directly — rejected, the
menu is presentational and this would make every menu test mock HTTP; (b)
offer both actions on a public vdir — rejected, redundant and confusing.

**D12 — The mint response carries a relative URL.** `201 {"url":
"/s/<token>", "expires_at": …}` keeps the API origin-agnostic and matches
how the SPA already builds absolute links. A server-configured base URL is
a deployment concern deferred to a later change.

## Risks / Trade-offs

- **Bearer token exposure** (chat, browser history, proxy logs) → bounded
  24h lifetime, hash-at-rest, server-log redaction, and hosting guidance
  for proxies; no token in the SPA's own player URL (later changes keep
  the receiver URL separate).
- **A viewer can grant anonymous access to one file for 24h** → accepted
  for the cast use case; the link dies with the viewer's access, and an
  owner who objects can remove the share. A future policy could restrict
  minting to writers.
- **No individual revocation UI in v1** → a leaked link can only be
  starved by expiry, share removal, or admin record deletion. The row
  model makes a management screen additive.
- **Expiry during long playback/pause** → accepted; each cast mints a
  fresh link, and the 24h window is far longer than normal sessions.
- **Cleanup-on-mint leaves rows if minting stops** → tiny rows, indexed
  expiry; an admin or a later scheduler can sweep them.
- **Reusing the serve helper touches `/files` code** → the existing
  fileserver test suite and the golden script are the regression guard;
  the export must not change headers or error behavior.
- **CORS `*` on a capability URL** → inherent to bearer links; the token
  is the only gate, and no credentials are accepted.
- **`no-store` increases revalidation fetches** → acceptable; a cast
  receiver fetches the stream directly and does not need a shared cache.
- **Admin visibility of link metadata** (path, creator, expiry, but not
  the token) → acceptable; admins already see vdir and connection
  metadata.

## Migration Plan

Additive migration `1770000005_file_links.go` creating the collection and
indexes; no backfill. Routes register in `internal/appserver` before the
SPA catch-all. Rollback removes the routes and the collection, which
invalidates every outstanding link; no other state is affected.

## Open Questions

None — per-link management, configurable TTL, and a configurable media
base URL are deliberately deferred, not unresolved.
