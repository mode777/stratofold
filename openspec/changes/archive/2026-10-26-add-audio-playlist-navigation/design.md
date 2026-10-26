# Design

## Context

See proposal.md — Why. The player is a single-component view
(`web/src/pages/AudioPlayerPage.tsx`) that receives only `vdirId` and
`path` and streams one plain `/files` URL through a native `<audio>`
element. `PreviewPage` already fetches the containing directory's
listing once per directory (keyed by `dir`, not full path) to dispatch
by file kind, and passes that listing to `ImageViewerPage`, which derives
its gallery from it. The image gallery also establishes the
replace-navigation precedent: moving within the directory swaps the
path with `{ replace: true }` while the URL tracks the displayed image
and browser back returns to the browse listing. Listings arrive from
`POST /api/sf/vdirs/<id>/ls`, sorted server-side by name, and include
directories plus file entries with size/modtime.

## Goals / Non-Goals

**Goals:**

- Treat the opened file's containing folder as the playback queue without
  adding a request or endpoint.
- Make skip/auto-advance correct across listing order, wrap, paused vs
  playing, and browser autoplay refusal.
- Reuse the directory listing to pick cover art and preserve the
  existing failure/retry and public-vdir behavior.

**Non-Goals:**

- A global/persistent player, queue editing, or playback across app
  navigation (see proposal non-goals).
- Reading embedded artwork or sidecar metadata.
- Changing the audio streaming path, Range handling, or auth rules.

## Decisions

### D1 — Build the queue and cover in `AudioPlayerPage` from the listing `PreviewPage` already holds

