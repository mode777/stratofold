# Tasks

## 1. Public name on vdirs

- [x] 1.1 Add `internal/migrations/1770000009_vdir_public_slug.go`: append an optional `public_slug` text field (`Min: 2`, `Max: 63`, pattern `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`) to `vdirs` and add a partial unique index on `public_slug` where `public_slug != ''`; verify `go test ./internal/migrations/` and that existing vdirs remain unnamed.
- [x] 1.2 Add the duplicate-name validation hook (new `internal/publicurls` package, `Register(app)` called from `appserver.Install` before serve): look up the slug excluding the current record and return a field-level `public_slug` validation error for a conflict, leaving the unique index as the race backstop; verify with a test that saves two vdirs with the same slug and asserts the second `Save` fails with a `public_slug` field error.
- [x] 1.3 Add the migration/record-rule matrix: valid names accepted, invalid grammar rejected, global uniqueness across two owners, many empty slugs allowed, only the owner can set/change/clear `public_slug` (viewer/editor/other denied), clearing releases the name, and deleting the vdir frees it; verify `go test ./internal/migrations/ ./internal/publicurls/`.

## 2. `/apps` server surface

- [x] 2.1 Implement `internal/publicurls` with `CustomRoutes` and `RegisterRoutes`: the session-free resolver `GET /api/sf/public-urls/{name}` returning `{vdir, name}`, and the `/apps` group with the same `ClearStreamDeadlines` middleware and representation `Access-Control-Expose-Headers` as `/files`; resolve the alias and require current `is_public` before each branch, use a local SQLite lookup only, and keep unknown/released/non-public names indistinguishable as `404`; verify the package starts under the test app and the route list matches the design table.
- [x] 2.2 Implement the `/apps` handler split: `GET /apps/{name}` → `301 /apps/{name}/`; slashed paths and the root-level `view` namespace → embedded SPA shell via `e.FileFS` with `router.IndexPage` (no dial); unslashed paths → `fileserver.StatResolved`, directory `301` to the slashed form, regular file through `fileserver.ServeFile`, missing/sandbox-rejected/stat error `404`; verify a browser-style request returns the shell for `/apps/<name>/` and a byte-exact body for `/apps/<name>/file.txt`.
- [x] 2.3 Wire the routes into `internal/appserver/appserver.go` before `webassets.RegisterRoutes`, add `/apps` to `webassets`'s reserved prefixes and the SPA-fallback test, and extend `internal/appserver/collision_test.go` to assert the resolver stays under `/api/sf/` and the alias routes stay under `/apps/`; verify `go test ./internal/appserver/`.
- [x] 2.4 Add the browse-route HTTP matrix in `internal/publicurls/` against the in-proc SSH fixture: bare alias redirect, root and nested shell responses, direct directory redirect, missing slashed path shell, no implicit `index.html`, root `view` reserved while `docs/view/...` streams, and private/un-published/unknown/released names all `404` before a dial; verify `go test ./internal/publicurls/`.
- [x] 2.5 Add the direct-file HTTP matrix: byte-exact file read, `Range: bytes=2-5` → `206` with the right `Content-Range`, unsatisfiable range → `416`, `If-None-Match` → `304`, `HEAD` validators and empty body, content type/length, traversal and encoded-dot paths → `404`, and a remote symlink escape → `404`; verify `go test ./internal/publicurls/`.
- [x] 2.6 Add resolver and lifecycle tests: anonymous resolver returns only `{vdir, name}` for a public alias, `404` for private/unknown, and never creates a session; renaming moves the URL immediately, clearing frees the name for another owner, deleting the vdir frees it, and un-publishing/republishing toggles the alias without clearing `public_slug`; verify `go test ./internal/publicurls/`.

## 3. SPA alias routes and pretty navigation

- [x] 3.1 Add the alias resolver client (`web/src/lib/publicUrl.ts`, reusing `sfFetch`) and the browse-route context/provider: `/v/:vdirId/*` and the existing public `/v` gate provide the current vdir id, `basePath`, `fileBase`, and public mode; `/apps/:alias/*` resolves through the resolver, provides `{vdirId, basePath: "/apps/<alias>", fileBase: "/apps/<alias>", publicMode: true, name}`, and renders the explicit not-available/page-not-found state on a resolution failure; verify component tests for a resolved alias, an unknown alias, and an un-published alias.
- [x] 3.2 Update `SessionGate`/`isAnonymousAllowed` and both route trees so `/apps/<alias>/…` browse and preview routes are anonymous-allowed, render outside `AppShell` (no app destinations), and signed-in visitors get the same read-only presentation; verify the App route matrix tests (`web/src/App.test.tsx`) for anonymous alias entry, anonymous management-route rejection, and signed-in alias rendering.
- [x] 3.3 Refactor `BrowsePage`, `Breadcrumbs`, and `PreviewPage` to derive the virtual path and build folder/back/preview links from the provided `basePath` instead of hard-coded `/v/<vdirId>`; keep the existing `/v` behavior identical; add tests that alias folder taps, breadcrumbs, back, and preview navigation all stay under `/apps/<alias>` (including the `/apps/<alias>/view/…` preview route).
- [x] 3.4 Pass the base path into the media pages for navigation-only links (skip next/previous, gallery position, dismiss/back), keeping their stream and cover URLs on `/files` so the existing audio/image/video requirements and tests stay valid; verify the existing media suites plus alias-mode navigation assertions.
- [x] 3.5 Verify the SPA alias work with `npm --prefix web run test`, including the public-mode not-available behavior when the alias resolver or the listing reports the vdir is no longer public.

