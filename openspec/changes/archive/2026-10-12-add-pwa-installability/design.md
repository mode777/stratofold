# Design — `add-pwa-installability`

## Context

See `proposal.md` — Why. The current state that shapes the approach:

- The SPA is built by Vite (`web/`): `web/index.html` is the shell,
  `web/public/*` is copied verbatim into `dist/`, and the Go server
  embeds and serves `dist/` through `internal/webassets` (`go:embed`,
  `e.FileFS` → `http.ServeContent`). Real files are served as-is;
  extensionless client routes fall back to the shell
  (`internal/webassets/webassets.go:78-88`).
- Go's `mime.TypeByExtension` has no `.webmanifest` entry, so
  `http.ServeContent` would sniff such a file to `text/plain`; `.json`
  maps to `application/json` (`src/mime/type.go`).
- Installability (Chrome/Chromium) requires only a manifest with
  `name`/`short_name`, 192px + 512px icons, `start_url`, `display`, and
  no `prefer_related_applications` opt-in, served over HTTPS/localhost —
  a service worker is **not** required (MDN, "Making PWAs installable").
- The iOS design tokens live in `web/src/index.css`
  (`--color-ios-bg: #f2f2f7`, `--color-ios-blue: #007aff`); the Settings
  screen (`web/src/pages/SettingsPage.tsx`) is the natural home for an
  install affordance.

## Goals / Non-Goals

**Goals:**

- Meet the browser installability criteria with the smallest possible
  change, entirely in the `web/` workspace.
- Make the manifest and icons correct on both origins the app is served
  from: the Vite dev server (E2E) and the Go binary (release image).
- Keep the install affordance honest — shown only when the browser can
  actually install.

**Non-Goals:**

