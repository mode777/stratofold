# Proposal — `add-web-ui-browsing`

## Why

Changes 1–6 are archived: the streaming core, auth bridge, vdir sandbox,
`/files/*`, the filesystem API, and sharing all exist behind stable API
surfaces — but the product is only reachable with `curl`. The vision's
deliverable is a Google-Drive-like SPA, and the API it consumes is now
stable enough to build on. This is roadmap change 7: the frontend
foundation. Per planning decisions, it also carries the management UI
(connections, vdirs, shares) so the product becomes self-serve — which
in turn needs one small backend addition: resolving a share grantee by
email (the `vdir_shares.user` relation takes an id, and no endpoint
resolves emails today).

## What Changes

- New SPA at `web/` — Vite + React + TypeScript + Tailwind with the
  PocketBase JS SDK, React Router, and a virtualized-list library
  (ADR 0005); mobile-first, responsive, Drive-like custom design.
  The production build is embeddable-ready per ADR 0004: until change 9
  wires `go:embed`, the build output serves from `pb_public/`, and
  development runs through a Vite proxy to the Go server (same-origin,
  so the `sf_session` cookie and `/files/*` just work).
- Login/logout through `POST`/`DELETE /api/sf/auth`: the PocketBase
  token drives `/api/*` calls via the JS SDK, the HttpOnly `sf_session`
  cookie drives `/files/*` and downloads; expired/invalidated sessions
  route the user back to login.
- Browse: a vdir switcher separating **My vdirs** and **Shared with me**
  (the `vdirs` list rule already grants shared users read access), then
  Drive-like directory views over `POST /api/sf/vdirs/{id}/ls` —
  list/grid toggle, sorting by name/size/modified, breadcrumb
  navigation, and virtualized rendering that stays smooth at 10k+
  entries.
- Downloads and media as plain `/files/<vdir-id>/<path>` URLs —
  download links, and media entries that open in a new browser tab at
  their URL, where the browser's native player handles playback via
  Range requests; no dedicated player component in the SPA.
- Management UI (planning decision): create/edit/delete **connections**
  (secret fields are write-only — never rendered back; empty secret on
  edit = unchanged), create/edit/delete **vdirs** (own connection
  binding, root path, `is_public`), and grant/change/revoke
  `viewer`/`editor` **shares** on own vdirs.
- New minimal backend route `GET /api/sf/users/lookup?email=…`:
  authenticated, exact-match resolution of a grantee email to
  `{id, email}` for the share dialog — no listing, no search, no
  enumeration of the user directory (spec delta under
  `sharing-access-control`).
- Error presentation: the API's deterministic classes map to distinct
  UI states — `404` empty/not-found, `403` forbidden notice, `503`
  retryable with an explicit retry action, `400`/`500` error message.
  No automatic client-side retries (that is the upload queue's job,
  change 8).
- Validation per the roadmap row: Vitest + Testing Library component
  tests (render, sort, navigate; virtualization with 10k+ fake
  entries), Playwright E2E against the dev server + SSH fixture
  (login → browse → download; media opened in a new tab with Range
  requests visible in the network log), mobile-viewport smoke, keyboard
  navigation basics.

## Capabilities

### New Capabilities

- `web-ui`: the SPA's required behavior — session lifecycle
  (login/logout/invalid-session handling), vdir enumeration (own +
  shared), directory browsing (list/grid, sorting, navigation,
  virtualization), download and inline media via `/files`, the
  management surfaces (connections, vdirs, shares), deterministic error
  presentation, and mobile-first/keyboard accessibility basics.

### Modified Capabilities

- `sharing-access-control`: adds grantee resolution for share
  management — an authenticated user can resolve an exact email address
  to a user id (`GET /api/sf/users/lookup?email=…`) solely to grant
  shares; no user-directory listing or search exists at any permission
  level.

## Impact

- New `web/` workspace with its own `package.json` (Vite, React,
  TypeScript, Tailwind, PocketBase JS SDK, React Router, TanStack
  Virtual, Vitest, Playwright); root `package.json` gains script
  shims. Go code untouched except the lookup route: a small handler
  package (e.g. `internal/userlookup`) wired through
  `internal/appserver.Install` under `/api/sf/`, with the route-collision
  assertions extended to cover it.
- `internal/authbridge`, `fsapi`, `fileserver`, `vdirauthz`, and all
  other backend packages are consumed unchanged — no sandbox,
  streaming, session, or authorization behavior changes.
- Frontend deps land in `web/package.json` (ADR 0005 names the stack);
  the Go module is unaffected.
- Docs: `docs/architecture.md` (SPA section gains the shipped screen
  inventory + the lookup route), `AGENTS.md` (frontend dev/verification
  notes). **No new ADR** — the stack is pinned by ADRs 0004/0005 and
  the sharing model by the existing specs; the lookup endpoint is a
  mechanics-level addition inside the pinned `/api/sf/` route namespace.
- Verification: `go vet ./... && go test ./...` (lookup route +
  collision assertions), `npx openspec validate --all --strict`;
  frontend: `npm run test` (Vitest) and `npm run e2e` (Playwright vs
  dev server + SSH fixture) inside `web/`.

## Non-goals

- No file-management operations in the UI — upload, move, rename,
  delete, mkdir, and the background upload queue are change 8.
- No `go:embed` wiring or Docker packaging — change 9 ships the single
  image; until then the SPA is served from `pb_public/` or the Vite dev
  server.
- No sharing features beyond grant/change/revoke on own vdirs — no
  share links, passwords, expiry, invitations, or notifications.
- No user-directory listing or search anywhere — exact email match
  only; no autocomplete over users.
- No anonymous SPA mode — unauthenticated visitors see the login
  screen; public vdirs are browsable anonymously via `/files/*` and the
  API, but the SPA itself requires a session (a public vdir's owner or
  a shared user browses it like any other).
- No drag & drop, gallery/preview modes, trash, versioning, search
  beyond navigation, i18n, or theming.
