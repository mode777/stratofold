# Proposal: add-fullscreen-image-gallery

## Why

The in-app image viewer (roadmap change 7) renders a small, contained
frame above a metadata line — nothing like the native iOS photo
experience the SPA's shell targets (ADR 0008). Browsing a folder of
photos means opening each image one at a time, and zoom/pan is left to
the browser's built-in image handling, which only appears in a raw
`/files` tab. The viewer should behave like the iOS Photos browser:
open fullscreen, zoom and pan with fingers, and swipe between the
folder's images.

## What Changes

- Tapping an image entry (list row, grid cell, or context-menu open)
  opens the in-app image viewer as a **fullscreen gallery view** —
  dark, edge-to-edge, immersive — replacing today's card-style layout
  (small frame + metadata line + download button).
- In the fullscreen view the user can **zoom** (pinch and double-tap)
  and **pan** while zoomed, with rubber-banding at the edges and
  reset-on-dismiss semantics like the native iOS photo browser.
- **Swiping horizontally** moves to the previous/next image of the
  same directory in listing order; navigation **stops at the ends**
  (no wrap-around). The gallery covers only image-kind entries;
  non-image entries and subdirectories are skipped.
- The route follows the swipe (`/v/:vdirId/view/<path>` tracks the
  image on screen), so deep links stay exact and back always returns
  to the browse listing.
- Minimal overlay chrome (back, file name, position, download) that
  can be hidden and re-shown by tapping the image; the keyboard's
  arrow keys page through images on desktop (`md+`).
- Failure handling stays per-image: a fetch failure shows the
  retryable failure state for that slide, and an undecodable image
  (HEIC, DNG) falls back to the metadata card with download — a bad
  slide never breaks the gallery.
- Everything works for the **anonymous public-vdir visitor** exactly
  as for signed-in users (public browse requirement unchanged).

Assumptions (recorded, not user-confirmed beyond the entry point and
end-of-gallery behavior, which were asked):

- Gallery order = the containing directory's listing order
  (`ls` result filtered to image-kind entries) — the browse view's
  client-side sort is not carried into the viewer.
- The card-style viewer screen is fully replaced; name, size, and
  modified time stay reachable in the overlay chrome / metadata
  fallback rather than shown persistently.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-ui`: the requirement **Image entries open the in-app image
  viewer** (added by the open change `add-audio-player-image-viewer`,
  to be synced into `openspec/specs/web-ui/` on its archive) is
  reshaped into the fullscreen gallery requirement: fullscreen entry
  from browse, zoom/pan, swipe cycling over the folder's images,
  route-follows-swipe, dismissible chrome, and per-slide failure and
  decode fallbacks. The media-new-tab, audio-player, public-browsing,
  and error-state requirements are untouched.

## Impact

- `web/src/pages/ImageViewerPage.tsx` — rebuilt as the fullscreen
  gallery (image cache window, gesture handling, chrome) plus its
  component tests (`web/src/pages/ImageViewerPage.test.tsx`).
- `web/src/pages/PreviewPage.tsx` — hands the parent listing it
  already fetches to the viewer so the gallery can enumerate sibling
  images without a second `ls`.
- `web/src/lib/` — a small gesture utility (pointer-event pinch/pan/
  swipe; dependency choice, if any, is a design decision).
- No server/API changes: images stream from the plain `/files` URLs
  as today (cookie-authenticated, no token in the URL); the sibling
  enumeration reuses the existing `ls` endpoint.
- Docs: the AGENTS.md web-UI bullet describing the image viewer needs
  updating; E2E additions (`web/e2e/`) gate on the build/verification
  server as usual.
- No ADR — this is UI behavior within the settled stack (React SPA on
  the existing API surface); no durable, stack-shaping decision is
  introduced.

## Non-goals

- No image thumbnails in the browse list/grid (icons stay).
- No server-side image resizing/transcoding; full-size bytes only.
- No video or audio in the swipe gallery (video keeps the new-tab
  native player; audio keeps the in-app player).
- No wrap-around looping at the gallery ends, no slideshow/auto-
  advance, no image editing or annotations.
- No offline caching or service-worker changes.
- No changes to download, sharing, or public-browsing semantics.
