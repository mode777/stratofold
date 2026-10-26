# Design

## Context

See `proposal.md` — Why. The relevant current state:

- `entryKind` already classifies `mp4`/`webm`/`ogv`/`mov`/`m4v` as
  `video`, but every video affordance renders an `<a target="_blank">` at
  `filesUrl(vdirId, path)`: the list `PrimaryTarget`, the grid tile, and
  the context menu (which shows "Open in new tab" *instead of* Open for
  video). Audio and image entries already route through `onPreview` to
  `/v/:vdirId/view/*`.
- `PreviewPage` owns the shared pre-flight directory lookup, the
  header/back control, public-mode failure mapping, and the kind
  dispatch: audio → `AudioPlayerPage`, image → `ImageViewerPage`, everything
  else → `MetadataCard`. Video currently never reaches it.
- `AudioPlayerPage` is the template for an in-app media player: native
  `<audio>`, plain `/files` URL, paused start, element-driven time/seek,
  failure state with retry, and the show's iOS control language.
- The web-ui spec currently has two requirements that pin video to a new
  tab (the media requirement and the preview-screen caveat); both are
  replaced by this change's delta.

## Goals / Non-Goals

**Goals:**

- One video playback surface inside the SPA, on the existing preview
  route, with a paused start and the same cookie-based `/files` stream.
- Entry affordances consistent with audio: tap/grid/Open lead in-app; a
  separate action still opens the raw file in a new tab.
- A component that is testable without real media playback and is the
  natural mount point for a Cast button in the next change.

**Non-Goals:**

- No Cast, queue, captions, transcoding, or playback-position
  persistence; those are separate changes or explicit non-goals.
- No new server route or auth path; `/files` is unchanged except for two
  mime-table entries.

## Decisions

**D1 — Reuse `/v/:vdirId/view/*` and add a video branch to `PreviewPage`,
rather than a new `/watch` route or a modal.** The preview route already
provides the containing-directory lookup, the shared header/back control,
public-mode failure handling, and the browser history behavior the other
players rely on. A separate route would duplicate all of it. Alternatives:
(a) a new `/v/:id/watch/*` route — rejected, a second preview surface with
the same pre-flight; (b) a modal over the listing — rejected, it loses
deep-linking and back behavior and diverges from audio/images.

**D2 — Build a custom `VideoPlayerPage` around a native `<video>` element
with custom transport controls.** This mirrors `AudioPlayerPage` and gives
the Cast change a stable place for a session indicator and button. The
native `controls` attribute was rejected: it cannot match the iOS shell,
is hard to assert in component tests, and would sit alongside the app's
own header/back chrome inconsistently. A third-party player was rejected
as a new dependency for no required capability.

**D3 — Local playback keeps the plain, cookie-authenticated `/files` URL;
no token.** The server already serves Range and conditional requests, and
the browser's cookie is the right credential for an in-app stream. A
temporary link here would leak a bearer token into browser history and
referrers for no benefit; links are for the receiver in the Cast change.
This preserves the existing "no auth token in the in-app URL" invariant.

**D4 — Playback starts paused.** Consistent with the audio player and
with browser autoplay policy (a sound-bearing autoplay would be blocked
anyway). The user's explicit play is also the gesture that makes
fullscreen and later casting predictable.

**D5 — Entry wiring: tap/grid/Open call the existing `onPreview`; the
context menu gains an Open row for video and keeps a distinct
open-in-new-tab row.** `PrimaryTarget` and the grid tile currently branch
on `kind === "video"` to render an anchor; the branch is removed so the
standard button/`onPreview` path handles every non-directory entry. In the
menu, video gets the same Open row as other files (satisfying the existing
"Open for every entry" contract) plus the existing raw tab action, now
labelled clearly. Removing the new-tab action was rejected because the
native player is still useful for unsupported containers and debugging.

**D6 — Player mechanics use the element as the source of truth.** A
native `<video playsInline preload="metadata">` streams `filesUrl`; the
component listens to `loadedmetadata`, `timeupdate`, `play`, `pause`,
`volumechange`, and `error`, and drives the scrubber, elapsed/remaining
time, mute, and fullscreen from those events. Play/pause call
`play()`/`pause()`; seeking sets `currentTime`; retry bumps a key/attempt
counter that re-creates the source and resets the failure state. Fullscreen
uses the standard Fullscreen API with the iOS
`webkitEnterFullscreen` fallback on the element. Component tests stub the
media methods/properties because jsdom implements no media pipeline.
Alternatives: a state machine library — unnecessary for one element; a
timer-driven clock — rejected, it drifts from the element and breaks
seeking.

**D7 — Add `.m4v` → `video/mp4` and `.ogv` → `video/ogg` to the file
server's mime table.** `entryKind` already treats both as video, but the
table currently returns `application/octet-stream`. This keeps the served
`Content-Type` truthful and gives the later Cast change a consistent
content type, without changing any requirement (the table is explicitly
"built-in and deterministic", with examples rather than a closed set).
Alternatives: map them client-side only — rejected, the server header
would stay wrong for every consumer.

**D8 — Failure and public behavior reuse existing surfaces.** A
pre-flight listing failure stays `PreviewPage`'s concern (normal failure
or public not-available state). A stream/decoder error inside the player
renders the standard retryable `FailureState` with a retry action.
Public-mode video needs no special path: the plain `/files` URL is
already anonymously readable on a public vdir.

**D9 — Controls are buttons with labels and keyboard behavior.** Every
control is a `<button>` (or the native video element for focus) with an
accessible name; the scrubber is a range input; focus order follows the
player's reading order. This matches the existing mobile-first/keyboard
requirement without adding a new accessibility mechanism.

## Risks / Trade-offs

- **jsdom has no media playback** → component tests stub
  `HTMLMediaElement` methods and properties and assert control wiring, not
  decoding; real playback/seek is covered by E2E on the build server.
- **Unsupported containers** (MOV/OGV on some browsers) → the element's
  `error` event surfaces the retryable failure state; no transcoding is
  attempted.
- **iOS fullscreen differences** → use `webkitEnterFullscreen` when the
  standard API is absent; document the manual mobile check.
- **Custom controls lose native affordances** (keyboard shortcuts,
  captions menu) → accepted for the iOS design language; the raw file
  remains one tap away via open-in-new-tab for the native player.
- **Large-file seeking** → relies on the existing `/files` Range and
  reconnect behavior; the E2E range assertion guards the regression.
- **Route-level regression for video taps** → existing BrowsePage tests
  that assert a new tab are updated to assert in-app navigation, and the
  E2E browsing/media specs are updated in the same change.

## Migration Plan

None — frontend behavior plus two mime-table entries; no data, config, or
API migration. Rollback reverts the SPA and mime table.

## Open Questions

None.
