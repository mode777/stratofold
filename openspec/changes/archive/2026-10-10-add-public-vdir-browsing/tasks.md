# Tasks

## 1. Server: public vdir metadata route

- [x] 1.1 Create `internal/vdirmeta` serving `GET /api/sf/vdirs/<vdir-id>/meta` (public vdir → `{"name", "is_public": true}`; non-public or unknown id → `404`; other methods rejected) with a route test matrix covering: anonymous public, anonymous non-public, unknown id, authenticated caller on a non-public vdir, and a response-body assertion that no owner/connection/root-path/secret fields appear — verify with `go test ./internal/vdirmeta/`
- [x] 1.2 Register the route in `internal/appserver` before the SPA catch-all and assert in the appserver route tests that `/api/sf/vdirs/<id>/meta` answers directly (never the SPA fallback) while existing routes are unchanged — verify with `go test ./internal/appserver/`

## 2. SPA: anonymous entry and public browse mode

- [x] 2.1 Add `web/src/lib/publicVdir.ts` (meta fetch wrapper mapping 200 → `{name, is_public}` and 404 → the not-found failure kind) with unit tests — verify with `npm --prefix web run test`
- [x] 2.2 Carve the public-vdir exception into `SessionGate`/routing (`web/src/App.tsx`): anonymous visitors reach only `/v/:vdirId` browse and `/v/:vdirId/view/*`, every other destination renders the login screen, and a meta `404` on the probed vdir renders the login screen — component-test the gate matrix (anonymous public → browse view; anonymous non-public/unknown → login; anonymous other routes → login; signed-in flows unchanged) and verify with `npm --prefix web run test`
- [x] 2.3 Hide the Files/Uploads/Settings destinations in `AppShell` for anonymous sessions and component-test that neither tab bar nor sidebar offers them — verify with `npm --prefix web run test`
- [x] 2.4 Add public mode to `BrowsePage` and `PreviewPage` (skip the record-API `listVdirs`, take the name from the meta probe, offer no write/upload affordances) and render the explicit not-available state with a sign-in affordance when a public-mode request fails with `401`/`404` — component-test anonymous browse/download/preview, the no-affordances assertion, and the un-publish (next request → not-available) scenario — verify with `npm --prefix web run test`

## 3. SPA: public link in the sharing UI

- [x] 3.1 Add the public-link section to `SharingPage`: for a public vdir show the absolute `/v/<vdir-id>` URL with a clipboard copy action and the selectable-text fallback; for a non-public vdir show the no-public-link statement — component-test both states plus the copy action (mocked clipboard) — verify with `npm --prefix web run test`

## 4. E2E coverage

- [x] 4.1 Add `web/e2e/public-browsing.spec.ts`: anonymous visitor opens the seeded public vdir, navigates and downloads; anonymous `index.html` fetch through `/files` still serves (web-hosting non-regression); owner copies the public link from the sharing screen and the copied URL works in a fresh anonymous context; un-publishing makes the link land on the login screen — verify by running `npm --prefix web run e2e` on the build/verification server

## 5. Docs

- [x] 5.1 Update the AGENTS.md web-UI section: anonymous public browsing (`/v/…` without login), the public-link affordance in the sharing UI, and the meta route — verify by reading the section back against the implemented behavior

## 6. Final verification

- [x] 6.1 Run the Go gates: `go vet ./... && go test ./...` (file-server suite included — web-hosting non-regression)
- [x] 6.2 Run the web gates: `npm --prefix web run test` and `npm --prefix web run build`
- [x] 6.3 Validate the change: `npx openspec validate add-public-vdir-browsing --strict`
- [x] 6.4 Run the browser E2E suite on the build/verification server (`npm --prefix web run e2e`) as the cross-cutting integration check
