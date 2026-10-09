# 0008 — iOS-style mobile-first SPA shell and design system

Status: Accepted (2026-10)

## Context

The SPA's first shell (change 7/8) was a utilitarian web layout — top
header, desktop sidebar, corner upload panel — that read poorly on
phones. The vision asks for a state-of-the-art, mobile-first,
Drive-like experience; `design/design-showcase.html` is the accepted
visual reference (18 screens plus error states) for a native-iOS-HIG
mobile app. This decision settles the durable shape of the SPA
presentation; the stack itself is unchanged (ADR 0005). See the
`replace-web-ui-with-ios-mobile` change for the full process record.

## Decision

The SPA (`web/`) is a **mobile-first iOS shell**:

- **Design tokens** live once in `web/src/index.css` via Tailwind v4
  `@theme` — system font stack, the iOS system palette, grouped-surface
  radii, and safe-area helpers. Components consume semantic utilities,
  never raw hex.
- **Primary navigation** is a translucent bottom tab bar (Files /
  Uploads / Settings) below the `md` breakpoint and a persistent left
  sidebar with the same destinations at `md` and up, rendered by one
  responsive `AppShell` so the two cannot drift.
- **Navigation patterns** follow the HIG: large-title bars with a back
  control, pushed detail screens, bottom sheets with a grabber, and
  centered destructive alerts.
- **Icons** are inline SVG components (`web/src/components/icons.tsx`);
  no icon-font or icon-library dependency.
- **Metadata shown is client-derived** from the existing API surface
  (`ls`: name, size, directory flag, modified time; the account email
  or PocketBase `name`). The UI never depends on fields the API does
  not return (permissions, format, origin, folder counts).
- **Media is not played in-app**: media entries still open in a new
  browser tab at their plain `/files` URL, where the native player
  takes over (the existing `web-ui` requirement is retained).

## Consequences

- Every future SPA screen inherits one visual language and one
  responsive shell; the reference is `design/design-showcase.html`, not
  the live app.
- Behavior seams (`filesApi`, `uploadQueue`, `useVdirRole`, `records`,
  `session`) are presentation-independent and remain untouched.
- Adding an icon means adding an inline SVG; there is no icon package
  to upgrade. Accepted cost: a small hand-maintained glyph set.
- No dark mode, theming, or i18n; the shell is light-mode only.
- The upload queue stays a framework-free singleton; the Uploads tab
  and the floating indicator are views over it, not a second manager.

## Rejected alternatives

- **Keep the header/sidebar/corner-panel shell**: the problem being
  fixed; it is not a first-party iOS feel.
- **Phone-only fixed 390px frame**: the SPA must stay responsive on
  desktop; a fixed frame wastes large viewports.
- **Bottom tab bar at every width**: poor desktop ergonomics; the
  adaptive sidebar is the HIG iPad pattern.
- **A component/icon library (MUI, Mantine, Font Awesome, Lucide)**:
  contradicts ADR 0005's custom design system and adds a dependency
  and bundle weight for a small glyph set.
- **An embedded media player**: the existing `web-ui` requirement
  keeps native new-tab playback, which needs no player code and
  streams via `/files` Range requests.
- **Extending the backend for richer file metadata**: out of scope and
  would enlarge the `ls` contract for presentation-only detail.
