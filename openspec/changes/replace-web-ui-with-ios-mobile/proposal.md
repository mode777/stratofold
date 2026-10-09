# Proposal

## Why

The SPA works but its interface is a utilitarian web layout (top header,
desktop sidebar, corner upload panel) that is especially poor on mobile.
A complete visual reference now exists in
`design/design-showcase.html` — a native-iOS-HIG mobile experience across
18 screens plus error states — and we want the product to feel like a
polished first-party iPhone app while remaining a responsive web SPA.

## What Changes

- **BREAKING (UI)**: Replace the entire SPA presentation layer. The
  current `AppShell` (top header, desktop sidebar, mobile drawer,
  bottom-right `UploadPanel`), the pages, and the dialogs are removed
  and rebuilt as an iOS-style shell:
  - Translucent bottom **tab bar**: Files / Uploads / Settings.
  - Large-title navigation bars, pushed detail screens, bottom sheets
    with grabbers, and centered destructive alerts.
  - iOS system palette, system (SF Pro) font stack, inset-grouped list
    surfaces, 44pt minimum touch targets, safe-area insets.
- **Login**: restyled iOS full-screen card (geometric app mark, inset
  credential rows, password eye toggle, inline error banner, busy state).
- **Files tab**: a "Locations" root with **My vdirs** / **Shared with
  me** inset groups, public pills, and a "Manage vdirs" link — replacing
  the sidebar `VdirSwitcher`. Opening a vdir pushes the browser.
- **Browse**: iOS list and 3-column grid views with folder-first
  sorting, per-type tinted icons, middle-truncated names, and a compact
  toolbar (sort, list/grid toggle, and — for writers only — New /
  Upload). Navigation uses a back chevron plus a tappable breadcrumb
  path instead of a breadcrumb-only bar.
- **Entry actions**: long-press **context menu** (Open / Download; media
  also "Open in new tab"; Rename / Move / Delete for writers). File
  operations become iOS sheets and alerts: New Folder sheet, Rename
  sheet, Move folder-tree picker, and a destructive Delete alert.
- **Preview**: a Quick Look-style screen for non-media files showing
  client-derived type, size, and modified time plus Download. Media
  files continue to open in a **new browser tab** at their `/files`
  URL (native player) — the embedded player mockups are intentionally
  not implemented.
- **Uploads tab**: the queue becomes a full tab with Pause All / Resume
  All, per-item progress and lifecycle state, cancel and retry, a
  numeric tab badge, and a floating progress pill on other screens.
- **Settings tab**: account section (email, sign-out that ends the
  session on all devices) plus Connections and Virtual Directories
  lists. Connection and vdir management become pushed full-height
  sheets; the vdir form keeps the public switch and links to Sharing.
- **Sharing**: restyled as a pushed screen — invite by email with
  Viewer / Editor role rows, a people-with-access list with role
  change and revoke, self-share guard, and duplicate rejection surfaced.
- **States**: the four API error classes plus empty/loading are restyled
  to the new visual language; add a dedicated Page Not Found screen.
  Retry is offered only for retryable failures.
- **Unchanged behavior** (kept, restyled): session gating and
  return-to-login on 401, role-based write gating (viewers and public
  browse see no write affordances), folder-first sorting, virtualized
  large listings, downloads via `/files`, background upload semantics,
  and keyboard navigability.

## Capabilities

### New Capabilities

<!-- none: this rewrites an existing capability -->

### Modified Capabilities

- `web-ui`: the SPA's presentation, navigation model, and several
  behaviors change — tab-based shell, Locations root, back-chevron +
  breadcrumb navigation, context menu, preview screen, Settings/
  Connections/Vdirs/Sharing screens, and a Page Not Found screen.
- `upload-queue`: the queue's status surface changes from a persistent
  corner panel to an Uploads tab plus a floating progress indicator on
  other screens (the underlying queue semantics are unchanged).

## Impact

- **Code**: the `web/` SPA only — `web/src/App.tsx`, pages, components,
  `web/src/index.css` (design tokens), and their Vitest/Playwright
  suites. No Go, API, PocketBase, or `/files` changes; no new
  dependencies.
- **Reference artifact**: `design/design-showcase.html` (already in the
  repo) is the visual source of truth for this change and is not shipped
  in the app.
- **Specs**: `openspec/specs/web-ui/spec.md`,
  `openspec/specs/upload-queue/spec.md`.
- **Docs**: update `AGENTS.md` (web-UI description); add a new ADR
  `docs/decisions/0008-ios-mobile-spa-shell.md` for the mobile-first
  iOS shell and design system and index it in
  `docs/decisions/README.md`. ADR 0005 (stack) is unchanged.
- **No backend changes**: all metadata shown is derived from the
  existing `ls` response (name, size, directory flag, modified time) and
  account email; file permissions, format, origin, and folder item
  counts from the mockups are dropped.

## Non-goals

- No embedded media player — media keeps opening in a new tab (current
  `web-ui` requirement retained).
- No backend/API/spec changes for metadata the API does not return.
- No dark mode, theming, or i18n; the design is light-mode only.
- No search, multi-select/bulk actions, drag-and-drop, folder upload,
  offline/sync, trash/restore, favorites, or notifications.
- No desktop-only redesign: the shell stays mobile-first and responsive,
  widening gracefully on large viewports.