## 4. Sharing UI, links, and copy actions

- [x] 4.1 Add `public_slug` to `VdirRecord` (`web/src/lib/records.ts`) and the public-name control to `web/src/pages/SharingPage.tsx`: claim/change/release through the existing `updateVdir` wrapper, lowercase typing, client-side grammar validation, server duplicate/field error mapped to an explicit "already taken" message, and a reserved/inactive note while the vdir is private; verify component tests for claim, change, release, invalid input, duplicate rejection, and owner-only visibility.
- [x] 4.2 Make `SharingPage`'s public link prefer the absolute `/apps/<public_slug>` URL when the vdir is public, fall back to `/v/<vdir-id>` without a name, and describe a registered name on a private vdir as reserved; verify the copy action writes the expected URL in each state.
- [x] 4.3 Make the per-file direct link prefer the alias: pass an optional direct-file base/public name through `BrowsePage`, `ContextMenu`, and `MetadataCard` so alias-view downloads and **Copy public link** use `/apps/<alias>/<path>`, while non-aliased public vdirs keep `/files/<vdir-id>/<path>` and non-public vdirs offer no action; verify the context-menu and metadata component tests plus the clipboard-failure case.
- [x] 4.4 Verify the whole SPA change with `npm --prefix web run test` and confirm no existing `/v` or `/files` link assertions regress.

## 5. Documentation and decision record

- [x] 5.1 Write `docs/decisions/0018-global-pretty-public-urls.md` from `TEMPLATE.md` (global namespace, vdir-field ownership, public-only serving, browse-shell vs direct-file split, reserved `view`, release/reuse) and add it to the `docs/decisions/README.md` index; verify `npx openspec validate --all --strict` and the index row.
- [x] 5.2 Update `docs/using-stratofold.md` (claiming a public name, the pretty browse/file URLs, reserved-while-private, un-publish/release behavior, released-name reuse and the `view` limitation), `docs/hosting.md` (the `/apps/*` surface, no-authentication public reads, logging/privacy of public names), `docs/architecture.md` (route table, data model, SPA route map), and `README.md`; verify every statement matches the new spec scenarios and the design's stated trade-offs.
- [x] 5.3 Update `AGENTS.md` with the new `/apps` surface, the `public_slug` field, the sharing UI control, and the verification commands; verify the pointer-only style and that no invariant is restated in two places.

## 6. Verification

- [x] 6.1 Run `go vet ./... && go test ./...` with Go on PATH (`~/.local/go/bin`) and confirm the full Go suite passes.
- [x] 6.2 Run `npm --prefix web run test` and confirm all SPA unit/component suites pass.
- [x] 6.3 Add `web/e2e/public-urls.spec.ts`: owner registers a name, an anonymous visitor opens the pretty URL, browses a folder, opens a preview, and downloads a direct file path; a duplicate claim shows the conflict; un-publishing makes the alias unavailable and re-publishing restores it; release returns not-found. Run it on the build/verification server with `npm --prefix web run e2e -- public-urls` (the e2e harness may patch Playwright's `webServer` with a prebuilt binary), and record the result in the change.
- [x] 6.4 Run `npx openspec validate --all --strict` and confirm the change and every spec validate.

## Verification record

- 2026-11-20: `go vet ./...` and `go test ./...` pass (all packages,
  including the new `internal/publicurls` matrix and the vdir public-name
  migration tests).
- 2026-11-20: `npm --prefix web run build` passes; `npm --prefix web run
  test` passes 38 files / 455 tests, including the alias route, sharing
  name, context-menu, and media-navigation suites.
- 2026-11-20: `web/e2e/public-urls.spec.ts` on the build/verification
  server (prebuilt `stratofold-e2e` binary, Vite dev server with the
  `/apps` proxy/bypass, `SF_E2E_EXECUTABLE` = chrome-headless-shell):
  **3 passed** in 11.1s — claim/copy + duplicate conflict, anonymous
  alias browse/preview/direct Range+HEAD download, and
  un-publish/re-publish/release.
- 2026-11-20: `npx openspec validate --all --strict` passes (18 items).

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result and that `docs/decisions/README.md` still indexes ADR 0018.
