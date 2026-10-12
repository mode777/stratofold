# Tasks

## 1. Web app manifest and launcher icons

- [x] 1.1 Add `web/public/manifest.json` with `name`/`short_name` ("Stratofold"), `id`/`start_url`/`scope` `/`, `display` `standalone`, `theme_color` `#007aff`, `background_color` `#f2f2f7`, and the `icons` entries (192 any, 512 any, 512 maskable, SVG); verify with a new Vitest test `web/src/pwa/manifest.test.ts` that reads the file and asserts every browser-required member and the 192px/512px icons
- [x] 1.2 Add the icon assets under `web/public/icons/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png` with maskable safe-zone padding, `apple-touch-icon.png` 180×180, `icon.svg`) derived from the existing geometric app mark; verify the `manifest.test.ts` asserts every referenced icon path exists on disk and each is a valid PNG/SVG
- [x] 1.3 Confirm Vite copies the public assets into the build output; verify `npm --prefix web run build` produces `web/dist/manifest.json` and `web/dist/icons/*`

## 2. Shell install metadata

- [x] 2.1 Add the manifest link, `theme-color`, icon links, `apple-touch-icon`, and the iOS web-app metadata (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`) to `web/index.html`, and add `viewport-fit=cover` to the viewport meta; verify with a new Vitest test `web/src/pwa/shell.test.ts` that reads `web/index.html` and asserts each tag
- [x] 2.2 Confirm the shell's manifest link resolves to the built file at the site root (relative `/manifest.json`, not a hashed asset); verify the same `shell.test.ts` asserts the `href` and that the manifest file exists in `web/public`

## 3. In-app install affordance

- [x] 3.1 Implement `web/src/lib/useInstallPrompt.ts`: capture `beforeinstallprompt` (prevent default, hold the event), clear on `appinstalled`, expose `canInstall` and `promptInstall()`, with a minimal local `BeforeInstallPromptEvent` type; verify with `web/src/lib/useInstallPrompt.test.tsx` covering event capture, `appinstalled` clearing, and prompt invocation
- [x] 3.2 Add an "Install app" row to `web/src/pages/SettingsPage.tsx` that renders only when `canInstall` is true and calls `promptInstall()` on activation (reuse an existing icon or add one to `components/icons.tsx`); verify with new cases in `web/src/pages/SettingsPage.test.tsx` (shown when the event fires, absent otherwise, activation calls prompt)

## 4. End-to-end verification

- [x] 4.1 Add `web/e2e/pwa.spec.ts`: the shell links a fetchable manifest (`200`, JSON content type) declaring the required members with reachable icons; no service worker is registered; and the Settings install row is absent when the browser offers no install prompt; verify on the build/verification server with `npm --prefix web run e2e` (never a local gate)
- [x] 4.2 Confirm the release image serves the PWA assets by running the E2E suite against the built image in CI (`SF_E2E_BASE_URL` pointing at the running container) and confirming `GET /manifest.json` and the icon URLs return `200`

## 5. Documentation and ADR

- [x] 5.1 Write `docs/decisions/0009-pwa-installable-no-offline.md` from `docs/decisions/TEMPLATE.md` (context, decision, consequences, rejected alternatives: `.webmanifest` mime handling, minimal service worker, always-visible install button) and add its row to `docs/decisions/README.md`
- [x] 5.2 Update the SPA section of `docs/architecture.md` with the installability contract (`manifest.json`, icon set, standalone launch) and the explicit no-service-worker / no-offline boundary; verify the prose matches `openspec/changes/add-pwa-installability/specs/pwa/spec.md`
- [x] 5.3 Update the `AGENTS.md` web-UI note with PWA installability: `web/public/manifest.json` + `web/public/icons/`, the Settings install affordance, the deliberate absence of a service worker, and the verification commands; verify the guidance names the changed files and tests

## 6. Integration verification

- [x] 6.1 Run `npm --prefix web run test` and confirm all component/unit tests pass (manifest, shell, install hook, Settings)
- [x] 6.2 Run `npm --prefix web run build` and confirm the output contains `dist/manifest.json` and `dist/icons/*` with no TypeScript errors
- [x] 6.3 Run `go vet ./... && go test ./...` and confirm the Go suite is unaffected (no backend change; the embedded placeholder is untouched)
- [x] 6.4 Run `npx openspec validate --all --strict` and confirm the change validates with no errors
