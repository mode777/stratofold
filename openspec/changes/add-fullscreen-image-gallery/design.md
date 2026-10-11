# Design — add-fullscreen-image-gallery

## Context

The image viewer (`web/src/pages/ImageViewerPage.tsx`) is dispatched by
`PreviewPage` (`web/src/pages/PreviewPage.tsx`) for entries classified
`image` by `web/src/lib/entryKind.ts`. `PreviewPage` already runs a
pre-flight `ls` of the containing directory to resolve the entry, so
the sibling image list is available without any new server call.
Images load through the fetch → blob → object-URL pattern (design D5
of `add-audio-player-image-viewer`) so fetch failures stay
distinguishable from decode failures and the cookie authenticates the
`/files` request. The web workspace's runtime dependencies are
deliberately small (react, react-router, pocketbase,
@tanstack/react-virtual). See proposal.md for motivation and the
`web-ui` delta for required behavior.

## Goals / Non-Goals

Goals: an iOS-Photos-like fullscreen gallery (zoom/pan/swipe) inside
the existing route and data-flow shape, with per-slide failure
isolation and bounded memory. Non-Goals: as in the proposal (no
thumbnails, no server resizing, no video/audio in the gallery, no
wrap-around, no offline caching) — plus no app-shell restructuring
(the immersive view must not require changes outside the preview
route's image branch) and no new runtime dependency unless a gesture
corner proves unhandleable (see D1).

## Decisions

### D1 — Hand-rolled pointer-event gestures, no gallery/zoom library

Implement pinch, pan, swipe, and double-tap as a small gesture
utility over Pointer Events (`pointerdown/move/up/cancel`,
`setPointerCapture`), plus keyboard arrows for paging. Rationale: the
gesture vocabulary needed here is exactly four moves, and owning them
keeps the swipe/pan/chrome-tap arbitration coherent (a library gives
zoom+pan but not our swipe-cycling + dismissible-chrome interplay).
Rejected: `react-zoom-pan-pinch` or a lightbox library — extra runtime
dependency, styling fight with the iOS look, and swipe-cycling would
still be hand-built beside it; rejected a `touchstart/move`-based
implementation — Pointer Events already unify mouse/touch/pen in
every supported browser and keep desktop testing tractable. Gesture
math (pointer state → transform) lives in a pure module so jsdom
component tests can drive it without layout.

### D2 — Gallery enumeration reuses the pre-flight listing

`PreviewPage` passes the parent listing it already fetched to
`ImageViewerPage`, which filters it to `entryKind === "image"` and
positions the opened entry within it; no second `ls`. Ordering is the
listing order (proposal assumption). Rejected: fetching the listing
inside the viewer — duplicates the pre-flight request and adds a
loading state the preview screen already owns. The gallery list is
built once from the listing that contained the opened entry; later
listing changes do not reshuffle an open gallery (refresh re-anchors).

### D3 — Windowed image cache (current ± 1)

Each slide materializes through the existing fetch → blob →
object-URL pattern; only the current image and one neighbor on each
side are materialized, and object URLs outside the window are revoked.
Full-size photos are megabytes; prefetching a whole folder would blow
memory on mobile. Per-slide state machine: loading → loaded |
fetch-failed (retryable, retry re-fetches that slide) | decode-failed
(metadata card) — a broken slide never affects its neighbors.
Rejected: `<img src="/files/...">` direct URLs — simpler, but loses
the fetch-vs-decode distinction the spec requires (D5 of the prior
change) and gives no cache window control.

### D4 — Swipe replaces the URL; zoomed state does not swipe

On swipe settle, navigate to the new image's preview URL with
`{ replace: true }`: the URL always names the displayed image (deep
links exact), history stays one entry deep, and browser back returns
to the browse listing from any gallery position. Push-per-image was
rejected (back would walk through every viewed image — unlike iOS);
not touching the URL was rejected (refresh/deep-link would snap back
to the originally opened image). Guard: the pre-flight `ls` effect
must not re-run on an in-directory path change (the entry is already
resolved from the held listing). Swipe arbitration: horizontal drag
with intent threshold only at fit-to-screen zoom; while zoomed, drag
pans (clamped) and the user zooms out first to continue paging —
native Photos' edge-handoff-while-zoomed is polish we skip. Swipe at
the ends rubber-bands and springs back (no wrap, per the asked
behavior).

### D5 — Immersive presentation as an in-route overlay

`ImageViewerPage` renders a `fixed inset-0` dark overlay (owning the
full viewport, covering the header and mobile tab bar) inside the
existing route; the route and dispatch in `PreviewPage` are otherwise
unchanged. Chrome (back, name, position, download) floats above the
image and toggles on image tap. Rejected: an app-shell "chrome-less
layout" mode keyed off the route — more moving parts across `App.tsx`
and the shell for no behavioral gain. Escape and the chrome back both
navigate back on desktop.

### D6 — Zoom via transform, clamped

The image sits in an overflow-hidden container and is moved with
`transform: translate(x, y) scale(z)`; scale is clamped to
[1, 4] with double-tap stepping to 2.5 centered on the tap point; pan
is clamped to the scaled image bounds; image change resets to
fit-to-screen (spec). `touch-action: none` on the container plus
`preventDefault` keeps the browser's own page-zoom/gestures out of
the way; viewport meta stays untouched.

## Risks / Trade-offs

- [jsdom cannot reproduce real gesture/layout behavior] → gesture
  math is a pure, unit-tested module; component tests drive taps and
  synthetic pointer sequences; true pinch/swipe feel gates in the
  browser E2E suite on the build/verification server (`web/e2e/`), as
  usual for this repo.
- [Full-size images cost memory and decode time on swipe] → D3's
  ±1 window bounds resident blobs; neighbor prefetch keeps swipes
  warm. Very large images may still decode slowly — accepted (no
  server resizing in scope).
- [Archive ordering: the MODIFIED target "Image entries open the
  in-app image viewer" lives in the complete-but-unarchived
  `add-audio-player-image-viewer` delta] → that change must be
  archived (specs synced) before this change's archive; openspec
  validate already flags it, and tasks.md carries an explicit
  ordering note.
- [iOS Safari gesture quirks (double-tap page zoom, long-press
  callout, overscroll)] → `touch-action: none`, `user-select: none`,
  and `overscroll-behavior` on the overlay; verified in E2E on a real
  browser (SwiftShader/Chrome on the verification server approximates;
  residual iOS-only risk accepted and noted for manual QA).

## Migration Plan

Pure client-side change behind the existing route; no data, API, or
server migration. Rollback = revert the SPA build. The only ordering
constraint is the archive dependency noted above.

## Open Questions

None — remaining choices (exact zoom clamp values, animation
curves) are polish decided during apply without touching specs or
task structure.
