# Proposal

## Why

The in-app audio player opens one file at a time. Listening to an album or
a folder of tracks therefore means going back to the listing between every
song, and the player shows only a generic music icon even when the folder
holds artwork. A folder is already the natural album boundary in the app;
the player should treat it as one.

## What Changes

- The player gains **Skip previous** and **Skip next** controls that move
  through every audio entry of the file's containing folder, in the same
  listing order the browse view shows (server name order, directories
  excluded). Navigation wraps: next on the last track goes to the first,
  previous on the first goes to the last.
- When playback reaches the end of a track, the player **automatically
  advances** to the next track in that folder and starts playing it, so a
  folder plays through as a queue. Advancing manually keeps the current
  play/pause state; only end-of-track playback auto-plays.
- The player shows the **first image entry in the folder** (listing order)
  as cover art in place of the placeholder icon. If the folder has no image,
  or the image cannot be loaded, the existing gradient/music-icon
  placeholder remains. No metadata/ID3 artwork is read.
- While a track plays, the player's title, URL, scrubber, timing, download
  action, and stream follow the track now selected; browser back still
  returns to the browse listing rather than walking through tracks.
- The existing public-vdir and failure-state behavior is unchanged: an
  anonymous visitor gets the same queue and cover art through the public
  `/files` URLs.

Assumptions (recorded, not blocking): the queue is the opened file's own
directory (never recursive); the player's previous control always moves to
the previous track rather than restarting the current one; a cover-art load
failure is silent (placeholder, no retry UI); selecting a track keeps the
player on the pushed preview route, replacing history entries.

## Capabilities

### New Capabilities

None — the behavior extends an existing capability.

### Modified Capabilities

- `web-ui`: the "Audio entries open the in-app audio player" requirement
  gains skip next/previous, folder-queue auto-advance with wrap, and
  folder-derived cover art.

## Impact

- Code: `web/src/pages/AudioPlayerPage.tsx` (queue, wrap, auto-advance,
  cover art, track-scoped controls), `web/src/pages/PreviewPage.tsx` (pass
  the folder listing to the player), `web/src/lib/listing.ts` only if a
  shared queue/cover helper earns its keep, and `web/src/components/icons.tsx`
  if skip icons are added (text ±15s controls already exist).
- Tests: `web/src/pages/AudioPlayerPage.test.tsx` (next/previous, wrap,
  ended → auto-advance + play, cover pick/fallback, per-track URL and
  state reset), `web/src/pages/BrowsePage.test.tsx` (player still opens from
  tap/context menu), and `web/e2e/media.spec.ts` plus a small seeded album
  in `internal/e2eharness/harness.go` (multiple decodable tracks and one
  image) for browser E2E on the verification server.
- Docs: `docs/using-stratofold.md` (Previews → Audio bullet) and the
  `web-ui` spec; `AGENTS.md`'s web-UI bullet gains the queue/cover-art
  sentence. `README.md` and `docs/hosting.md` need no change.
- **No ADR** — this is client-side player behavior over the existing
  `/files` streaming and listing APIs. It settles no stack, storage, or
  security decision; no new endpoint or protocol is introduced.

## Non-goals

- No server or API changes; the queue is built from the existing directory
  listing and tracks keep streaming through plain `/files` URLs.
- No recursive/album-wide queues across subfolders, no user-editable queue,
  no drag-to-reorder, no shuffle, and no separate repeat mode (wrap-around
  is the only looping behavior).
- No reading embedded ID3/FLAC artwork or sidecar metadata; cover art is
  purely the first image entry in the folder.
- No persistence of the queue or playback position across navigation,
  reloads, or signed-out sessions.
- No new route; skip navigation stays inside `/v/:vdirId/view/*`.