- Any offline capability, caching, or service worker (see the spec's
  "no offline capability" requirement and the proposal's Non-goals).
- Any Go/API/PocketBase/`/files` change; no new npm dependency.
- App-store packaging, push, share target, shortcuts, screenshots.

## Decisions

### D1 — Own the contract as a new `pwa` capability, not a `web-ui` delta

Installability is a distinct, separately testable contract (manifest
members, icons, standalone launch, install affordance) and it is the seam
where a future offline/push change would extend. `web-ui` already has
several in-flight deltas (`replace-web-ui-with-ios-mobile`), and this
change adds a new concern rather than changing the SPA's existing
behavior requirements.

Alternatives considered:

- *Extend `web-ui`* — rejected: overlapping deltas on one spec, and the
  installability contract would be buried among screen behaviors.
- *Modify `deployment`* — rejected: no serving behavior changes (D2), and
  the `deployment` capability is still proposed-but-unarchived; this
  change should not depend on that spec existing.

### D2 — Ship `manifest.json`, not `manifest.webmanifest`

The manifest is `web/public/manifest.json`, linked with
`<link rel="manifest" href="/manifest.json">`. Go serves `.json` as
`application/json`, and the W3C manifest spec accepts any JSON MIME type
(the IANA `application/manifest+json` is recommended but not required),
so both the Vite dev server and the Go binary serve it correctly with no
backend change.

Alternatives considered:

- *`manifest.webmanifest`* — rejected: Go would sniff it to `text/plain`;
  making it correct needs a server change (`mime.AddExtensionType` or a
  custom handler), which is out of scope.
- *A `/api/sf/...` manifest route* — rejected: unnecessary custom API
  surface for a static file the embed already serves.

### D3 — No service worker

Installability does not require a service worker, and the product
explicitly has no offline capability. No service worker is registered, so
there is no cache, no background sync, and no stale-content risk.

Alternatives considered:

- *A minimal passthrough service worker* — rejected: it adds a
  fetch-handler seam that invites future caching, plus a scope/headers
  concern on the Go server, for no installability benefit.
- *Cache the app shell only* — rejected: outside the chosen scope
  ("installable only") and a step toward offline semantics the
  architecture rejects.

### D4 — A committed, static icon set derived from the existing app mark

Icons are authored once and committed under `web/public/icons/` (Vite
copies them into `dist/`):

- `icon-192.png` and `icon-512.png` — `purpose: "any"`.
- `icon-maskable-512.png` — `purpose: "maskable"`, drawn inside the
  maskable safe zone (~80% centered) so platform masks do not clip it.
- `apple-touch-icon.png` (180×180) — referenced from the shell for iOS.
- `icon.svg` — the scalable source, referenced as a regular favicon.

The artwork reuses the geometric app mark already in the design language;
icons are static assets, not generated at runtime.

Alternatives considered:

- *SVG-only icon set* — rejected: `apple-touch-icon` and maskable
  launcher icons want reliable raster rendering across platforms.
- *Generate icons at build time* — rejected: adds a build dependency for
  a handful of static files.

### D5 — Shell metadata in `index.html`, no placeholder change

`web/index.html` gains the manifest link, `theme-color`, icon links, and
the iOS metadata (`apple-touch-icon`, `apple-mobile-web-app-capable`,
`apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`),
plus `viewport-fit=cover` so the existing safe-area helpers apply in
standalone mode. The committed placeholder `internal/webassets/dist/`
stays minimal; PWA behavior is verified through Vitest (shell/manifest
unit checks and the install hook) and Playwright against the dev server
or the built image — not through the Go `appserver` placeholder test.

### D6 — Install affordance via `beforeinstallprompt`, hidden otherwise

A small `useInstallPrompt` hook captures `beforeinstallprompt`
(`preventDefault`, keep the event) and clears it on `appinstalled`. The
Settings screen shows an "Install app" row only while that event is held;
activating it calls `prompt()`. Because iOS never fires the event, the
row is simply absent there and users install via Share → Add to Home
Screen using the same manifest/`apple-touch-icon`. `BeforeInstallPromptEvent`
is not in the DOM lib, so the hook declares a minimal local interface.

Alternatives considered:

- *Always render an install button* — rejected: it would be a dead
  control on iOS/already-installed (a false affordance).
- *Custom iOS "Add to Home Screen" instructions* — deferred: extra copy
  and state for little gain; can be added later without a spec change.

### D7 — Theme colors from the existing tokens

`theme_color` = `#007aff` (iOS blue), `background_color` = `#f2f2f7`
(iOS background), matching `web/src/index.css`. No new color tokens are
introduced.

### D8 — ADR for the installable-but-no-offline boundary

Record **ADR `docs/decisions/0009-pwa-installable-no-offline.md`**: the
app is installable, and it deliberately registers no service worker and
offers no offline behavior. This is a durable boundary future proposals
(offline file access, background uploads, push) must revisit explicitly,
so it belongs in `docs/decisions/` rather than only in the spec.

## Risks / Trade-offs

- **`.json` manifest is less conventional than `.webmanifest`** → it is
  valid JSON MIME per the spec; documented here and in the ADR, so a
  future move to `.webmanifest` is a deliberate server change, not a
  surprise.
- **Icons are the app's first binary assets in the repo** → keep the set
  small (192/512/maskable/apple-touch/SVG), derive from the existing mark,
  and check them into `web/public/icons/` where the build already copies
  them.
- **`beforeinstallprompt` is Chromium-only** → the affordance is additive;
  the browser's own install UI (and iOS Add to Home Screen) remains the
  primary path, and the row's absence is the correct behavior elsewhere.
- **Placeholder `dist` lacks the manifest** → Go placeholder tests are
  not the PWA gate; Playwright runs against the real Vite build (dev or
  image), where the manifest and icons exist.
- **Standalone display can hide browser affordances users rely on** (e.g.
  address bar) → `scope`/`start_url` are `/`, and the app is a
  single-origin SPA, so all in-app navigation stays inside the standalone
  window; external `/files` media links already open in a new tab.

## Migration Plan

1. Land the `web/` changes (manifest, icons, shell metadata, Settings
   install affordance, tests) and the docs/ADR updates together.
2. No data migration, no API change, no feature flag: serving the new
   static files is the existing embedded-SPA behavior. Rollback is
   reverting the commit; no persisted state is involved.
3. After deploy, confirm installability in a real browser over HTTPS
   (desktop install icon, Android WebAPK, iOS Add to Home Screen) as the
   manual acceptance check; automated coverage is Vitest + Playwright.

## Open Questions

None.
