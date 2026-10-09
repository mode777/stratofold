# 0009 — Installable PWA with no offline capability

Status: Accepted (2026-10)

## Context

The SPA is a mobile-first iOS shell (ADR 0008) but could only be used as
a website in a browser tab: no web app manifest and no app icons, so
browsers never offered installation. A file manager people return to
benefits from a home-screen / dock presence and a standalone window.
Installability in Chromium requires only a manifest with the required
members and icons over a secure context — a service worker is **not**
required — while offline caching conflicts with the architecture's
stream-don't-cache stance (see the `add-pwa-installability` change for
the full process record).

## Decision

The SPA (`web/`) is an **installable PWA with no offline capability**:

- **Manifest**: `web/public/manifest.json`, served as `application/json`
  (a valid JSON MIME for a manifest; the IANA `application/manifest+json`
  is only recommended). It declares `name`/`short_name`, `id`/
  `start_url`/`scope` `/`, `display` `standalone`, the iOS-token
  `theme_color` `#007aff` and `background_color` `#f2f2f7`, and the icon
  set.
- **Icons**: committed static assets under `web/public/icons/` —
  `icon-192.png` and `icon-512.png` (`any`), `icon-maskable-512.png`
  (`maskable`, inside the safe zone), `apple-touch-icon.png` (180), and
  `icon.svg`. The Vite build copies `public/` into `dist/`, so the
  embedded-SPA server serves them unchanged.
- **Shell metadata**: `web/index.html` links the manifest and the icons
  and carries the iOS Add to Home Screen metadata; `viewport-fit=cover`
  lets the existing safe-area helpers apply in standalone mode.
- **Install affordance**: the Settings screen offers an "Install app"
  row only while Chromium's `beforeinstallprompt` event is held
  (`web/src/lib/useInstallPrompt.ts`); it is absent on iOS and once
  installed, so no false affordance is shown.
- **No service worker**: the app registers none and caches no
  application, API, or file response. An installed app without network
  connectivity shows the normal failure states.

## Consequences

- Installation is browser-promoted (desktop/Android) or via Safari's
  Add to Home Screen (iOS); the app opens standalone at `/`.
- The app **always requires the network**; there is no offline shell, no
  cached file content, and no stale-content risk. Any future offline,
  push, or background-sync work must supersede this ADR explicitly
  rather than extend it silently.
- New launcher art means committing raster assets under
  `web/public/icons/`; `icon.svg` is the scalable source.
- The manifest stays `.json` to keep the Go static handler's content type
  correct without a backend change; switching to `.webmanifest` would
  require a deliberate server mime-type change.
- No new runtime dependency: no `vite-plugin-pwa` or service-worker
  tooling.

## Rejected alternatives

- **`manifest.webmanifest` with a server mime registration**: Go's
  `mime.TypeByExtension` has no `.webmanifest`, so it would be sniffed to
  `text/plain`; fixing that needs a backend change for no behavioral gain
  over the valid `.json` form.
- **A minimal passthrough service worker**: installability does not need
  one, and a fetch handler is a seam that invites future caching plus a
  scope/headers concern on the server.
- **Cache the app shell for offline**: outside the chosen
  "installable only" scope and a step toward offline semantics the
  architecture rejects.
- **Always render an install button**: a dead control on iOS and when
  already installed — a false affordance.
- **`vite-plugin-pwa`**: a build dependency and generated service worker
  for what a static manifest and committed icons already achieve.
