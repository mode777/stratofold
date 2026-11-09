# Tasks

## 1. Data model and token primitives

- [x] 1.1 Add `internal/migrations/1770000006_vdir_tokens.go` creating the `vdir_tokens` collection with `user` and `vdir` cascade relations, required `name`, `role` (`viewer`/`editor`), required unique `token_hash`, required `token_hint`, optional `expires_at` and `last_used_at`, plus indexes on `user`, `vdir`, and `expires_at`; leave the record API rules unset. Verify a migration test asserts the fields/indexes and that a normal authenticated user cannot list the collection.
- [x] 1.2 Add `internal/migrations/1770000007_file_links_minted_by_token.go` adding a nullable `minted_by_token` relation to `file_links` (target `vdir_tokens`, cascade delete). Verify a migration test leaves existing cookie-minted links valid with an empty relation.
- [x] 1.3 Create `internal/vdirtokens` with the `sf_v1_` 256-bit token generator, SHA-256 hash, non-secret hint, `Token` shape (`id`, `user`, `vdir`, `role`, expiry), and storage/read helpers. Verify unit tests cover uniqueness, format, hash-at-rest, hint shape, and lookup by plaintext.
- [x] 1.4 Add the opportunistic expired-token sweep and the best-effort `last_used_at` update throttled to once per five minutes. Verify tests prove an expired row is removed (with its links cascading), a live row survives, a recent last-use is not rewritten, and an audit-update failure does not fail authentication.

## 2. Token management routes

- [x] 2.1 Mount `POST /api/sf/tokens` behind `authbridge.RequireSession` and implement body validation (`vdir`, required `name`, role `viewer`/`editor`, optional future `expires_at`), vdir existence, `vdirauthz` grant lookup, and the role cap (viewer may mint only viewer; editor/owner may mint either). Return `201` with the plaintext token and metadata once. Verify the matrix covers owner/editor/viewer success, public-only non-grantee `403`, anonymous `401`, unknown vdir `404`, invalid bodies `400`, and zero SSH dials.
- [x] 2.2 Mount `GET /api/sf/tokens` behind `authbridge.RequireSession`, returning only the requester's token metadata (including vdir name, role, hint, expiry, and last use) and never a hash or plaintext. Verify two users see exactly their own rows.
- [x] 2.3 Mount `DELETE /api/sf/tokens/{id}` behind `authbridge.RequireSession`: delete the requester's own token, return `404` for another user's id, and return `204` idempotently for an already-absent own token. Verify a revoked token is rejected on its next bearer request.
- [x] 2.4 Mount `GET /api/sf/tokens/me` as a bearer-only route returning `{id, name, vdir: {id, name}, role, expires_at, last_used_at, token_hint}` and never the secret. Verify valid-token success, cookie-only `401`, expired/revoked `401`, and no plaintext/hash in the response.
- [x] 2.5 Add `vdirtokens.CustomRoutes`, register the routes in `internal/appserver`, and extend `internal/appserver/collision_test.go` for the `/api/sf/` namespace. Verify `go test ./internal/appserver/` and a collision probe for the new paths.

## 3. Shared request authorization and bearer surfaces

- [x] 3.1 Create `internal/requestauth` with `FromRequest`: parse a `Bearer` credential first (authoritative when present), otherwise validate the `sf_session` cookie, otherwise return anonymous; map invalid/expired/revoked credentials to distinct sentinel errors and a non-Bearer `Authorization` scheme to anonymous. Verify unit tests for bearer-only, cookie-only, both, invalid-bearer-plus-valid-cookie, malformed bearer, and no credential.
- [x] 3.2 Implement `AuthorizeVdir`: resolve `vdirauthz.Resolve`, keep cookie/anonymous `CanRead`/`CanWrite`, and for bearer require the token vdir to match plus `Access >= Viewer` for reads and `Access >= Editor` with an `editor` token for writes. Return the credential (including the token id) on success and response-ready `401`/`403` failures. Verify the full cookie/bearer/anonymous × read/write × owner/viewer/editor/other × right/wrong vdir matrix.
- [x] 3.3 Replace `internal/fsapi`'s cookie-only `authorize` with `requestauth.AuthorizeVdir` for `ls`, `mkdir`, `mv`, `rm`, and `upload`. Verify the existing filesystem API suite plus new bearer cases (viewer read-only, editor writes, owner viewer token read-only, wrong vdir `403`, expired/revoked `401`, bad bearer plus good cookie `401`) and that denied requests register zero SSH dials.
- [x] 3.4 Replace `internal/fileserver`'s non-public cookie branch with `requestauth.AuthorizeVdir`, leaving public vdirs anonymous and unchanged; add the `/files` CORS expose middleware for `Accept-Ranges`, `Content-Length`, `Content-Range`, `Content-Type`, `ETag`, `Last-Modified`, and `Content-Disposition`. Verify `/files` bearer reads, wrong-vdir `403`, expired/revoked `401`, public unchanged, preflight `Authorization`/`Range` allowance, and exposed headers on a cross-origin request.
- [x] 3.5 Change `internal/filelinks` mint to accept the shared credential, reject anonymous requests even on a public vdir, and store `minted_by_token` when the source is a bearer; teach redemption to require a present, unexpired source token owned by the link creator and scoped to the link's vdir. Verify token-minted link success, revocation/expiry `404`, cascade delete, cookie-minted links unaffected, wrong-vdir mint `403`, and zero dials on rejected mints.
- [x] 3.6 Add a focused regression test that a token's links and all bearer surfaces share the same revocation instant (delete the token, then immediately redeem its link and call `ls`/`/files`), and that an invalid bearer never falls back to a valid cookie.

