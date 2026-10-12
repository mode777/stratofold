# Design

## Context

The SPA is the iOS-style shell from `replace-web-ui-with-ios-mobile`:
`AppShell` renders a fixed translucent tab bar below `md` and pads its
scroll container with `pb-24 md:pb-0`; `BrowsePage` owns a header
(back, title, breadcrumbs), a compact toolbar (sort, direction,
list/grid, and — for writers — New Folder + Upload), and a TanStack
Virtual listing (`EntryList`/`EntryGrid`) that scrolls inside
`h-full`. `PreviewPage` renders a Quick-Look card with a download
action and no navigation control. Sessions go through
`internal/authbridge`: `POST /api/sf/auth` mints
`record.NewAuthToken()` and sets `sf_session` — currently a
browser-session cookie (no `MaxAge`) — while token lifetime comes from
the users collection's `authToken.duration`, left at PocketBase's
5-day default. PocketBase v0.40.4 validates token durations to
`[10, 94670856]` seconds (≈ 3 years max), enforced in
`core.TokenConfig.Validate`. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- Preview screen gets a deterministic way back to its containing
  directory.
- Session lifetime reaches the platform maxima (token duration, cookie
  persistence) without new auth mechanics.
- Browse header hosts the write actions; the toolbar fits at mobile
  widths.
- Listing reaches the viewport bottom on mobile, scrolling under the
  blurred tab bar, with the last rows still reachable.

**Non-Goals:**

- No refresh/renewal flow, no per-user lifetime configuration, no
  silent re-login.
- No logout-semantics change (stays all-devices token-key rotation,
  auth-session design D3).
- No route changes; no server surface touched besides the cookie
  attributes.

## Decisions

**D1 — Preview back navigates to the parent directory, not history.**
The back control calls `navigate(browseUrl(vdirId, parentPath(path)))`,
mirroring `BrowsePage`'s own back semantics (it also walks the
directory tree, not the history stack). The header block replicates
BrowsePage's: back button + the file name as the title, so the push
model (browse → preview → back) reads like iOS navigation.
*Rejected `navigate(-1)`*: undefined on a fresh load / direct link /
after the media-new-tab flow, and inconsistent with BrowsePage's
tree-based back.

**D2 — Token lifetime via a new migration; cookie `MaxAge` follows the
collection config.** `internal/migrations/1770000004_users_token_lifetime.go`
sets `users.AuthToken.Duration = 94670856` (the v0.40.4 validated
maximum; default 432000). `sessionCookie` in `internal/authbridge/cookie.go`
gains a `MaxAge` (seconds); `handleAuthLogin` reads it from
`FindCollectionByNameOrId("users").AuthToken.Duration`, so there is one
source of truth and no duplicated constant. Browsers cap cookie
lifetime at 400 days (RFC 6265bis) and clamp silently — the server
still satisfies "MaxAge ≥ 400 days"; the browser cap then bounds
persistence.
*Rejected: hand-editing the value in the PocketBase dashboard* —
unreproducible config drift; migrations are the repo's source of truth
and run idempotently on serve/bootstrap.
*Rejected: editing migration `1770000001`* — already applied on
existing deployments; migrations are append-only (`connection_remote_dir.go`
precedent).
*Rejected: a refresh/renewal flow* — new mechanics, token store
complexity, and the ask is a fixed maximum.

**D3 — Write actions move to the header at all widths.** The `canWrite`
block (New Folder, Upload button, hidden file input) relocates from the
toolbar row into the header area in `BrowsePage` (below/adjacent to the
breadcrumbs); `data-testid`s (`new-folder`, `upload-button`,
`upload-input`) are preserved so component tests and `web/e2e/
file-management.spec.ts` selectors keep working. The toolbar keeps sort
key + direction + list/grid and drops `justify-between`.
*Rejected: icon-only collapse on small displays* — the user's stated
non-preferred option; loses label clarity and keeps two competing rows.
*Rejected: floating action button* — departs from the established iOS
Files pattern.
*Rejected: moving sort controls into a menu* — larger rework than asked.

**D4 — Bottom clearance becomes a per-page concern; the shell stops
reserving it.** The tab bar is a fixed overlay, so content should own
its clearance: `AppShell` drops `pb-24 md:pb-0` from its scroll
container. `EntryList`/`EntryGrid` keep `h-full` (now reaching the
viewport bottom) and gain a trailing spacer (≈ `h-24` + `pb-safe`) as
the last child of the scroll element, after the virtualized card, so
the final rows scroll fully above the bar — the spacer only grows
scrollHeight and does not participate in the virtualizer's measurements.
Every other destination rendered inside the shell (Locations, Uploads,
Settings and its sub-pages, Move picker, Preview, NotFound) gets `pb-24
md:pb-0` on its scrollable root so nothing hides behind the bar.
*Rejected: keeping shell padding and compensating in BrowsePage with
`-mb-24` / `calc` heights* — fragile against the `h-full` percentage
chain and the virtualizer's height math.
*Rejected: route-conditional shell padding (`pathname.startsWith("/v/")`)* —
spreads route knowledge into the shell and silently breaks for future
routes.

**D5 — Verification split.** Component tests (Vitest + Testing
Library) cover the three UI behaviors locally; Go tests cover the
migration (`internal/migrations/` — assert `users.AuthToken.Duration`
after migrations) and the login cookie (`internal/authbridge/` — assert
`Set-Cookie` `MaxAge` ≥ 400 days and unmodified logout/clear behavior);
E2E additions (preview back, header actions) stay in `web/e2e/` for the
verification server, per repo policy.

## Risks / Trade-offs

- [Long-lived tokens widen the replay window for a stolen cookie] →
  Existing mitigations unchanged: HttpOnly + SameSite=Lax + Secure on
  HTTPS; logout rotates the token key and kills all sessions at once.
  User-requested trade-off for a personal drive.
- [Cookie (400-day browser cap) expires before the token (3 y)] →
  After 400 days `/files` requests 401 while record-API calls may still
  carry a valid token; the SPA's 401 interceptor clears the store and
  lands on login. Acceptable: one re-login per year.
- [Tokens issued before the migration keep the old 5-day expiry] →
  Harmless: they expire sooner, then a re-login mints a max-lifetime
  one.
- [Pages missed in the pb-24 sweep would hide content behind the tab
  bar] → Task list enumerates every shell destination explicitly; the
  tab bar only exists below `md`, and e2e on the verification server
  exercises the main flows at mobile viewport.
- [Full-bleed rows render "cut" mid-scroll beneath the bar] → Intended
  iOS effect: the bar is `backdrop-blur-xl bg-ios-card/80`, so content
  shows through blurred rather than being clipped.

## Migration Plan

Deploy = rebuild (the SPA is embedded). The migration applies
automatically on the next `serve` (idempotent, append-only). Rollback
to the previous binary leaves the duration at the maximum — harmless;
the UI rolls back with the binary. No data migration beyond the
collection config.

## Open Questions

None.
