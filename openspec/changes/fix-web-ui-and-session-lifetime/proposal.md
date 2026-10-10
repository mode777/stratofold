# Proposal

## Why

First real use of the iOS-style SPA surfaces four usability gaps: the
preview (download) screen is a dead end with no way back, the browse
toolbar cannot fit its controls at mobile widths, the listing stops
short of the bottom tab bar leaving a dead strip, and sessions die far
too soon (PocketBase's 5-day default token plus a browser-session
cookie) for a personal cloud drive that should behave like Drive or
Dropbox.

## What Changes

- **Preview back button**: the pushed preview screen (`/v/:vdirId/view/*`)
  gains a back control that returns to the listing of the containing
  directory, matching the browse screen's back affordance.
- **Maximum-lifetime sessions**: login issues auth tokens valid for the
  longest duration PocketBase accepts (its validated maximum of
  94,670,856 s ≈ 3 years; default today is 5 days), and the `sf_session`
  cookie becomes persistent with a matching `MaxAge` so it survives
  browser restarts instead of dying with the session.
- **Write actions move to the folder header** (the user's stated
  preference over collapsing them into icons): New Folder and Upload are
  offered in the browse header above the breadcrumbs; the compact
  toolbar keeps only the view controls (sort key, sort direction,
  list/grid), which fits at mobile widths.
- **Full-height listing**: the browse listing extends to the bottom edge
  of the viewport, scrolling beneath the translucent tab bar on mobile
  (no dead gap between the last visible row and the bar); the last
  entries remain scrollable fully above the bar.

Assumptions: "maximum possible time" is read as PocketBase's hard
validation maximum for token durations (browsers additionally cap cookie
lifetime at 400 days, which becomes the effective persistence ceiling).
The header placement applies at all viewport widths, not only small
displays, since it is the preferred option and simplifies the layout.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-ui`: adds requirements for preview back navigation, header
  placement of the write actions (New Folder / Upload), and a
  full-viewport-height browse listing that scrolls beneath the mobile
  tab bar.
- `auth-session`: adds a requirement that issued sessions last the
  maximum supported lifetime and that the session cookie is persistent,
  without weakening logout invalidation or expiry rejection.

## Impact

- `web/src/pages/PreviewPage.tsx` — back control.
- `web/src/pages/BrowsePage.tsx` — write actions relocate to the header;
  toolbar keeps view controls.
- `web/src/components/AppShell.tsx`, `web/src/components/EntryViews.tsx`
  — bottom clearance moves out of the scroll container so the listing
  reaches the viewport bottom (other destinations keep clearance for
  their content).
- `internal/authbridge/cookie.go` — persistent cookie with `MaxAge`.
- `internal/migrations/` — new migration (`1770000004_users_token_lifetime.go`)
  raising `users.authToken.duration` to the PocketBase maximum.
- Docs: a one-line correction in `AGENTS.md` (cookie is now persistent);
  **No ADR** — UI polish plus a configuration value inside the existing
  auth bridge (ADR 0002 unchanged); no stack-shaping decision.
- Tests: `web/src` component tests, `web/e2e/` (verification server),
  `internal/authbridge/` and `internal/migrations/` Go tests.

## Non-goals

- No token refresh/renewal flow and no per-user configurable session
  lifetime — one fixed maximum for all users.
- No change to logout semantics: it stays all-devices invalidation via
  token-key rotation (auth-session design D3).
- No change to media playback, download URLs, upload transport, or any
  server route besides the cookie attributes.
- No offline/service-worker behavior (deliberately absent per ADR 0009).