## 4. Connected apps UI

- [x] 4.1 Add `web/src/lib/tokensApi.ts` with typed `listTokens`, `mintToken`, and `revokeToken` wrappers over the custom routes, reusing `sfFetch`'s error classes. Verify unit tests for success and `400`/`401`/`403`/`404`/`503` mapping.
- [x] 4.2 Add `web/src/pages/AppsPage.tsx` ("Connected apps") listing the user's tokens with name, vdir, role, hint, expiry, and last use; include empty and failure states. Verify component tests render only metadata and never a plaintext token or hash.
- [x] 4.3 Add the mint form: select an own or shared vdir, require a name, cap role options at the effective role (viewer offers viewer only; editor/owner offer both), and offer expiry presets including Never. Verify component tests for the role-cap matrix, shared-vdir selection, validation, and success.
- [x] 4.4 Show the plaintext token once in a dismissible panel with a copy action and a "will not be shown again" warning; after dismissal or reload the list must not expose it. Verify tests for copy success/failure and the one-time behavior.
- [x] 4.5 Add revoke with confirmation, reload the list on success, and surface the deterministic failure states. Verify tests for confirm/cancel, success, another-user `404`, and a `503` retry state.
- [x] 4.6 Add the `/settings/apps` route in `web/src/App.tsx` and the **Connected apps** row in `web/src/pages/SettingsPage.tsx`. Verify navigation tests and that the public/anonymous routes still never mount Settings.

## 5. Documentation and decision record

- [x] 5.1 Write `docs/decisions/0012-vdir-access-tokens.md` from `TEMPLATE.md` covering the opaque user+vdir token model, role cap, immediate revocation, session-only management, link binding, and rejected alternatives (PocketBase impersonation, unscoped tokens, plaintext storage, stateless HMAC, token-in-URL); add the row to `docs/decisions/README.md`. Verify `npx openspec validate --all --strict`.
- [x] 5.2 Update `docs/architecture.md` (token data model, `/api/sf/tokens`, bearer flow, `/files` bearer, link binding), `docs/using-stratofold.md` (Connected apps: create/scope/role/expiry/copy-once/revoke and the public-bundle warning), `docs/hosting.md` (bearer secrets, HTTPS, permissive CORS, revocation, proxy/log handling), `README.md` (feature list), and `AGENTS.md` (the capability bullet). Verify each statement matches the new spec scenarios.
- [x] 5.3 Run `npx openspec validate --all --strict` after the docs and spec deltas, and confirm every new requirement/scenario parses and the change reports complete.

## 6. Integration verification

- [x] 6.1 Run `go vet ./... && go test ./...` with `~/.local/go/bin` prepended; confirm the new packages and the existing filesystem, file-server, file-link, migration, and appserver suites pass.
- [x] 6.2 Run the focused matrix: `go test ./internal/vdirtokens/ ./internal/requestauth/ ./internal/fsapi/ ./internal/fileserver/ ./internal/filelinks/ ./internal/appserver/ ./internal/migrations/` and confirm the bearer/revocation/no-dial/CORS cases pass.
- [x] 6.3 Run `npm --prefix web run test` and confirm the token API and Connected apps component suites pass.
- [x] 6.4 Boot the app locally and manually exercise one cross-origin-style flow with `curl`: mint a viewer token with a session cookie, use it for `ls` and `/files`, confirm a write is `403`, revoke it, and confirm the next calls are `401`; confirm no token appears in a URL.
