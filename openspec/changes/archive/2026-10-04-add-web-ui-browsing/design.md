# Design — `add-web-ui-browsing`

## Context

The backend this change consumes is complete and archived: `POST
/api/sf/auth` bridges token↔cookie (change 2), `POST
/api/sf/vdirs/{id}/{ls,mkdir,mv,rm,upload}` is the operation surface
(change 5), `GET /files/<vdir-id>/<path>` streams with Range/conditionals
(change 4), and `vdir_shares` + extended record rules give owner /
viewer / editor / public semantics (change 6). The SPA stack is pinned
by ADR 0005 (React + Vite + TS + Tailwind, PocketBase JS SDK, React
Router, virtualized lists); serving shape by ADR 0004 (embedded, one
origin). No frontend code exists yet; the repo's Docker capability is
absent in dev (AGENTS.md), and the golden/e2e harnesses so far are all
Go-side (`internal/testapp` + `internal/testssh` in-proc stack).
Motivation and scope: proposal.md; behavior contract: the `web-ui` and
`sharing-access-control` spec deltas.

## Goals / Non-Goals

**Goals:**

- One frontend workspace with a typed client layer over the *existing*
  API surfaces — no backend behavior change except the one lookup route
  (D6).
- Login that actually produces both credentials the product relies on:
  the PB token (record API) and the `sf_session` cookie (`/files/*`).
- Browse views that stay smooth at 10k+ entries and stream media via
  the browser's native Range machinery, with zero SPA streaming code.
- A verification story that runs headless in this dev container
  (component tests) and gates on the build server (Playwright E2E over
  the in-proc stack exposed on real ports).

**Non-Goals:**

- No upload/move/rename/delete/mkdir UI and no upload queue (change 8);
  no `go:embed`/Docker (change 9); no share links/notifications; no
  anonymous SPA mode; no i18n/theming — see proposal Non-goals.
- No changes to sandbox, streaming, retry, or authorization behavior;
  no new collections or migrations.

## Decisions

### D1 — Workspace layout: `web/` beside the Go module

`web/` holds the SPA: its own `package.json`, Vite root, `src/`
(components, pages, lib), Vitest + Testing Library, Playwright specs in
`web/e2e/`. The root `package.json` gains script shims (`npm run web`,
`npm run web:test`, `npm run web:e2e`) delegating via `npm --prefix
web`. Build output is `web/dist`, shaped to drop into `pb_public/`.

*Rejected:* a second repository — ADR 0004 embeds the SPA into the Go
binary; one repo keeps them versioned together. *Rejected:* a
root-level npm workspace merge — the Go repo's `package.json` exists
only for `openspec`; keeping frontend deps scoped to `web/` avoids
dragging Node tooling into Go workflows.

### D2 — Same-origin in dev and prod: Vite proxy, `pb_public` until change 9

Dev: Vite dev server (default :5173) proxies `/api/*` and `/files/*` to
`127.0.0.1:8090`, so every request is same-origin — the `sf_session`
cookie (SameSite=Lax) and `/files/*` work with no CORS anywhere.
Serving the built SPA manually: copy `web/dist/*` to `pb_public/` and
run `serve --indexFallback` so client-side routes resolve to
`index.html`. Change 9 replaces the copy with `go:embed`.

*Rejected:* cross-origin dev (Vite :5173 → API :8090 with CORS +
credentials) — SameSite/Secure cookie pitfalls and a code path prod
never uses; the proxy is one stanza. *Rejected:* waiting for change 9
to serve the SPA — the e2e gate needs a real server now, and
`pb_public` is PocketBase's built-in static dir.

### D3 — Login feeds both credentials: `/api/sf/auth` first, SDK store second

Login posts credentials to `POST /api/sf/auth` (plain `fetch`) — the
pinned route that sets the HttpOnly cookie. The response's PB token is
then loaded into the PocketBase JS SDK auth store
(`authStore.save(token, record)`), so SDK record calls carry the
`Authorization` header. On app start with a persisted store:
`users.authRefresh()` validates it; failure → login screen. Logout:
`DELETE /api/sf/auth` (rotates the token server-side, clearing cookie
validity) then `authStore.clear()`. A `401` from any API call routes to
login (single interceptor, both clients).

*Rejected:* `collections.authWithPassword()` only — it skips the cookie
bridge, so every `/files/*` URL would 401; the custom route exists
exactly for this. *Rejected:* cookie-only auth — the record API rules
evaluate `@request.auth` from the `Authorization` header; the dual
credential model is pinned by `auth-session`.

### D4 — Lean client layer: typed fetch wrappers + SDK, contexts for session

Small modules: `lib/filesApi.ts` (typed wrappers over
`/api/sf/vdirs/...`, error-class → discriminated union), `lib/pb.ts`
(SDK singleton), `lib/lookup.ts` (grantee resolution), a session
context (auth store + interceptor + routing), and feature-local state
via hooks. Listing transforms are plain functions (sort/filter) so
component tests need no server. Virtualization via TanStack Virtual for
list and grid modes.

