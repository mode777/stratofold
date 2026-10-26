# Design

## Context

See `proposal.md` — Why. The pieces this design builds on and the
external constraints:

- `add-video-player` adds `VideoPlayerPage` on `/v/:vdirId/view/*`, a
  native `<video>` streaming the plain cookie-authenticated `/files`
  URL, paused start, transport controls, and a retryable failure state.
- `add-expiring-file-links` adds `POST /api/sf/vdirs/<id>/links`
  (session-authenticated, any reader) returning a relative
  `/s/<token>` URL with a 24-hour expiry, and a session-free `/s/` route
  with Range, conditional, reconnect, `no-store`, and CORS behavior.
- `useSession` exposes `checking` / `anonymous` / `authenticated`;
  public-mode browsing is always anonymous. The video player is only
  reachable for a non-public vdir when signed in.
- Google's Web Sender guidance: the SDK is a single script from
  `https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1`,
  initialized through `window.__onGCastApiAvailable` and
  `CastContext.setOptions({receiverApplicationId:
  chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID})`; media loads with
  `chrome.cast.media.MediaInfo(contentId, contentType)` and
  `LoadRequest`; playback/session events come from `CastSession`,
  `RemotePlayer`, and `RemotePlayerController`. Sender pages require
  HTTPS, and casting is unsupported in iOS Chrome (and non-Chromium
  browsers).
- The Default Media Receiver supports MP4/WebM and a limited codec set;
  MOV/OGV (and codec mismatches inside MP4) can be rejected at load time.
  Google calls out CORS as a common media-playback failure; the `/s/`
  route from the link change supplies it.

## Goals / Non-Goals

**Goals:**

- A cast flow that never exposes the session cookie to the receiver and
  never puts a token in the local player.
- Session state that outlives the player route, with an in-app stop.
- A testable integration (fake SDK) plus a real-device checklist, since
  no TV exists in CI.

**Non-Goals:**

- No custom receiver, queueing, track selection, or remote timeline
  synchronization; no device-codec capability probing beyond the load
  result.

## Decisions

**D1 — Use the official Cast Web Sender SDK with the Default Media
Receiver.** The receiver app id is
`chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID`, so no receiver
registration or hosted receiver code is needed. Alternatives: (a) the
Remote Playback API — rejected, uncertain desktop Chrome behavior, no
explicit session/metadata control, and it still needs a session-free
URL; (b) a custom receiver — rejected, registration, hosting, and a whole
receiver UI for no required capability; (c) screen mirroring — rejected,
no metadata, worse quality, no independent TV playback; (d) relying on the
browser's media-hub cast — rejected, it passes the local `<video>` src
(cookie-protected) to the receiver, which fails on non-public vdirs.

**D2 — Load the SDK lazily for the video player, not app-wide.** A
module-level loader injects the gstatic script once, resolves on
`__onGCastApiAvailable(true)`, and short-circuits when `cast.framework`
already exists so component/E2E stubs never touch the network. Other
screens make no third-party request. Alternatives: (a) eager app-wide
load — rejected, a Google request for every view and a PWA cost;
(b) bundling the SDK — rejected, it is distributed as a hosted,
auto-updated script.

**D3 — A root `CastProvider` owns the Cast context, session, and remote
player; the player and a shell-level indicator consume it.** The provider
subscribes to `SESSION_STATE_CHANGED` and `IS_CONNECTED_CHANGED`, exposes
`{available, deviceName, casting, cast(), stop(), failure}`, and survives
route changes. The indicator is what makes casting stoppable after
leaving the player. Alternatives: (a) player-local state — rejected, the
session would be unreachable after navigation; (b) no indicator —
rejected, the only in-app stop would be on the player screen.

**D4 — Session first, then resolve the media URL, then `loadMedia`.**
Ordering avoids minting a link when the picker is cancelled. URL
selection: `useSession().state === "authenticated"` → mint a link
(including on a public vdir, where it is harmless and avoids plumbing
vdir publicness into the preview route); `anonymous` (only possible in
public mode) → the plain absolute `/files` URL. The local `<video>` src
is never changed. Alternatives: (a) always mint — impossible for an
anonymous visitor; (b) fetch the vdir record in the player to avoid
minting on public vdirs — rejected as extra plumbing for a negligible
row; (c) a short-lived cookie relay for the receiver — rejected,
complexity and no benefit over a bearer URL.

