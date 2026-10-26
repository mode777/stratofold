# Tasks

## 1. Folder queue and track navigation

- [x] 1.1 Pass the containing directory's listing (and current entry) from `web/src/pages/PreviewPage.tsx` into `AudioPlayerPage`; verify `npm --prefix web run test -- AudioPlayerPage BrowsePage` still opens the player from tap and context menu.
- [x] 1.2 Derive the queue in `AudioPlayerPage` from non-directory audio entries in listing order, with the single-entry fallback when the opened path is absent; add component tests proving subdirectories, non-audio files, and entries from other folders are excluded.
- [x] 1.3 Add Skip previous / Skip next controls (`audio-prev` / `audio-next`, aria-labels "Skip previous" / "Skip next") that replace-navigate via `previewUrl` to the adjacent track with wrap at both ends; component tests cover order, both wrap directions, and the always-enabled state.
- [x] 1.4 Key the `<audio>` element by track path plus retry attempt and reset scrubber/timing/failure per track; component tests assert the URL, title, elapsed/remaining, scrubber, and download target all switch with the track.
- [x] 1.5 Preserve play/pause intent on manual skip (paused stays paused, playing keeps playing) and confirm browser back/dismiss returns to the folder listing; component tests cover both intent cases and the browse-route fallback.
- [x] 1.6 Run `npm --prefix web run test -- AudioPlayerPage BrowsePage` and confirm the new queue/navigation cases pass alongside the existing control, scrub, failure, and download tests.

## 2. Automatic advance at end of track

- [x] 2.1 Advance on the audio element's `ended` event to the next queue entry (wrapping from last to first) and start it through a post-mount `play()` intent; component tests fire `ended` and assert the next title plus a `play()` call, including last-to-first wrap.
- [x] 2.2 Handle a rejected automatic `play()` (autoplay policy) by leaving the new track paused without a failure state; component test asserts no failure state and the Play control remains available.
- [x] 2.3 Verify a single-track folder wraps to itself on `ended` and that manual skip still does not auto-play when it was paused; component tests cover both cases.
- [x] 2.4 Run `npm --prefix web run test -- AudioPlayerPage` and confirm the auto-advance, wrap, and refusal cases pass with the existing stream-failure and retry tests.

## 3. Folder cover art

- [x] 3.1 Select the first non-directory image entry in listing order as the cover and render it in the player's artwork slot with an empty `alt`; component test asserts the `/files` cover URL for a folder with an image.
- [x] 3.2 Fall back to the existing gradient/music-icon placeholder when the folder has no image and when the cover's `onError` fires, without surfacing a stream failure; component tests cover both and assert no image request for an image-less folder.
- [x] 3.3 Verify public-mode playback is unaffected by cover art (the cover uses the same plain `/files` URL) and that the download action still targets the selected track; component tests cover the selected-track download target.
- [x] 3.4 Run `npm --prefix web run test -- AudioPlayerPage` and confirm cover selection, fallback, and the existing placeholder behaviour all pass.

## 4. Documentation

- [x] 4.1 Update the Audio bullet in `docs/using-stratofold.md` (Previews) to describe skip next/previous, automatic advance with wrap, and folder cover art; verify against the delta spec `specs/web-ui/spec.md` for missing or contradicted behavior.
- [x] 4.2 Update the web-UI bullet in `AGENTS.md` with one sentence covering the folder queue, auto-advance/wrap, and first-image cover art; verify the section still points at the `web-ui` spec and `AudioPlayerPage.tsx` rather than restating their details.
- [x] 4.3 Confirm no ADR is required (client-only player behavior over existing `/files` and listing APIs) and note that in the change if the decision changes during implementation.

## 5. Browser E2E fixture and integration verification

- [x] 5.1 Seed an `album/` folder in `internal/e2eharness/harness.go` with two real 1-second WAV tracks, one decodable PNG cover, and a non-audio file; verify `go test ./internal/e2eharness/` (or `go vet ./...`) compiles the fixture.
- [x] 5.2 Extend `web/e2e/media.spec.ts` to open the first album track, assert the cover is visible, skip next/previous with wrap, and let a track play to `ended` to observe the automatic advance; verify on the build/verification server with `npm --prefix web run e2e -- media.spec.ts`.
- [x] 5.3 Run `npm --prefix web run test` (full component suite), `npm --prefix web run build`, and `go vet ./... && go test ./...`; confirm all pass locally.
- [x] 5.4 Run `npx openspec validate --all --strict` and confirm the change and its delta spec validate without errors.
