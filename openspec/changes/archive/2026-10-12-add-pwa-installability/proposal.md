# Proposal

## Why

The SPA is already a polished, mobile-first iOS-style shell (ADR 0008),
but a browser cannot install it: there is no web app manifest, no app
icons, and no install metadata, so it can only be used as a website in a
browser tab. Making it installable turns Stratofold into a first-class
home-screen / dock app — a natural fit for a file manager people return
to — with a standalone window and a proper launcher icon.

## What Changes

- Add a web app manifest (`web/public/manifest.json`) declaring the
  installability contract: `name`/`short_name`, `start_url` and `scope`
  `/`, `display` `standalone`, `theme_color`/`background_color` matching
  the iOS design tokens, and `icons` (192, 512, a 512 `maskable`, and an
  SVG) served from `web/public/icons/`.
- Link the manifest and add the install/metadata tags to `web/index.html`:
  `theme-color`, the icon links, and the iOS-specific
  `apple-touch-icon` (180), `apple-mobile-web-app-capable` (or
  `mobile-web-app-capable`), `apple-mobile-web-app-status-bar-style`,
  `apple-mobile-web-app-title`, and `viewport-fit=cover`.
- Add a lightweight **Install app** entry in the Settings tab: when the
  browser fires `beforeinstallprompt` it appears and triggers the native
  install prompt; when it is unavailable (e.g. iOS, or already installed)
  it is not shown, so no false affordance is offered. iOS users install
  through Safari's Share → Add to Home Screen using the same manifest and
  `apple-touch-icon` metadata.
- Explicitly **no service worker**: installability does not require one,
  and the app gains no offline behavior (see Non-goals). The manifest is
  served as `manifest.json` so the Go static handler's existing
  `application/json` content type is a valid manifest MIME (the W3C spec
  accepts any JSON MIME type) — no backend change.
- New ADR `docs/decisions/0009-pwa-installable-no-offline.md` recording
  the installability contract and the deliberate "no service worker / no
  offline" boundary; update `docs/decisions/README.md`,
  `docs/architecture.md` (SPA section), and `AGENTS.md` (web-UI note).

## Capabilities

### New Capabilities

- `pwa`: the installability contract for the browser SPA — a web app
  manifest with the browser-required members, launcher/apple-touch icons,
  install/metadata tags on the shell, standalone launch, and an in-app
  install affordance that only appears when the browser can install;
  explicitly no offline capability.

### Modified Capabilities

- (none — the SPA's existing behavior requirements are unchanged; this
  adds a new, separately-owned installability contract.)

## Impact

- **Code**: the `web/` SPA only — `web/index.html`,
  `web/public/manifest.json`, `web/public/icons/*`, the Settings page and
  its install affordance, plus Vitest/Playwright coverage. The Vite build
  copies `public/` into `dist/`, so the embedded-SPA server already serves
  the manifest and icons with no Go/API/PocketBase change.
- **Specs**: new `openspec/specs/pwa/spec.md` (created by this change).
- **Docs**: new ADR `docs/decisions/0009-pwa-installable-no-offline.md` +
  `docs/decisions/README.md` index row; `docs/architecture.md` SPA
  section; `AGENTS.md` web-UI note.
- **Systems**: none — no new dependencies, no CI change, no registry or
  deployment change. HTTPS is already required in production (the session
  cookie is `Secure`), satisfying the installability secure-context
  requirement.

## Non-goals

- No service worker and no offline behavior of any kind: no offline app
  shell, no cached file contents, no background sync, no
  service-worker-backed uploads surviving tab close. These remain
  deliberate non-goals of the current architecture.
- No push notifications, web share target, file handlers, app shortcuts,
  screenshots, or app-store packaging (Play Store / App Store).
- No backend, API, PocketBase, `/files`, or deployment/serving changes;
  no new runtime dependency (no `vite-plugin-pwa`).
- No dark-mode/theme switching work beyond the single theme color the
  manifest already needs.
