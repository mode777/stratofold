# Tasks

## 1. Cast SDK foundation

- [x] 1.1 Add `web/src/lib/cast.ts` with the minimal Cast type surface and a lazy SDK loader that injects `https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1` once, resolves through `window.__onGCastApiAvailable`, and short-circuits when `cast.framework` already exists; verify the loader test resolves with a pre-defined fake SDK and makes no script injection.
- [x] 1.2 Add the root `CastProvider` and `useCast` hook covering `CastContext` options (Default Media Receiver), session state, device name, remote-player connection, and the stop action; verify tests drive fake `SESSION_STARTED` / `SESSION_ENDED` / `IS_CONNECTED_CHANGED` events and assert the exposed state transitions.

## 2. Media resolution and receiver load

- [x] 2.1 Resolve the cast media URL in the provider: an authenticated session mints a fresh link through the existing `mintFileLink` API and returns its absolute `/s/<token>` URL; an anonymous public session returns the plain absolute `/files` URL; verify tests assert the mint call for the authenticated case, no mint for anonymous, and that the local `<video>` source is unchanged in both.
- [x] 2.2 Build the `MediaInfo` with the per-extension content type (`mp4`/`m4v` → `video/mp4`, `webm` → `video/webm`, `mov` → `video/quicktime`, `ogv` → `video/ogg`) and the file name as title, call `session.loadMedia`, and pause local playback only after the promise resolves; verify tests assert the URL/content type/title and the pause ordering (no pause on rejection).

## 3. Cast UI, persistence, and failures

- [x] 3.1 Add the Cast button to the video player, visible only when the SDK is available, with connecting/connected states; verify component tests for supported vs unsupported environments and for the picker-connected path.
- [x] 3.2 Add the shell-level casting indicator naming the device with a stop action, driven by the root provider so it survives navigation; verify a routed test starts a cast, navigates away, still shows the indicator, and that stop calls `endSession(true)` and clears the state.
- [x] 3.3 Map every failure explicitly: cancelled picker/no devices, link mint failure with retry, and `loadMedia` rejection (unsupported container/codec or unreachable URL); verify tests assert no success state is claimed and local playback remains usable in each case.

## 4. Documentation and decision record

- [x] 4.1 Write `docs/decisions/0011-chromecast-default-receiver.md` from `TEMPLATE.md` (official Web Sender SDK, Default Media Receiver, lazy loading, link-backed media URLs, HTTPS/Chromium-only constraints, rejected alternatives) and add it to the `docs/decisions/README.md` index; verify `npx openspec validate --all --strict` and the index row.
- [x] 4.2 Update `docs/using-stratofold.md` (casting a video, the 24-hour link, device/network/TLS limits), `docs/hosting.md` (sender HTTPS, receiver-reachable origin/public CA, CORS and proxy buffering for `/s/`, access-log redaction), the SPA section of `docs/architecture.md`, and the `AGENTS.md` web-UI bullet; verify every statement matches the new spec scenarios and note that native media-hub Cast of a non-public `/files` URL remains unsupported.

## 5. Verification

- [x] 5.1 Run `npm --prefix web run test` and confirm the cast, player, and browse suites pass with the fake SDK.
- [x] 5.2 Add a Playwright cast test that injects a stub SDK with `addInitScript`, starts a cast, asserts the real mint request and the `loadMedia` URL, and fetches that URL without cookies; run it on the build/verification server.
- [ ] 5.3 Run the manual real-device checklist on the verification network (private-vdir MP4 and public-vdir MP4 cast, receiver pause/seek, navigate away and stop via the indicator, a receiver-side disconnect, and an unsupported container error) and record the results in the change.
- [x] 5.4 Run `npx openspec validate --all --strict` and confirm the change validates.
