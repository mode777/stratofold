# Proposal

## Why

Watching a video from Stratofold on a TV is a natural expectation for a
Drive-like media product. The Chromecast Default Media Receiver can play a
plain HTTP(S) media URL, but it fetches that URL itself, on its own
network, with no `sf_session` cookie — so today it can only play a file on
a public vdir. With the expiring-file-link primitive and the in-app video
player now in place, the app can hand the receiver a scoped 24-hour URL
and control the session from the player.

## What Changes

- The video player gains a **Cast** action where the browser supports the
  Cast Web Sender SDK (Chromium over a secure context). Selecting a device
  connects a session and loads the video into the **Default Media
  Receiver**; no custom receiver app is registered or shipped.
- Casting uses a session-free media URL: for a signed-in user the app
  mints a fresh 24-hour file link (`/s/<token>`); for an anonymous visitor
  of a public vdir it uses the file's plain absolute `/files` URL. The
  local `<video>` source stays the plain, cookie-authenticated `/files`
  URL and never carries a token.
- The load request identifies the media with the video's content type and
  the file name as its title; unsupported containers (for example MOV/OGV
  on a receiver that cannot decode them) surface an explicit failure
  instead of hanging.
- Local playback pauses while casting. A root-level cast provider keeps
  the session alive across in-app navigation, and the SPA shows a casting
  indicator naming the device with a stop action while a session is
  connected; stopping or disconnecting ends the remote playback and leaves
  local playback paused.
- Failures are explicit and never claim success: no devices/cancelled
  picker, a failed link mint (retryable), an unreachable media URL, or a
  receiver load/decode failure. The Cast action is absent — not disabled —
  when the SDK is unavailable (Safari/Firefox/iOS Chrome, insecure
  context, or a blocked script).
- The Cast SDK is loaded lazily for video playback, not app-wide, so other
  screens make no third-party request.

Assumptions (recorded, not blocking): signed-in casting always mints a
link, including on a public vdir (harmless, and it avoids plumbing vdir
publicness into the preview page); the 24-hour link window is the cast
lifetime; casting is limited to video in this change; and the receiver's
own UI plus the SPA stop action provide playback control (no mirrored
timeline or scrubber sync).

## Capabilities

### New Capabilities

None — this extends the SPA behavior.

### Modified Capabilities

- `web-ui`: a new requirement pins the Cast action, its session-free media
  URL selection, the receiver metadata, the cross-navigation session
  indicator, and the explicit failure behavior.

## Impact

- Code: new `web/src/lib/cast.ts` (SDK loader, types, `CastProvider`,
  `useCast`), a `CastButton`/cast indicator component, the app-root
  provider in `web/src/App.tsx` (or the shell), and
  `web/src/pages/VideoPlayerPage.tsx` for the cast integration and local
  pause. No server change: casting reuses the link mint API and `/s/`
  route from `add-expiring-file-links`.
- Tests: unit/component tests against a fake `cast.framework` /
  `chrome.cast` (no gstatic request), a Playwright test that injects a
  stub SDK, asserts the real mint request and `loadMedia` URL, and fetches
  that URL without cookies; a manual real-device checklist on the
  verification network (no TV in CI).
- Docs: **new ADR `docs/decisions/0011-chromecast-default-receiver.md`**
  plus the `docs/decisions/README.md` index; `docs/using-stratofold.md`
  (casting and its network/TLS limits), `docs/hosting.md` (HTTPS/public
  reachability, CORS/proxy buffering, access-log redaction for `/s/`),
  the SPA section of `docs/architecture.md`, and the `AGENTS.md` web-UI
  bullet.
- No breaking change; browsers without the SDK simply never see the
  action.

## Non-goals

- No custom Web Receiver app, no Cast registration, and no receiver-side
  code; the Default Media Receiver is used as-is.
- No AirPlay, no screen mirroring, and no casting of audio or images
  (only the video player gains the action in this change).
- No cast queueing, autoplay-next, subtitle/audio-track selection, or
  remote scrubber/timeline UI; the receiver and TV controls remain the
  playback UI, with the SPA offering stop.
- No transcoding or container remuxing; unsupported codecs/containers
  fail explicitly.
- No offline casting and no bundling of the Cast SDK; casting requires
  the Google-hosted SDK and a reachable media origin.
- No attempt to make the browser's native media-hub Cast work with the
  cookie-authenticated `/files` URL; the in-app Cast action is the
  supported path.
