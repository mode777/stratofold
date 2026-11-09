# Proposal

## Why

A third-party browser app cannot use Stratofold today. Every private
read and write path requires the HttpOnly `sf_session` cookie, which
only Stratofold's own origin can send, and the custom routes do not read
`Authorization`. PocketBase auth tokens are not a substitute: they are
full-account, cannot be scoped to a vdir, and can only be revoked by
rotating the user's token key (which signs out every device).
PocketBase's impersonation endpoint is superuser-only admin tooling, not
a user API key.

A frontend-only site needs a credential it can hold and send on a
cross-origin request: narrow (one vdir), revocable, and capped by the
user's current access. This is the credential primitive that makes the
planned client library (roadmap change 11) possible.

## What Changes

- Add **vdir access tokens**: a user-bound, single-vdir bearer credential
  with a `viewer` or `editor` role, a required name, an optional expiry,
  a last-used timestamp, and a non-secret display hint. Tokens are
  generated from 256 bits of randomness, prefixed `sf_v1_`, and stored
  only as a SHA-256 hash; the plaintext appears once in the mint
  response.
- Add session-only management routes:
  - `POST /api/sf/tokens` mints a token for one vdir, capped by the
    requester's current role.
  - `GET /api/sf/tokens` lists the requester's own token metadata only.
  - `DELETE /api/sf/tokens/{id}` revokes one of the requester's tokens.
  - `GET /api/sf/tokens/me` lets a bearer client discover its own scope
    (vdir id/name, role, expiry) without exposing the secret.
- Accept `Authorization: Bearer sf_v1_…` on the filesystem API
  (`/api/sf/vdirs/*`), `/files` for non-public vdirs, and the
  `POST /api/sf/vdirs/{id}/links` mint route. A bearer credential is
  authoritative when present: an invalid, expired, or revoked token is
  `401` even if a valid cookie is also present.
- Enforce the token's vdir scope and its role against the user's current
  access on every request: `min(token role, vdirauthz.Resolve(user,
  vdir))`. A token used on another vdir is `403`; a `viewer` token
  cannot write; an `editor` token on a `viewer` share still cannot
  write. Share removal, role changes, un-publishing, deletion, expiry,
  and revocation apply to the next request, and denied requests never
  dial SSH.
- Bind file links minted through a token to that token: revoking or
  expiring the token ends its links. Cookie-minted links keep their
  current behavior.
- Expose the representation headers a cross-origin SDK needs
  (`Content-Range`, `ETag`, etc.) on `/files`; PocketBase's global CORS
  already permits `Authorization` preflights.
- Add **Settings → Connected apps** to list, create, show-once, and
  revoke tokens, with the role choices capped by the user's role on the
  selected vdir.
- Record the durable decision in a new ADR and update the architecture,
  user, hosting, and agent docs.

No breaking change: cookie-authenticated and public-vdir requests keep
their current behavior when they do not send `Authorization`. The record
API keeps no token rules, so tokens are never visible through
PocketBase's record endpoints.

Assumptions (recorded, not blocking): token names are required; expiry
is optional and means "until revoked" when omitted; a viewer may mint
only a `viewer` token, while an editor or owner may mint either role;
public-only read access does not let a signed-in user mint a token
(a public file already needs no token); token rotation is revoke-and-mint,
not automatic.

## Capabilities

### New Capabilities

- `vdir-access-tokens`: minting, storing, scoping, presenting,
  introspecting, expiring, and revoking single-vdir bearer credentials,
  including the bearer authorization rule and cross-origin behavior.

### Modified Capabilities

- `filesystem-api`: the access-control requirement accepts a scoped
  bearer token in addition to the `sf_session` cookie, with the role and
  vdir-scope matrix.
- `file-server`: `/files` access control accepts a scoped bearer token
  for non-public vdirs; public behavior is unchanged.
- `file-links`: link minting accepts a scoped bearer token, and links
  minted through a token die when that token is revoked or expires.
- `web-ui`: Settings gains a Connected apps screen for token management.

## Impact

- Code: new `internal/vdirtokens` (collection, mint/list/revoke,
  introspection, hashing) and `internal/requestauth` (cookie-or-bearer
  credential resolution and the shared vdir authorization seam); new
  migrations for `vdir_tokens` and the `file_links.minted_by_token`
  relation; bearer wiring in `internal/fsapi`, `internal/fileserver`, and
  `internal/filelinks`; route registration and collision coverage in
  `internal/appserver`; a `web/src/pages/TokensPage.tsx` (or
  `AppsPage.tsx`) plus a token API wrapper, route, and Settings row.
- Tests: migration/schema checks; token generation, hash, hint, expiry,
  and enumeration matrices; cookie/bearer/anonymous × read/write ×
  owner/viewer/editor/other × correct/wrong vdir matrices; revocation
  and share-removal immediacy; no-dial assertions; link-bound
  revocation; CORS preflight and exposed headers; component tests for
  the Connected apps screen.
- Docs: **new ADR `docs/decisions/0012-vdir-access-tokens.md`** plus the
  `docs/decisions/README.md` index; `docs/architecture.md` (token data
  model, bearer flow, link binding); `docs/using-stratofold.md`
  (Connected apps, secret handling, revoking); `docs/hosting.md`
  (bearer secrets, HTTPS, CORS, revocation, token links); `README.md`
  (feature list); `AGENTS.md` (capability bullet). No dependency changes.

## Non-goals

- Per-visitor connect/OAuth flows, refresh tokens, and registered
  third-party clients (roadmap changes 12–13).
- The TypeScript client library and its `/embed` distribution (change
  11).
- Multi-vdir tokens, subpath scopes, token-bound origin allowlists as a
  security boundary, and the iframe bridge.
- Token management through bearer credentials, token rotation, use
  limits, or client-selected token formats.
- Changing the 24-hour file-link TTL or the `/files` public/cookie
  semantics beyond accepting bearer credentials.