*Rejected:* TanStack Query/Redux — the surface is small, stable, and
read-mostly; per-view fetching hooks suffice, and ADR 0005 names only
SDK + Router + Virtual. Revisit if change 8's upload queue needs shared
mutation state.

### D5 — Route map and screens

`/login`; `/` → redirect to first available vdir (empty state when
none); `/v/:vdirId/*` browse (breadcrumbs from the splat, list/grid
toggle, sort, virtualized listing, entry actions: open directory,
download, open media in a new tab at its `/files` URL — the browser's
native player handles playback, no player component); `/connections` + create/edit dialog (secrets
write-only, D3's empty-means-keep via form semantics);
`/vdirs` + create/edit dialog (own connections only, `is_public`,
root path) with a share-management dialog per own vdir (grant by
resolved email, role change, revoke). Layout shell: mobile-first
header + vdir switcher drawer ("My vdirs" / "Shared with me").

*Rejected:* vdir id in the path as a query param — the deep-linkable
`/v/:id/*path` shape mirrors `/files/<vdir-id>/<virtual-path>` and
keeps browser history per directory.

### D6 — Grantee lookup: `internal/userlookup`, exact email, authenticated

One small handler package mounted by `appserver.Install`:
`GET /api/sf/users/lookup?email=…`. Order: require a valid session
(`authbridge` validation, same middleware family as the rest of
`/api/sf/`) → validate the query (`400` on missing/empty) →
`app.FindAuthRecordByEmail("users", email)` → `404` on miss → respond
`{"id", "email"}` only. Any authenticated user may call it: granting
shares is the only consumer, the match is exact (no prefix/scan), and
at most one record returns. Under `/api/sf/`, so the route-collision
assertions extend to it.

*Rejected:* resolving grantees client-side from a users list rule
change — would expose the user directory to every user (enumeration by
listing); exact-match is the minimal disclosure that makes email-based
sharing possible. *Rejected:* grantee entry as a raw user id — zero
backend change but unusable UX; users don't know each other's ids.
*Accepted trade-off:* the endpoint is a mild email-probing oracle for
authenticated users (a miss is distinguishable); PocketBase's
rate-limit settings are the mitigation knob and are not configured in
this change.

### D7 — Verification harness: component tests everywhere, E2E over the in-proc stack

Component tests (Vitest + jsdom + Testing Library) mock the `lib/*`
clients: render/sort/navigate matrices, virtualization with 10k+ fake
entries (assert bounded DOM node count + last entry reachable),
form/dialog validation, error-class → UI-state mapping, keyboard
navigation. E2E (Playwright, `web/e2e/`) runs against a thin Go
harness command that boots the full in-proc stack on real ports —
`internal/testapp` appserver + `internal/testssh` SSH fixture with the
seeded dataset and known users — then drives chrome-headless-shell:
login → browse → download; media opened in a new tab with `206` Range
requests asserted in the network log (context-level listening captures
the popup tab) and seek issuing a further Range; share-grant flow;
mobile-viewport smoke (375px). Runs headless in the dev container and identically on
the verification server; `SF_BASE_URL`-style env overrides let it
target an external OpenSSH stack there too.

*Rejected:* E2E against the dockerized OpenSSH only — no Docker in the
dev container (AGENTS.md); the in-proc stack is the established,
everywhere-runnable fixture. *Rejected:* mocking `/files/*` in E2E —
Range/cookie behavior *is* the acceptance criterion (roadmap: "video
play with Range requests visible in the network log").

## Risks / Trade-offs

- [Lookup endpoint enables email probing by any authenticated user] →
  exact-match only, single record, no listing form (`400`); rate
  limiting stays a PocketBase settings concern, noted as an accepted
  trade-off in D6.
- [PB token persisted in the SDK store (localStorage) is XSS-readable] →
  standard PocketBase practice; `/files/*` and the cookie are already
  HttpOnly; no third-party scripts are bundled; revisit hardening
  (CSP, service worker) later.
- [No server-side pagination on `ls`; a huge directory loads fully in
  the browser] → virtualization bounds *rendering*, not transfer;
  tens-of-thousands entries are fine in memory, and the roadmap's
  realism target is 10k+. Accepted; pagination is a backend change if
  ever needed.
- [Vite proxy and `pb_public` serving can drift from the embedded
  reality of change 9] → both are same-origin today, and change 9's
  gate already runs the full Playwright suite against the container
  image; nothing in this change encodes proxy-specific assumptions.
- [E2E needs a browser binary the dev container may lack] →
  chrome-headless-shell is provisioned on the verification server;
  component tests carry the local gate, E2E gates on the server.

## Migration Plan

Additive only: new `web/` tree, one new route, no data migration. The
lookup route ships behind the normal migration-free wiring; rollback is
removing the route and the directory. Existing test suites are
untouched except the extended collision assertions.

## Open Questions

None — the remaining choices (visual tokens, exact component split)
are implementation-level and do not affect specs, approach, or tasks.
