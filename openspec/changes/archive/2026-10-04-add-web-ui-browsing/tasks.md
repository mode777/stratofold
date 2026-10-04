# Tasks

## 1. Grantee lookup route (`internal/userlookup`)

- [x] 1.1 Implement the lookup handler (design D6): `GET /api/sf/users/lookup?email=…` — session required (`authbridge` validation), `400` on missing/empty email, exact `FindAuthRecordByEmail` match, `404` on miss, response `{"id", "email"}` only; wire through `appserver.Install` and extend the route-collision assertions to cover it; verify with `go test ./internal/userlookup/ ./internal/appserver/`: exact match returns id+email, miss `404`, unauthenticated `401`, malformed query `400`, built-in routes unaffected

## 2. SPA workspace and shell (`web/`)

- [x] 2.1 Scaffold `web/` (design D1): Vite + React + TypeScript + Tailwind, `src/` layout per design D5, script shims in the root `package.json`, build output `web/dist`; verify `npm install && npm run build` produces `web/dist/index.html` and `npm run dev` proxies `/api` + `/files` to `127.0.0.1:8090` (design D2)

- [x] 2.2 Client layer (design D4): `lib/pb.ts` (SDK singleton), `lib/filesApi.ts` (typed `/api/sf` wrappers mapping error classes to a discriminated union), `lib/lookup.ts`, session context with the `401`-to-login interceptor; verify with Vitest unit tests over the wrappers and interceptor (`npm run test`)

- [x] 2.3 App shell and routing (design D5): `/login`, `/` redirect, `/v/:vdirId/*`, `/connections`, `/vdirs`, catch-all 404; mobile-first header + vdir switcher drawer ("My vdirs" / "Shared with me"); verify with component tests: routes render, switcher groups own vs shared vdirs, no connection records shown to a user with none

## 3. Login and logout

- [x] 3.1 Login screen and session bootstrap (design D3): POST `/api/sf/auth` via fetch, token into the SDK auth store, `authRefresh()` on start, failed login stays with an error, `401` anywhere routes to login; verify with component tests (mocked clients): valid login enters, invalid stays, rejected session returns to login

- [x] 3.2 Logout: `DELETE /api/sf/auth` + `authStore.clear()` returning to the login screen with no further authenticated traffic; verify with a component test and an E2E smoke (group 7) that post-logout requests go out unauthenticated

## 4. Browse views

- [x] 4.1 Directory listing components (design D5): list and grid views over `ls` entries (name, size, type, mtime), view toggle, sorting by name/size/modified both directions; verify with component tests: entries render with real fields, toggle keeps the directory, sorts reorder both views

- [x] 4.2 Breadcrumb navigation and states: enter subdirectories, breadcrumb jump to ancestor, vdir-root breadcrumb, empty state, `404` not-found state with a way back; verify with component tests over the navigation matrix

- [x] 4.3 Virtualized rendering (design D4): TanStack Virtual for list and grid, in-memory sort then window; verify with component tests seeding 10,000+ fake entries: bounded DOM nodes, prompt render, last entry reachable by scroll in both views

- [x] 4.4 Downloads and media links: every file entry carries its `/files/<vdir-id>/<path>` URL; download action; media entries open in a new browser tab at their URL (browser-native player; no dedicated player component); verify with component tests that the URLs and actions are wired, and with E2E (group 7) for the real Range/cookie behavior

## 5. Management UI

- [x] 5.1 Connections screens (design D5): create/edit/delete over the record API — label, host, port, username, auth method `password`/`key`, matching secret, host-key fingerprint; secrets never rendered back (placeholders), empty-secret-on-edit preserves; verify with component tests: create password and key variants, no secret in any rendered/serialized form value, delete removes from the list

- [x] 5.2 Vdirs screens (design D5): create/edit/delete over the record API — own connections only in the binding select, name, root path, `is_public` toggle with switcher marking; verify with component tests: create/toggle/delete flows and the own-connections-only select

- [x] 5.3 Shares dialog (design D5/D6): grant `viewer`/`editor` by email resolved via `/api/sf/users/lookup`, change role, revoke; self-share rejected client-side, duplicate rejection surfaced; verify with component tests: grant by resolved id, role change, revoke, self-share blocked, duplicate error rendered

- [x] 5.4 Error-state mapping across screens (design D4): `404` not-found, `403` forbidden notice with no repeating write offer, `503` retryable with a working retry action, `400`/`500` message; verify with component tests over the error-class matrix

## 6. E2E harness and suite (`web/e2e/`)

- [x] 6.1 Go E2E harness command (design D7): boots the in-proc stack on real ports (`internal/testapp` appserver + `internal/testssh` fixture, seeded users/vdirs/entries incl. a small video and a 10k-entry directory), prints the base URL; verify by starting it and curling `/api/sf/auth` + a seeded `/files` URL

- [x] 6.2 Playwright suite: login → browse (list/grid, sort, navigate) → download; media opened in a new tab whose native playback issues `206` Range requests asserted in the network log (context-level listening captures the popup tab) and seek issuing a further Range; share-grant → grantee sees "Shared with me" → revoke cuts access on next request; mobile-viewport (375px) smoke; keyboard navigation basics; verify with `npm run e2e` against the harness (chrome-headless-shell on the verification server; `SF_BASE_URL`-style overrides for the external OpenSSH stack per design D7)

## 7. Docs and validation

- [x] 7.1 No ADR — ADRs 0004/0005 already pin the distribution and SPA stack this change implements, and the lookup route is mechanics within the pinned `/api/sf/` namespace and sharing model (design D6 records the accepted trade-off); if apply surfaces a new durable decision, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note it in this file if so)

- [x] 7.2 Update docs: `docs/architecture.md` SPA section gains the shipped screens/routes, the login credential flow (D3), and the lookup route; `AGENTS.md` gains frontend dev/verification notes (`web/` commands, harness usage, what gates where); verify the docs match the shipped code and commands run as written

- [x] 7.3 Run the full harness: `go vet ./... && go test ./...` (lookup route, collision assertions), `npm --prefix web run test` (component matrices), `npm --prefix web run e2e` (harness suite), and `npx openspec validate --all --strict`; verify all pass
