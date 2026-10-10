# Tasks

## 1. Session lifetime (server)

- [x] 1.1 Add `internal/migrations/1770000004_users_token_lifetime.go` setting `users.AuthToken.Duration = 94670856` (PocketBase v0.40.4 validated maximum, design D2); add a test in `internal/migrations/` asserting the users collection reports that duration after migrations — verify with `go test ./internal/migrations/`
- [x] 1.2 Make `sessionCookie` in `internal/authbridge/cookie.go` persistent: add a `MaxAge` (seconds) and set it in `handleAuthLogin` from `FindCollectionByNameOrId("users").AuthToken.Duration` (single source of truth; `clearSessionCookie` stays `MaxAge = -1`); add tests in `internal/authbridge/` asserting the login `Set-Cookie` carries `MaxAge` ≥ 34560000 (400 days) and that logout still clears the cookie and invalidates the token — verify with `go test ./internal/authbridge/`

## 2. Preview back button

- [x] 2.1 Add a header to `web/src/pages/PreviewPage.tsx` (back control + file name title) navigating to `browseUrl(vdirId, parentPath(path))` per design D1, keeping the existing Quick-Look card and download action; add component tests (back returns the containing directory's listing at any depth; back control keyboard-operable) — verify with `npm --prefix web run test`

## 3. Browse header actions

- [x] 3.1 In `web/src/pages/BrowsePage.tsx`, move the `canWrite` block (new-folder, upload button, hidden file input) from the toolbar into the folder header (design D3), keeping the `data-testid`s (`new-folder`, `upload-button`, `upload-input`) and the enqueue-to-current-directory behavior; reduce the toolbar to sort key + direction + list/grid; update `BrowsePage.test.tsx` (writer sees header actions; viewer/public sees none; toolbar holds only view controls; controls render without horizontal overflow at a narrow viewport) — verify with `npm --prefix web run test`

## 4. Full-height listing

- [x] 4.1 Remove `pb-24 md:pb-0` from `AppShell`'s scroll container (design D4) and update `AppShell.test.tsx` — verify with `npm --prefix web run test`
- [x] 4.2 Add a trailing spacer (≈ `h-24` + `pb-safe`, after the virtualized card) to `EntryList` and `EntryGrid` in `web/src/components/EntryViews.tsx` so the last rows scroll fully above the tab bar without touching the virtualizer's measurements — verify the existing virtualization/window tests still pass (`npm --prefix web run test`)
- [x] 4.3 Clearance sweep: add `pb-24 md:pb-0` to the scrollable root of every other destination rendered inside the shell — LocationsPage, UploadsPage, SettingsPage, ConnectionsPage, ConnectionFormPage, VdirsPage, VdirFormPage, SharingPage, MovePickerPage, PreviewPage, NotFoundPage — so no content hides behind the fixed bar; verify via the pages' component tests and a render check of each route (`npm --prefix web run test`)

## 5. E2E (verification server)

- [x] 5.1 Extend `web/e2e/file-management.spec.ts`: preview back navigation returns to the containing directory, and the writer's new-folder/upload actions live in the header at a mobile viewport; run the suite on the build/verification server (`npm --prefix web run e2e`; the dev container cannot launch the browser)

## 6. Docs

- [x] 6.1 Update `AGENTS.md`: the `/api/sf/auth` line gains "persistent `sf_session` cookie (MaxAge = token lifetime; browsers cap at 400 days)", and the web-UI section notes the write actions live in the browse folder header; no ADR (no stack-shaping decision — recorded in proposal.md) — verify the referenced lines read correctly
- [x] 6.2 Validate the change artifacts — verify with `npx openspec validate --all --strict`

## 7. Final verification

- [x] 7.1 Full backend gate: `go vet ./... && go test ./...` — all green
- [x] 7.2 Full web gate: `npm --prefix web run test && npm --prefix web run build` — all green, `web/dist` builds
