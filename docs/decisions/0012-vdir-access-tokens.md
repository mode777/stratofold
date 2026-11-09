# 0012 — Vdir-scoped access tokens for third-party clients

Status: Accepted (2026-11, change `add-vdir-access-tokens`)

## Context

Stratofold's private read and write surfaces authenticate from the
`sf_session` cookie, which only Stratofold's own origin can send.
PocketBase auth tokens are not a substitute: they are full-account,
cannot be scoped to one vdir, and are revoked only by rotating the
user's token key. PocketBase's impersonation endpoint is superuser-only
admin tooling. A frontend-only site or script needs a credential it can
hold and send cross-origin that is narrow, revocable, and capped by the
user's current access.

## Decision

Third-party access uses **opaque, database-backed, user-and-vdir-scoped
bearer tokens**:

- A token belongs to one user and exactly one vdir, with role `viewer`
  or `editor`, a required name, and an optional expiry. It is shown once
  at mint, generated from 32 random bytes with an `sf_v1_` prefix, and
  stored only as a SHA-256 hash plus a non-secret hint.
- Management (`POST`/`GET /api/sf/tokens`, `DELETE
  /api/sf/tokens/{id}`) requires the `sf_session` cookie. A bearer can
  never mint, list, or revoke tokens. `GET /api/sf/tokens/me` is the
  inverse: bearer-only scope discovery without the secret.
- Bearer credentials are accepted by `/api/sf/vdirs/*`, `/files` for
  non-public vdirs, and the `/s` link-mint route. When present, a bearer
  is authoritative even if a cookie is also sent; an invalid bearer is
  `401`, not a cookie fallback.
- Every request resolves the token user's current `vdirauthz` grant.
  Reads require at least a viewer grant; writes require an editor grant
  and an `editor` token. A token on another vdir is `403`. Public read
  access alone does not keep a token alive, and share removal, role
  changes, deletion, expiry, and revocation apply to the next request.
- `file_links` records the minting token (nullable relation, cascade
  delete); redemption checks the source token is present, unexpired,
  owned by the creator, and scoped to the link's vdir. Cookie-minted
  links are unchanged.
- The `vdir_tokens` collection has no record-API rules. Tokens never
  appear in a URL or query parameter; private native media uses
  token-minted, 24-hour `/s` links.
- Cross-origin clients get permissive CORS from PocketBase's global
  middleware; `/files` exposes the representation headers a browser SDK
  needs. There is no credentials mode and no cross-origin cookie.

## Consequences

- Tokens are revocable individually and their effective access cannot
  exceed the user's current grant, so existing sharing revocation stays
  the single authorization source.
- A frontend-only site can read and write one vdir with a header-only
  credential; a token in a public bundle is still public and must be
  treated as such.
- The `vdir_tokens` row is the audit/lifecycle handle (name, role,
  expiry, last use). Deleting a user, vdir, or token cascades.
- Native `<img>`/`<video>` cannot send the header; the client must mint
  `/s` links. This is the deliberate cost of never putting a token in a
  URL.
- Record-API management, multi-vdir tokens, subpath scopes, and
  per-request origin allowlists remain unavailable.

## Rejected alternatives

- **PocketBase impersonation token** — superuser-only, unscoped, and
  revocable only by rotating the token key (all devices).
- **Unscoped user API key** — a leak is full-account access; vdir scope
  costs little because every request already resolves through
  `vdirauthz`.
- **Plaintext or recoverable token storage** — a database or admin-UI
  read would hand out live credentials.
- **Stateless HMAC-signed token** — no per-token revocation and the
  payload exposes vdir scope.
- **Token in a URL or query parameter** — leaks into logs, history,
  referrers, and caches; `/s` links are the short-lived alternative.
- **Cookie sharing or an `Authorization`-to-cookie bridge** — cookies
  cannot cross origins (`SameSite=Lax`, no `Allow-Credentials`), and a
  full session token is broader than the requested vdir.
- **Tokens as a second authorization system independent of shares** —
  it would outlive share removal, contradicting immediate revocation.
