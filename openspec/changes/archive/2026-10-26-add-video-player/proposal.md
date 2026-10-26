# Proposal

## Why

Video is the only media kind that still leaves the app: tapping a video
opens a raw `/files` URL in a new browser tab, while audio and images get
in-app players. Besides the inconsistent UX, the later casting change
needs a sender surface where a Cast button and its session state can
live; a bare file tab cannot host one. The README already advertises
in-app video previews, so the product is ahead of the implementation.

## What Changes

- Video entries, whether activated by tap, grid tile, or the context
  menu's Open action, SHALL open an in-app video player at
  `/v/<vdir-id>/view/<virtual-path>` instead of a new tab. The preview
  route's existing kind dispatch gains a video branch.
- The player streams the file's plain `/files/<vdir-id>/<virtual-path>`
  URL through a native `<video>` element — cookie-authenticated, no auth
  token in the URL — and starts paused until the user presses play.
- The player exposes play/pause, a position scrubber with elapsed and
  remaining time, volume/mute, fullscreen, and a download action, plus
  the preview screen's back control returning to the containing
  directory. Seeking issues Range requests against `/files`.
- The context menu keeps a separate **Open in new tab** action for video
  so the raw file remains reachable in the browser's native player.
- A stream failure (dropped connection, removed file, undecodable
  container) renders the existing retryable failure state with a retry
  action; an anonymous visitor on a public vdir gets the same player
  through the public `/files` URL.
- The file server's mime table gains `.m4v` (`video/mp4`) and `.ogv`
  (`video/ogg`) so the served `Content-Type` matches the set the SPA
  classifies as video.

Assumptions (recorded, not blocking): the player lives on the existing
preview route rather than a new one, so browser back and the shared
header/back behavior stay intact; the context menu's Open action leads
to the player while a distinct open-in-new-tab action remains; no
playlist, captions, or transcoding are introduced.

## Capabilities

### New Capabilities

None — this extends the existing SPA behavior.

### Modified Capabilities

- `web-ui`: the "media opens in a new tab" behavior is replaced by an
  in-app video player, the preview-screen requirement no longer excludes
  media from in-app views, and a new requirement pins the video player's
  URL, controls, failure state, and public-mode behavior.

## Impact

- Code: `web/src/pages/VideoPlayerPage.tsx` (new), `web/src/pages/PreviewPage.tsx`
  (video branch), `web/src/components/EntryViews.tsx` (video tap/grid target),
  `web/src/components/ContextMenu.tsx` (Open for video + keep
  open-in-new-tab), `web/src/components/icons.tsx` (player icons if
  missing), `web/src/pages/BrowsePage.tsx` only if the preview wiring
  needs it, and `internal/fileserver/headers.go` for the two mime
  entries.
- Tests: new `VideoPlayerPage.test.tsx`, updates to
  `ContextMenu.test.tsx` and `BrowsePage.test.tsx`, and the E2E media /
  browsing specs (new-tab assertion replaced by an in-app player + Range
  assertion) run on the build/verification server.
- Docs: `docs/using-stratofold.md` (Previews → video), the SPA section of
  `docs/architecture.md` (no longer "media opens in a new tab"),
  `AGENTS.md`'s web-UI bullet, and the `README.md` claim (already says
  in-app video previews; verify it stays accurate after the change).
  `docs/hosting.md` needs no change.
- **No ADR** — client behavior over the existing `/files` streaming
  API; no new stack, storage, or security decision.

## Non-goals

- No Casting; the cast button and its session belong to the later
  `add-chromecast-playback` change.
- No video playlist/queue, autoplay-next, shuffle, or resume position.
- No captions/subtitles, audio-track selection, playback-rate control,
  PiP, or transcoding; the browser plays the original bytes.
- No tokenized URL for local playback; the plain cookie-authenticated
  `/files` URL remains the in-app source.
- No change to which formats the browser can decode; unsupported
  containers surface the player's failure state.