`PreviewPage` passes its `listing` (and the current `entry`, matching the
gallery's contract) to the player. The player derives, in one `useMemo`:

- `queue`: non-directory entries whose `entryKind(name)` is `"audio"`, in
  listing order (the API's name order, which is also the browse order
  before the user applies their own client-side sort);
- `cover`: the first non-directory entry whose `entryKind(name)` is
  `"image"`.

If the opened path is missing from the queue (listing changed between
fetch and render), the player falls back to a single-entry queue built
from the `entry` prop so the stream still works.

Alternatives rejected:

- Fetching the directory inside the player — duplicates a request that
  already exists and breaks the gallery's "in-directory path changes
  resolve without a request" property.
- Adding a server playlist/cover endpoint — no new capability is needed;
  the listing already carries names and kinds, and a server pick would
  have to replicate the client's extension classification.

### D2 — Track changes are route changes with `replace: true`

Selecting another track navigates to
`previewUrl(vdirId, joinPath(dir, name))` with `{ replace: true }`, the
same mechanism the gallery uses. `PreviewPage`'s listing effect is keyed
by `dir`, so it does not refetch, resolves the new `entry` from the held
listing, and continues to pass the same listing. This keeps the player's
title/header, URL, stream, download link, and browser-back behavior
consistent with the gallery, and satisfies the "back returns to the
listing" scenario.

Alternative rejected: local-only index state without a route change —
would desynchronize the pushed header/URL and make browser back walk
through tracks or land on a stale file.

### D3 — Remount the `<audio>` element per track; carry intent through a ref

The element is keyed by the selected track path (plus the existing retry
`attempt` counter). A track change therefore gets a fresh decoder,
`currentTime = 0`, `duration = 0`, and a cleared failure state without
manual field resets. Navigation sets an `autoplayRef`:

- manual skip while playing → intent true;
- manual skip while paused → intent false;
- `onEnded` auto-advance → intent true;
- initial open → false (playback starts only on explicit action).

An effect after mount calls `el.play()` when intent is true. A rejected
promise (e.g. `NotAllowedError`) sets `playing` false and leaves the
track paused — never the stream-failure state, because the bytes were
fine. `onPlay`/`onPause` events remain the source of truth for the
control icon.

Alternatives rejected:

- Swapping `src` on a retained element — carries over buffered state,
  duration, and a wedged decoder after an error, and complicates the
  retry path.
- Setting the `autoplay` attribute — would bypass the "only on user
  action" rule for the initial open and cannot distinguish intent.

### D4 — Wrap in the player's index math, not in the listing

`nextIndex = (i + 1) % queue.length` and
`prevIndex = (i - 1 + queue.length) % queue.length`. With a single-track
folder, end-of-track therefore replays that track; this is the direct
consequence of the chosen wrap behavior and needs no special case.
Skip buttons are always enabled (both directions always resolve).

Alternative rejected: disabling next/previous at the ends — that was the
gallery's stop-at-ends model, but the requested behavior is a looping
folder queue.

### D5 — Cover art is a plain `<img>` with an error fallback

The cover renders as `<img src={filesUrl(vdirId, joinPath(dir, cover.name))}>`
with object-cover styling; `onError` flips a `coverFailed` flag that
restores the existing gradient/music-icon placeholder. No fetch→blob
indirection (the gallery uses it to distinguish request failures from
decode failures and offer retry) and no request at all when the folder
has no image. `alt=""` keeps it decorative; the track name remains the
accessible label. Because the URL is the plain `/files` URL, public-vdir
visitors get it under the same anonymous read rules.

Alternative rejected: blob/object-URL loading — adds revocation and
loading state for a surface with no retry UI, and a broken cover is
already handled by `onError`.

### D6 — Controls stay text-based, no new icon dependency

The transport row keeps the existing text ±15s buttons and adds "Prev"
and "Next" buttons with `aria-label="Skip previous"` / `"Skip next"` and
test ids `audio-prev` / `audio-next`. This matches the current text
controls and avoids shipping two new icon paths; the play button remains
the only filled circular control.

Alternative rejected: new skip-back/skip-forward SVG icons — visually
nicer but unnecessary for this scope and inconsistent with the text
±15s buttons beside them.

### D7 — Test at the layer that can observe the behavior

- Component tests (`AudioPlayerPage.test.tsx`, jsdom) cover queue
  derivation, next/prev and wrap, paused-vs-playing skip intent,
  `ended` → next + `play()` call, autoplay rejection → paused without
  failure, cover `<img>` URL and `onError` fallback, and per-track
  reset of URL/title/times/download.
- `BrowsePage.test.tsx` keeps asserting the player opens with the
  listing wired through.
- Browser E2E (`web/e2e/media.spec.ts`, verification server only) runs
  against a new seeded `album/` folder: two real 1-second WAVs and one
  PNG cover. It checks cover visibility, next/previous title changes,
  wrap, and end-of-track auto-advance (the 1-second WAV makes `ended`
  observable quickly). Real WAVs are needed because Chrome must decode
  them for `ended` to fire.

Alternative rejected: E2E against the existing single `song.wav` — it
cannot exercise a queue or auto-advance.

## Risks / Trade-offs

- **Browser autoplay policy blocks the auto-advanced track** → play()
  rejection is caught and rendered as a paused next track; the scenario
  is covered by a component test and the E2E watches for the next title
  with a timeout.
- **A single-track folder loops forever once played** → accepted as the
  literal wrap behavior; a later repeat-mode control can refine it.
- **Very short tracks auto-advance rapidly** → the queue is finite but
  wraps, so a folder of sub-second files can cycle quickly. Accepted for
  real music folders; no debounce is added because it would break the
  "reach the end → play next" contract.
- **First image in name order is not always intended artwork** (e.g. a
  screenshot sorts first) → matches the requested rule and needs no
  metadata guesswork; users can rename or move the image.
- **Queue is a snapshot of the listing fetched on open** → files added or
  removed remotely mid-playback are not reflected until the preview is
  reopened; the failure state still covers a vanished current track.
- **Listing order differs from a user's client-side sort** → the queue
  follows the API's name order, documented as listing order; changing it
  would require plumbing the browse sort into the preview route.

## Migration Plan

Client-only change shipped with the SPA assets: no data migration, no
server rollout, no rollback steps beyond reverting the web build. Public
and private vdirs keep their existing `/files` authorization.

## Open Questions

None.
