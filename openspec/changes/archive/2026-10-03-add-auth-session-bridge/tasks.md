# Tasks

## 1. Server bootstrap

- [x] 1.1 Pin the PocketBase dependency (latest stable at implementation start, exact version in `go.mod`) and create `cmd/stratofold/main.go` embedding PocketBase per D1, serving built-ins + SQLite persistence on one port; verify `go build ./...` succeeds and a locally started binary serves the PocketBase built-in health endpoint and the admin UI
- [x] 1.2 Build the httptest harness helper: isolated PocketBase app instance (temp SQLite dir, isolated `PB_` env), a seeded test user, and a superuser for setup; verify the helper boots the real embedded server in tests, the built-in `users` collection exists, and the built-in users auth endpoint authenticates the seeded user

## 2. Session bridge routes (`/api/sf/auth`)

- [x] 2.1 Implement `POST /api/sf/auth` under the `/api/sf/` prefix (D1/D2): authenticate against PocketBase `users`, respond with the auth token in the body and set the `sf_session` cookie (HttpOnly, SameSite=Lax, `Secure` on `r.TLS`/`X-Forwarded-Proto: https` per D4); verify httptest: valid login returns a token accepted by a built-in authenticated endpoint and the expected cookie flags over HTTP and over a TLS-simulated request; wrong password and unknown user both fail without setting a cookie, indistinguishably
- [x] 2.2 Implement `DELETE /api/sf/auth` (D3): rotate the user's token key, clear the cookie; verify httptest: logout clears the `sf_session` cookie, a replayed cookie is rejected afterwards, and a separately held token of the same user is invalidated too

## 3. Cookie middleware and streaming deadlines

- [x] 3.1 Implement the `sf_session` validation middleware resolving the cookie to an auth record in-process via PocketBase token lookup (D2), exposing the identity to handlers and rejecting anonymous/expired/invalid tokens with an authentication error; verify httptest over a middleware-protected probe route bound in test setup: anonymous → rejected, valid cookie → handler observes the matching user, expired and forged tokens → rejected. (The `<video>`-tag manual check belongs to `/files/*` in change 4; a plain no-`Authorization`-header request stands in here.)
- [x] 3.2 Implement the streaming deadline-clearing middleware (`http.NewResponseController`, D5) and the generous server-timeout configuration with a modest `ReadHeaderTimeout`; verify httptest: with an artificially short configured write timeout, a temporary streaming route bound in test setup completes a response outliving that timeout with the middleware applied, and the control without the middleware is cut off

## 4. Route-namespace guarantee

- [x] 4.1 Add the standing route-collision test (D6): enumerate registered routes and assert every custom route is under `/api/sf/`; probe representative built-ins (users auth endpoint, `/api/files/*` record-attachment namespace, admin endpoints) and assert built-in behavior; verify the test passes with the change's routes and fails if a probe route is moved outside the prefix (mutation check)

## 5. Docs and validation

- [x] 5.1 No ADR — 0001 and 0002 already record the durable decisions this change implements (D2–D7 are mechanics within them); if implementation surfaces a new durable decision during apply, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note in change log if so)
- [x] 5.2 Update docs and `AGENTS.md`: dev workflow for running the server (superuser creation, port, where SQLite lands), cookie/`/api/sf/auth` notes matching the shipped implementation, and reconcile any `docs/architecture.md` divergence (PocketBase core / custom API sections); verify docs match the shipped code
- [x] 5.3 Run the full harness: `go vet ./...`, `go test ./...` (bootstrap, bridge, middleware, collision tests), and `npx openspec validate --all --strict`; verify all pass
