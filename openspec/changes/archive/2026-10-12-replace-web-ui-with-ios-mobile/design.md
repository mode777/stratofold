# Design

## Context

See `proposal.md` for motivation. The SPA (ADR 0005: React 19 + Vite 7
+ TypeScript + Tailwind v4, React Router 7, PocketBase SDK, TanStack
Virtual) currently uses a top header + desktop sidebar + mobile drawer
shell and a corner upload panel. The behavior seams that must survive
the rewrite are already isolated: `web/src/lib/filesApi.ts` (HTTP +
error classes), `web/src/lib/uploadQueue.ts` + `useUploadQueue`
(queue semantics), `web/src/lib/useVdirRole.ts` (effective role),
`web/src/lib/records.ts`, and `web/src/lib/session.tsx` (401 →
login). `design/design-showcase.html` is a static, self-contained
reference for the target look (it uses the Tailwind CDN and Font Awesome
and must not be shipped). No backend or API change is in scope.

## Goals / Non-Goals

**Goals:**
- Rebuild the SPA's presentation as a native-iOS-HIG mobile experience
  matching `design/design-showcase.html`, on top of the existing,
  unchanged behavior seams.
- One design-token source and one responsive navigation shell shared by
  mobile and desktop, so the visual language cannot drift.

**Non-Goals:**
- No changes to `filesApi`, `uploadQueue`, auth/session, or any Go code.
- No embedded media player (media keeps opening in a new tab).
- No new runtime dependency and no component library.
- No dark mode, theming, or i18n.

## Decisions

### D1. iOS design tokens in Tailwind v4 `@theme`

`web/src/index.css` grows from a single `@import "tailwindcss";` into a
token layer: system font stack (`-apple-system, BlinkMacSystemFont, "SF
Pro Text", …`), the iOS system palette (`#007AFF`, `#FF3B30`,
`#34C759`, `#F2F2F7`, `#E5E5EA`, label/secondary/tertiary grays),
grouped-surface radii (12px cards, 32px sheet tops), and safe-area
insets. Components consume semantic utilities, never raw hex.

*Rejected:* hard-coded hex per component (drift, no single source);
adding a component/icon library (new dependency; ADR 0005 chose a custom
design system).

### D2. Icons as inline SVG components

The reference uses Font Awesome; the current app uses emoji. Neither is
acceptable (external dependency vs unpolished). Add a small
`web/src/components/icons.tsx` of inline, stroke-based SVG glyphs
(folder, doc, film, music, image, chevrons, plus, ellipsis, trash,
pencil, tray, gear, lock, wifi, warning, check, person). No dependency.

*Rejected:* Font Awesome CDN (external, offline-hostile, licensing
surface); emoji (current state, platform-inconsistent).

### D3. Responsive shell: tab bar on mobile, sidebar on wide viewports

A single `AppShell` renders primary navigation adaptively: bottom,
translucent (backdrop-blur) tab bar for Files / Uploads / Settings below
the `md` breakpoint, and a persistent left sidebar with the same three
destinations at `md` and up (the Apple Files iPhone→iPad pattern). The
active destination and the Uploads badge are shared between both
renderings. Content is width-capped and centered on wide viewports.

*Rejected:* phone-only fixed 390px frame (user chose responsive);
bottom tab bar at every width (poor desktop ergonomics); keeping the
old header/sidebar (the problem being fixed).

### D4. Navigation model and route map

React Router keeps destination state in the URL so back/deep links work.
`/` redirects to `/files`; Files root lists Locations, browsing is
`/v/:vdirId/*` (unchanged path shape), preview is a pushed route
`/v/:vdirId/view/<path>`, Uploads is `/uploads`, Settings is `/settings`
with pushed `/settings/connections`, `/settings/connections/:id`,
`/settings/vdirs`, `/settings/vdirs/:id`, and
`/settings/vdirs/:id/sharing`. Unknown routes render the Page Not Found
screen. Transient UI (context menu, New Folder/Rename sheets, Move
picker, Delete alert) is overlay state, not routes, except Move which is
a pushed picker for back behavior.

