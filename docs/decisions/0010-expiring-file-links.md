# 0010 — Expiring capability links for session-less file access

Status: Accepted (2026-10, change `add-expiring-file-links`)

## Context

Every read path assumed either the `sf_session` cookie or a vdir marked
public. Consumers that fetch media themselves — most immediately a
Chromecast Default Media Receiver — carry neither, and making a whole
vdir public to hand out one file exposes every file in it. The product
already guarantees that access revocation takes effect on the next
request, so a new grant cannot be a permanent bearer token with no
revocation story. The change record is
`openspec/changes/add-expiring-file-links/`.

## Decision

Temporary file links are **opaque, database-backed capability URLs**:

- An authenticated reader mints a link for one virtual path with
  `POST /api/sf/vdirs/<vdir-id>/links`; the response carries the only
  plaintext copy of the token.
- The `file_links` collection stores the vdir, the virtual path, the
  creator, a **SHA-256 hash of the token**, and a fixed 24-hour expiry.
  The collection has no record-API rules (superuser-only).
- `GET`/`HEAD /s/<token>` is session-free, resolves the stored path
  through the vdir sandbox, and serves it with the exact `/files`
  representation semantics (`internal/fileserver.StatResolved` /
  `ServeFile`). Every failure — unknown, expired, revoked, missing,
  directory, sandbox-rejected — is a `404`.
- Redemption **re-evaluates the creator's current read access** through
  `internal/vdirauthz` on every request, so removing a share (or deleting
  the vdir/user) ends that creator's links immediately. An owner-created
  link survives un-publishing because the owner still reads the vdir.
- Link responses send `Cache-Control: no-store` and permissive CORS with
  an `OPTIONS` path for media receivers. The token segment is redacted from
  PocketBase's request log; operators are told to redact proxy logs too.
- `/files/*` access rules are unchanged; `/s/` is a separate file route
  outside `/api/`, registered before the SPA catch-all and reserved there.

The TTL is a server constant with no client parameter and no renewal.
There is no per-link management UI in this iteration; deleting the record
(admin) or losing the creator's access revokes a link early.

## Consequences

- Links are revocable and auditable by row, and can gain a management
  screen later without changing the token or URL format.
- A link is a bearer credential for exactly one file: whoever holds it can
  read that file until expiry. Its lifetime (24h) and one-file scope are
  the containment boundary; tokens never appear in the SPA's own player
  URL.
- The creator's access is the revocation unit. There is no per-link
  revocation available to end users yet, and no way to extend or renew a
  link.
- Any consumer that cannot use the session cookie (cast receivers, `curl`,
  download tools) can read a linked file, including cross-origin.
- The database stores no usable token; a DB dump or admin-UI record view
  cannot mint or replay a link. Request logs are the remaining in-app
  exposure and are redacted best-effort.

## Rejected alternatives

- **Permanent public vdir** — exposes every file in the tree, not the one
  file the user chose.
- **Stateless HMAC-signed URL** — cannot revoke one leaked link without
  rotating the signing key, and its payload exposes the vdir id and path.
- **`/files/...?token=` on the existing route** — complicates the
  public-or-cookie access matrix and still leaks the path into the media
  URL; a separate `/s/` route keeps `/files`' contract intact.
- **Links created through the record API** — record rules would have to
  return or store the plaintext token and would expose links to listing.
- **Sliding expiry or client-selected TTL** — an actively used download
  would become a permanent grant; a fixed server lifetime is simpler to
  reason about and test.
