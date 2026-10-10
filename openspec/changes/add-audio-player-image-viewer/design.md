# Design

## Context

Today the SPA's tap behavior branches on `filesApi.isMediaName`
(mp4/webm/ogv/ogg/mp3/wav/m4a/mov/weba → `<a target="_blank">` to the
plain `/files` URL in `EntryViews`/`ContextMenu`); everything else
pushes `/v/:vdirId/view/*` → `PreviewPage`, a metadata card whose only
content action is Download. Display-side, `entryVisual.tsx` keeps its
own AUDIO/IMAGE regexes that disagree with `isMediaName` (`flac`/`aac`
are audio icons but not "media"). The file server already serves
`/files` with Range (`206`), conditional requests, and MIME detection,
and clears stream deadlines, so in-app players need no server work.
The visual target is `design/design-showcase.html`: S6_AUDIO (dark
player), S6B (Quick Look), S5 (context menu with Open-in-Player +
Download).

## Goals / Non-Goals

**Goals:**

- Zero new runtime dependencies; native `<audio>`/`<img>` only.
- One source of truth for file-kind classification.
- Player/viewer stay ordinary SPA routes: deep-linkable, browser-back
  correct, and automatically covered by the public-vdir auth carve-out
  for `/v/<vdir-id>/…` routes.
- Every control keyboard-operable (they are plain buttons/inputs).

**Non-Goals:** as in proposal.md (no video player, no playlists, no
zoom/gallery, no media-session/background playback, no server changes).

## Decisions

### D1. One view route, branched by kind

`/v/:vdirId/view/*` stays the single pushed route;
`PreviewPage` becomes a thin dispatcher: audio → `AudioPlayerPage`,
image → `ImageViewerPage`, else → the existing metadata card.
*Rejected*: dedicated `/v/:id/audio/*` and `/v/:id/image/*` routes —
more URL surface to keep aligned with the auth rule ("a public vdir's
browse **and preview** routes are reachable anonymously"), no
behavioral gain; the branch keeps public-vdir semantics for audio and
images by construction.

### D2. Centralized kind classification

`lib/entryKind.ts` exports `entryKind(name): "dir" | "audio" |
"image" | "video" | "other"`; `filesApi.isMediaName` is replaced by it
at both call sites and `entryVisual` consumes it. Sets: audio =
mp3/wav/m4a/ogg/weba/flac/aac; image = jpg/jpeg/png/gif/webp/heic/bmp/
svg/dng; video = mp4/webm/ogv/mov/m4v (i.e. the old media set minus
audio). `video` is what still opens a new tab. *Rejected*: extending
`isMediaName` in place — it would leave two divergent classifications,
which is exactly the `flac` bug this change fixes.

### D3. Player is a native `<audio>` element with custom controls

`AudioPlayerPage` renders a hidden `<audio src={filesUrl(...)}
preload="metadata">` plus custom transport UI per S6_AUDIO (artwork
tile with MusicIcon, name, scrubber, elapsed/remaining, play/pause,
±15s, dismiss). Range support in the file server makes scrubbing work
without any client-side download logic. Playback starts paused (D7 of
the iOS-UI change: no surprise audio; also sidesteps autoplay policy).
*Rejected*: `howler`/`react-player` — a new dependency for what the
native element already does, and bundle weight against the PWA budget.

### D4. Download actions reuse the plain `/files` URL

The Download button in player and viewer is
`<a href={filesUrl(vdirId, path)} download>` — byte-identical
transport and authorization to the context menu's Download. No blob
fetching, no duplicate auth path.

### D5. Undecodable images fall back by detection, not extension

`ImageViewerPage` fetches the file's `/files` URL with the session
cookie (`sfFetch`), shows the blob through an object URL in `<img>`,
and an `<img>` error switches to the existing metadata card (which
keeps Download). Splitting the load this way keeps the two failure
classes the spec distinguishes observable: fetch failures are request
failures (retryable failure state, D6), while an `<img>` error means
the bytes arrived but could not be decoded. *Rejected*: a raw
`<img src={filesUrl(...)}>` — its single coarse `error` event cannot
distinguish request failure from decode failure. *Rejected*: an
extension whitelist for "renderable" types — browser codec support
differs (Safari renders HEIC, Chrome does not), so trying and falling
back beats a per-browser list that would disable Safari's native HEIC
support.

### D6. Failure states are explicit, retried by re-issuing the source

Media-element errors are coarse (one `error` event, no status code).
On error (or `404` from the pre-flight `ls` lookup the preview pages
already do) both pages render the standard `FailureState` with retry;
retry re-sets the element `src` (cache-busted only if needed). A 401 on
the element's own fetch cannot route through the `sfFetch`
interceptor; the failure state covers it (retry keeps failing until
the user navigates, whereupon the session interceptor takes over) —
accepted rather than adding a fetch/proxy layer around the element.

### D7. Pushed routes, not overlays

Player and viewer are pushed routes reached by tap and by the context
menu's open action; browser back and the pages' dismiss/back actions
return to the listing, matching the existing Quick Look pattern and
making playback state survivable only as long as the route lives (no
global audio singleton — navigating away stops playback, accepted for
this change).

## Risks / Trade-offs

- [Large image files are fetched whole by `<img>`] → unavoidable for
  inline rendering; huge RAW files usually fail decode and hit the D5
  fallback, where Download remains the escape hatch.
- [Media-element error gives no HTTP status] → single failure state
  with retry; `/files` resumes in-place across SSH reconnects, so a
  transient drop is recoverable by retry without losing position
  beyond the buffered window.
- [Navigation stops playback] → no global audio service in this
  change; if in-app browsing-while-listening is wanted later it is an
  additive mini-player on top of the same route/element.
- [ogg ambiguity (Vorbis audio vs OGV video)] → resolved by extension
  sets in D2; `ogg` plays as audio, `ogv` as video new-tab.

## Migration Plan

SPA-only change; ship in the normal build (`web:build` embeds via
`internal/webassets`). No data, API, or config migration. Rollback =
revert the commit.

## Open Questions

None.