*Rejected:* keeping everything on one route with local view state
(loses back/deep-link); making sheets routes (back-stack noise).

### D5. Overlay primitives: Sheet and Alert

Refactor `web/src/components/Dialog.tsx` into two portal-based
primitives — `Sheet` (bottom sheet with grabber, small/medium detents)
and `Alert` (centered destructive confirm) — both focus-trapped,
Escape/backdrop dismissible, with the existing accessibility semantics.

*Rejected:* reusing the current centered modal for everything (not iOS);
a third-party sheet library (dependency).

### D6. Interaction gestures without a gesture library

Long-press context menu is a pointer-events hook (≈500ms hold, cancelled
by movement/scroll) plus an explicit focusable actions affordance so the
same menu is keyboard- and accessibility-reachable (spec: "actions are
keyboard reachable"). Pull-to-refresh is a small scroll-offset hook on
the list containers. Both are plain React; no dependency.

*Rejected:* a gesture library (dependency, bundle size); long-press only
(breaks keyboard users and the existing keyboard-navigation spec).

### D7. Client-derived metadata only

Preview/type display derives from the existing `ls` fields (`name`,
`size`, `dir`, `modtime`): file-type icon/color and media-ness reuse the
`isMediaName` extension table; the account display name uses the
PocketBase auth record's `name` when set, else the email. The mockups'
permissions, format, origin, and folder item counts are dropped.

*Rejected:* extending the backend for richer metadata (user chose no
backend changes; would enlarge scope and the `ls` contract).

### D8. Uploads surface

Keep `uploadQueue.ts` / `useUploadQueue` exactly as-is. Render the queue
in the Uploads destination and add a `FloatingUploadIndicator` shown on
other destinations while uploads are active; the tab/sidebar Uploads
item shows the active count. This satisfies the modified `upload-queue`
requirement without touching queue semantics.

*Rejected:* keeping the corner panel (fights the tab bar); rebuilding
the queue (out of scope, R7 already retired).

### D9. Virtualization preserved

Keep TanStack Virtual for the list (≈56px iOS rows) and grid (3 columns)
so the 10k-entry acceptance target still holds.

*Rejected:* dropping virtualization (regresses the large-listing
requirement).

## Risks / Trade-offs

- **Rewrite churn breaks the existing Vitest/Playwright suites** → Keep
  behavior seams untouched and update tests alongside each screen; the
  E2E flows (login, browse, download, upload, mutations, role gating)
  are re-pointed at the new selectors, not rewritten.
- **Long-press vs scroll/selection on touch** → Cancel on movement and
  provide the explicit actions affordance as a fallback (D6).
- **`backdrop-filter` cost on low-end devices** → Use blur only on the
  tab bar/sidebar/sheets, with an opaque fallback.
- **Mobile tab bar and desktop sidebar drifting** → One shell component
  with shared destination/badge state (D3).
- **Scope creep toward richer metadata** → D7 pins client-derived only;
  the dropped mockup fields are explicitly out of scope.
- **The reference is CDN-based and not a component spec** → Port tokens
  and structure by hand; do not copy its CDN/Font Awesome or embed it.

## Migration Plan

In-place SPA replacement on the same routes and API; no data migration.
Sequence: tokens + overlay primitives + shell first, then Login, Files
Locations, Browse (list/grid/context/preview), Uploads, Settings +
Connections/Vdirs/Sharing, then error/not-found screens and test
updates. Rollback is a revert of the change (git); there is no server or
persisted-state coupling.

## Open Questions

- Exact wide-viewport breakpoint and whether the desktop sidebar is
  collapsible — deferrable; D3 fixes the pattern, not the pixel value.
- Whether the Move picker also keeps the current free-text path entry —
  deferrable UI affordance, does not change the spec.