**D5 — The load request carries a client-side content type and the file
name as title.** `videoContentType(name)` maps `mp4`/`m4v` to
`video/mp4`, `webm` to `video/webm`, `mov` to `video/quicktime`, and
`ogv` to `video/ogg`; `MediaInfo(url, contentType)` plus
`GenericMediaMetadata.title` feed the receiver. There are no thumbnails
(no thumbnail endpoint) and no `currentTime` transfer in v1. Alternatives:
(a) omit the content type — rejected, the receiver needs it to pick a
player; (b) derive it from a mint response — rejected, public/anonymous
casts have no mint response and the extension map is tiny.

**D6 — Local playback pauses; the receiver is the playback UI.** On a
successful load the local element is paused and the player shows "Playing
on <device>" with stop; the provider calls `session.endSession(true)` on
stop. No timeline mirroring or remote scrubber is built. Alternatives:
(a) mirrored controls via `RemotePlayerController` — deferred, the TV
remote/receiver already controls playback; (b) keep local playback
running — rejected, two audio sources.

**D7 — Every failure path is explicit and leaves local playback usable.**
SDK load failure or unsupported environment → no action at all;
`requestSession` cancellation/no devices → "No cast device" state;
mint failure → retryable failure with the existing retry pattern (the
session may stay connected for a fast retry); `loadMedia` rejection →
explicit "cannot be played on this device" (container/codec or
unreachable). Success is claimed only after `loadMedia` resolves.
Alternatives: silent failure — rejected, indistinguishable from a broken
button; disabling the action — rejected, the absence pattern is already
used for install prompts.

**D8 — Security boundary: the token is only in the receiver's media URL.**
The link is minted at cast start, expires in 24 hours, and is revoked by
losing the creator's access; the local player keeps the cookie URL.
The browser's native media-hub Cast remains unsupported for non-public
vdirs and is documented as such. Alternatives: put the token in the local
src too — rejected, browser history/referrer exposure with no gain.

**D9 — Verification uses a fake SDK for automation and a manual checklist
for the device.** Component tests predefine `cast.framework` /
`chrome.cast` and assert session/load behavior; Playwright injects a stub
SDK with `addInitScript`, performs a real mint against the harness, and
fetches the resulting `/s/<token>` URL without cookies. A manual device
checklist (private MP4, public MP4, seek, pause past the idle TTL, stop,
navigate away) runs on the verification network because no TV is
available in CI.

## Risks / Trade-offs

- **HTTPS/public-CA trust and reachability** → the sender requires a
  secure context, and the receiver must reach the media origin and trust
  its certificate; documented in `docs/hosting.md`, verified manually.
- **CORS/range/container failures on the receiver** → the `/s/` route
  provides CORS and Range; unsupported containers surface an explicit
  error; device testing decides whether to hide MOV/OGV later.
- **Chrome-only feature** (no iOS Chrome/Safari/Firefox) → the action is
  absent where unsupported; AirPlay is a separate non-goal.
- **Third-party SDK availability/privacy** → loaded lazily and only on
  video playback; offline/self-hosted-only deployments lose casting.
- **Token handed to the TV** → 24h expiry, hash-at-rest, revocation via
  access loss, and `no-store`; the token never enters the SPA URL.
- **Expiry mid-playback** → a fresh link per cast; 24h far exceeds normal
  sessions; accepted.
- **Idle SSH TTL while a cast is paused** → the next receiver Range
  request reconnects through the existing manager; a long pause may
  surface a receiver error, accepted.
- **No real-device automation** → the manual checklist is the gate;
  automated tests only prove the wiring and URL.
- **Session outlives logout** (origin-scoped cast session) → the link is
  independent of the session by design; the indicator remains until
  stopped or the device ends it.

## Migration Plan

Frontend-only plus docs and the ADR. No data or API change; casting
depends on the link and player changes being present. Rollback removes
the Cast action/provider; existing links expire on their own.

## Open Questions

None — device-specific format gating and remote-control UI are
deliberately deferred.
