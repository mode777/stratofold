# 0011 — Chromecast via the Web Sender SDK and the Default Media Receiver

Status: Accepted (2026-10, change `add-chromecast-playback`)

## Context

The in-app video player (`add-video-player`) can play a file through the
browser, but a TV is a separate device: the Chromecast receiver fetches
the media URL itself, on its own network, with no `sf_session` cookie. The
expiring-link primitive (`add-expiring-file-links`, ADR 0010) supplies a
session-free URL for one file. The remaining choice is how the SPA talks
to the device, and how much receiver code the project owns. The change
record is `openspec/changes/add-chromecast-playback/`.

## Decision

Chromecast support uses the **official Cast Web Sender SDK** with the
**Default Media Receiver**:

- The SDK (`https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1`)
  is loaded **lazily when a video player opens**, never app-wide. A
  pre-installed `cast.framework` (tests/stubs) short-circuits the load.
- The SPA connects with
  `chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID` (`CC1AD845`); no
  custom receiver app is registered, hosted, or maintained.
- A root `CastProvider` owns the session, device name, and remote-player
  events, so a cast survives route changes; a shell-level indicator names
  the device and offers the in-app stop (`endSession(true)`).
- Casting is session-first: connect, then resolve the media URL. A
  signed-in user mints a fresh 24-hour `/s/<token>` link (ADR 0010); an
  anonymous public visitor passes the plain absolute `/files` URL. The
  local `<video>` never carries the token.
- The load request supplies the extension-derived content type
  (`video/mp4`, `video/webm`, …) and the file name as the media title.
  Local playback pauses while the TV owns the stream.
- The Cast action is **absent** when the SDK is unavailable (Safari,
  Firefox, iOS Chrome, an insecure context, or a blocked script). Every
  failure (cancelled picker/no device, failed link mint, receiver load or
  decode failure) is explicit and leaves local playback usable.

## Consequences

- Casting requires a secure context (HTTPS, or localhost), a Chromium
  browser, the Google-hosted script (internet access), and a media origin
  the receiver can reach with a certificate it trusts. A self-hosted
  instance on an internal CA or an unreachable LAN name cannot cast;
  `docs/hosting.md` carries the operational limits.
- The Default Media Receiver's format set is what it is: MP4/WebM and a
  codec subset; MOV/OGV and some MP4 codecs fail at load time with an
  explicit error. The project does not transcode.
- The receiver holds a bearer link for its lifetime (24 hours unless the
  session ends first). Revocation follows the link rules (creator access
  or expiry), not the Cast session.
- The Cast session is origin-scoped, not account-scoped: it can outlive a
  logout on the same browser. The indicator remains available to stop it.
- No timeline synchronization or remote control UI is built; the receiver
  and TV remote are the playback UI, plus the SPA's stop action.
- The browser's own media-hub Cast of a `<video>` remains unsupported for
  non-public vdirs, because it passes the cookie-protected `/files` URL;
  the in-app Cast button is the supported path.

## Rejected alternatives

- **A custom Web Receiver app** — registration, hosting, and a receiver
  UI for no capability the default receiver lacks at this stage.
- **The Remote Playback API** — less control over session and metadata,
  uncertain desktop Chromium behavior, and it still needs a session-free
  media URL.
- **Screen mirroring** — no metadata, lower quality, and it does not let
  the TV play independently.
- **The browser's native media-hub Cast** — it hands the receiver the
  local cookie-protected `/files` src, which fails on non-public vdirs.
- **Making the vdir public to cast** — exposes the whole tree instead of
  the selected file (the same rejection as ADR 0010).
- **Bundling the SDK instead of loading it from Google** — the SDK is
  distributed as an auto-updated hosted script; bundling would age it and
  is not a supported distribution path.
