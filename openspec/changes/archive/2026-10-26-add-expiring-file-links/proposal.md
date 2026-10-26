# Proposal

## Why

Every read path in Stratofold assumes either a browser carrying the
`sf_session` cookie or a vdir marked public. Consumers that fetch media
on their own — most immediately a Chromecast receiver playing through the
Default Media Receiver — have neither: they cannot send the user's cookie,
and making the whole vdir public to cast one video exposes every file in
it. The capability we need is narrower than a public vdir and longer-lived
than a request: a per-file, time-bounded, revocable URL that grants read
access to exactly one file and nothing else.

## What Changes

- Add a **temporary file link** primitive: an authenticated reader can
  mint a link for one file on a vdir they can read. The link is valid for
  24 hours, scoped to that vdir and virtual path, stored as a record, and
  served without any session.
- New route `POST /api/sf/vdirs/<vdir-id>/links` with body `{"path": …}`
  returns `201 {"url": "/s/<token>", "expires_at": …}`. It requires a
  valid session and read access on the vdir; anonymous requests are
  rejected before any remote operation.
- New session-free route `GET`/`HEAD /s/<token>` serves the linked file
  through the same vdir sandbox and with the same representation
  semantics as `/files/*` (Range, conditionals, content headers, mid-stream
  reconnect), or `404` for an unknown, expired, revoked, moved, deleted,
  or directory target.
- Link tokens are cryptographically random, stored only as a hash, and
  never listed by any API. Link responses set `Cache-Control: no-store`
  and permissive CORS/allow-headers needed by media receivers; token
  path segments are redacted from the server's request log where possible.
- Redemption re-checks the creator's current read access, so removing a
  share (or deleting the vdir/user) invalidates that creator's links on
  the next request; an owner-created link survives un-publishing until it
  expires.
- The browse context menu gains **Copy 24-hour link** for file entries on
  a non-public vdir, available to signed-in readers; public vdirs keep
  the existing **Copy public link** (permanent while public), and
  anonymous public visitors get only that existing action.

Assumptions (recorded, not blocking): the TTL is a fixed server constant
of 24 hours with no client-selected expiry; any signed-in reader
(owner, editor, or viewer) may mint a link because they can already
download the bytes and the link is one-file, expiring, and tied to their
current access; the copied URL is absolute (`window.location.origin` +
`/s/<token>`), and `/files/*` access rules are unchanged.

## Capabilities

### New Capabilities

- `file-links`: minting, storing, expiring, revoking, and session-free
  redemption of per-file read links, including their scoping, secrecy,
  and representation semantics.

### Modified Capabilities

- `web-ui`: the entry context menu gains the temporary-link action, and a
  new requirement pins what the copied 24-hour link is, who may copy it,
  and when it is offered.

## Impact

- Code: new `internal/filelinks` package (mint route, `/s/{token}` route,
  record lookup, expiry/revocation checks), a PocketBase migration for the
  `file_links` collection, a shared serving helper extracted from
  `internal/fileserver` so both routes stream identically, registration in
  `internal/appserver` (with `ClearStreamDeadlines`), `/s` added to
  `internal/webassets`' reserved prefixes, and `web/src/lib/filesApi.ts` +
  `web/src/components/ContextMenu.tsx` + `web/src/pages/BrowsePage.tsx` for
  the copy action.
- Tests: new Go tests for the mint/redemption/expiry/revocation matrix and
  header behavior, `internal/appserver/collision_test.go` and
  `internal/webassets` coverage for the new prefix, and component tests
  for the menu action and clipboard failure handling.
- Docs: **new ADR `docs/decisions/0010-expiring-file-links.md`** (the
  session-less capability-link security model) plus the
  `docs/decisions/README.md` index; `docs/architecture.md` (route, data
  model, access flow), `docs/using-stratofold.md` (copying a 24-hour
  link), `docs/hosting.md` (TTL/expiry expectations, proxy and access-log
  handling for `/s/`), and the `AGENTS.md` web-UI/route bullets.
- No breaking change: `/files/*`, the record API, and existing public
  links keep their behavior.

## Non-goals

- No link-management screen (list/revoke active links) and no record-API
  exposure of links; the stored records exist so a later change can add
  management without a migration.
- No client-selected or extending TTL, no sliding expiry, no maximum-use
  or one-time links.
- No links for directories, no write-capable links, no bulk link creation.
- No change to `/files/*` access rules or to the meaning of `is_public`.
- No configurable media base URL or proxy-aware origin setting in this
  change; the client builds the absolute URL from its own origin.
- No Cast/player work here; consuming a link from the video player is the
  later `add-chromecast-playback` change.
