# Tasks

## 1. Data model

- [x] 1.1 Add migration `internal/migrations/1770000005_file_links.go` creating the `file_links` collection with `vdir` (relation, cascade), `path` (text, required), `created_by` (users relation, cascade), `token_hash` (text, required, unique index), and `expires_at` (date, required, indexed), leaving the record API rules unset (superuser-only); verify a migration test asserts the fields/indexes exist and a normal authenticated user cannot list the records.
- [x] 1.2 Add the expired-row sweep used at mint time (delete rows whose `expires_at` is in the past) and verify a unit test leaves live rows untouched while removing expired ones.

## 2. Minting

- [x] 2.1 Create `internal/filelinks` and mount `POST /api/sf/vdirs/{vdirId}/links` with the JSON `{"path"}` body: resolve the `sf_session` cookie, require a signed-in user, apply `vdirauthz` read access, reject empty paths, and return `201 {"url": "/s/<token>", "expires_at": …}`; verify the matrix test covers owner/editor/viewer success, anonymous `401`, non-reader `403`, empty `400`, and zero SSH dials for rejected requests.
- [x] 2.2 Implement 256-bit `crypto/rand` tokens stored only as a SHA-256 hash, the fixed 24-hour expiry, and the once-only plaintext response; verify tests prove two mints differ, the stored row contains no plaintext token, and the reported expiry is 24 hours after minting.
- [x] 2.3 List the mint route in `filelinks.CustomRoutes`, register it in `internal/appserver`, and extend the route-collision test for the `/api/sf/` invariant; verify `go test ./internal/appserver/`.

## 3. Redemption

- [x] 3.1 Extract the file server's resolution/serving pair into an exported helper (or a shared package) with a `HEAD` short-circuit, keeping `/files` behavior byte-identical; verify `go test ./internal/fileserver/` (including the golden runner) still passes.
- [x] 3.2 Mount session-free `GET`/`HEAD /s/{token}` outside `/api/`: hash-lookup the token, enforce expiry, re-check the creator's current read access via `vdirauthz`, resolve the stored path through the vdir sandbox, require a regular file, and return `404` for every failure; verify a matrix test covers valid, expired, forged, revoked, deleted-vdir, deleted-user, moved-file, and directory targets.
- [x] 3.3 Add the link response middleware: `Cache-Control: no-store`, permissive CORS with `OPTIONS` and the `Range`/conditional allow-list, exposed range headers, and `Content-Disposition: inline` with the linked basename; verify header tests for `GET`, `HEAD`, and `OPTIONS`.
- [x] 3.4 Reuse the shared serve path for single-range (`206`/`416`), conditional (`304`), mime, and mid-response reconnect parity with `/files`; verify the link-specific range/conditional/reconnect tests.
- [x] 3.5 Redact the token segment from `/s/` request logging and verify by redeeming a link and asserting the `_logs` entry contains no reusable token.
- [x] 3.6 Register `/s/` before the SPA catch-all, add `/s` to `internal/webassets.reservedPrefixes`, and extend the collision/reserved-prefix tests; verify an unknown `/s/...` path is a server `404`, not the SPA shell.

## 4. SPA copy action

- [x] 4.1 Add `mintFileLink(vdirId, path)` to `web/src/lib/filesApi.ts` returning the relative `/s/<token>` URL and expiry, mapping failures through the existing `ApiFailure` classes; verify unit tests for success and each failure class.
- [x] 4.2 Add the **Copy 24-hour link** row to `web/src/components/ContextMenu.tsx`, gated by a new prop plus `!entry.dir`, using an injected async copy callback and the existing "Copied"/silent-failure pattern; verify component tests for the copied absolute URL, public-vdir absence, anonymous absence, directory absence, mint failure, and clipboard rejection.
- [x] 4.3 Wire `BrowsePage` to pass `canMintLink = session authenticated && !isPublic` and an `onCopyTemporaryLink` callback that mints, prefixes `window.location.origin`, and copies; verify `BrowsePage.test.tsx` covers a signed-in viewer/owner on a non-public vdir, a public vdir, and public mode.

## 5. Documentation and decision record

- [x] 5.1 Write `docs/decisions/0010-expiring-file-links.md` from `TEMPLATE.md` (opaque DB-backed tokens, 24h expiry, creator recheck, rejected alternatives) and add it to the `docs/decisions/README.md` index; verify `npx openspec validate --all --strict` and the index row.
- [x] 5.2 Update `docs/architecture.md` (the `/s/` route, `file_links`, access flow), `docs/using-stratofold.md` (copying a 24-hour link and its limits), `docs/hosting.md` (expiry/proxy/access-log guidance for `/s/`), and the `AGENTS.md` web-UI/route bullets; verify each statement matches the new spec scenarios.

## 6. Verification

- [x] 6.1 Run `go vet ./... && go test ./...` (with `~/.local/go/bin` prepended) and confirm the new packages plus the existing suites pass.
- [x] 6.2 Run `npm --prefix web run test` and confirm the component and API-wrapper suites pass.
- [x] 6.3 Add the copy-link E2E flow (signed-in non-public vdir: copy, fetch the `/s/<token>` URL **without** the session cookie, assert `200`/`206` bytes) and run it on the build/verification server; verify the dev container limitation is respected.
- [x] 6.4 Run `npx openspec validate --all --strict` and confirm the change validates.
