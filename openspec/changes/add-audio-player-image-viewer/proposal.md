# Proposal

## Why

Tapping an audio file ejects the user into a bare browser tab with the
native player, and tapping an image shows only a metadata card with a
Download button — the two most common personal-cloud file types have no
in-app experience, which undercuts the Drive-like feel the vision
commits to. The iOS design reference (`design/design-showcase.html`,
screens S6_AUDIO / S6B / S5) already prescribes the player and
Quick-Look screens to build against.

## What Changes

- Audio files open an **in-app audio player** — dark immersive screen
  per S6_AUDIO: artwork tile, file name, scrubber with elapsed/remaining
  time, play/pause, ±15s skip, dismiss back to the listing. Playback
  streams the file's plain `/files/<vdir-id>/<virtual-path>` URL through
  the native `<audio>` element (cookie-authenticated, HTTP Range for
  seeking) — no token in the URL, nothing buffered host-side beyond the
  existing file-server behavior.
- Image files open an **in-app image viewer** — Quick-Look-style screen
  that renders the image itself (centered, light canvas) instead of the
  current metadata-only card; metadata and Download remain below.
- **Download is preserved everywhere**: the context menu keeps its
  Download action for every file, and the player and viewer each expose
  an explicit Download action using the same `/files` URL.
- Video and other non-audio media keep the current behavior: new-tab
  native playback through the `/files` URL.
- File-kind classification (audio / image / video / other) is
  centralized in one helper; today it is split between
  `filesApi.isMediaName` and the `entryVisual` regexes, which disagree
  (e.g. `flac`/`aac`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-ui`: the "media opens in a new tab" requirement is narrowed to
  video/other media; audio instead opens the in-app player (same
  `/files` URL, Range-served). A new requirement covers the in-app image
  viewer, and the download requirement extends to cover download actions
  inside the player and viewer.

## Impact

- SPA only (`web/src/`): view-route branching (`PreviewPage` becomes a
  type-dispatching view), new audio-player and image-viewer components,
  primary-tap targets in `EntryViews`, context-menu wording, shared
  kind-classification helper in `lib/`. No server, API, or dependency
  changes — `/files` already serves Range and MIME correctly.
- Verification: `npm --prefix web run test` (component tests gate
  locally); optional E2E extension runs on the verification server only.

## ADR

No ADR — no stack or cross-cutting invariant changes; the reversal of
the "media always opens in a new tab" policy is recorded in the `web-ui`
spec delta itself.

## Non-goals

- Video: keeps new-tab native playback (no in-app video player).
- Audio playlists/queue, next/previous-track buttons, artwork or tag
  metadata extraction (player shows the file name on a static tile).
- Image zoom, pinch, rotation, or swipe-between-images gallery.
- Background/lock-screen playback and media-session integration; there
  is deliberately no service worker (ADR 0009), so no offline caching.
- Any `/files` or filesystem-API server change.

## Assumptions

- Playback starts only on an explicit user action (no autoplay).
- Image formats the browser cannot decode (e.g. HEIC, DNG — both
  currently classified as images) fall back to the metadata card with
  Download rather than a broken frame.
