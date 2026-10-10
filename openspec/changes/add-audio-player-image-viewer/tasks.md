# Tasks

## 1. Kind classification

- [x] 1.1 Add `web/src/lib/entryKind.ts` exporting `entryKind(name)` → `dir | audio | image | video | other` per design D2 (audio: mp3/wav/m4a/ogg/weba/flac/aac; image: jpg/jpeg/png/gif/webp/heic/bmp/svg/dng; video: mp4/webm/ogv/mov/m4v) with unit tests covering each set plus edge cases (uppercase extensions, `ogv` vs `ogg`, no extension); verify with `npm --prefix web run test -- entryKind`
- [x] 1.2 Migrate `filesApi.isMediaName` call sites (`EntryViews`, `ContextMenu`) and `entryVisual` to `entryKind`, removing `isMediaName`; verify no references remain (`rg isMediaName web/src` is empty) and existing suites pass (`npm --prefix web run test`)

## 2. Routing and entry points

- [x] 2.1 Turn `PreviewPage` into the kind dispatcher per design D1: audio → `AudioPlayerPage`, image → `ImageViewerPage`, else the existing metadata card (extract the card into its own component); verify with updated `PreviewPage`/routing tests that each kind renders its page at `/v/:vdirId/view/*`
- [x] 2.2 In `EntryViews` (list row + grid cell), route audio taps through the view route (`open-preview` path) instead of the new-tab anchor; video keeps the `/files` anchor; verify via `BrowsePage` tests that tapping an audio entry navigates in-app and a video entry keeps `target="_blank"`
- [x] 2.3 In `ContextMenu`, make the open action use the in-app player/viewer for audio and image (relabel the new-tab item to video files only) and keep Download for every file; verify with `ContextMenu` tests (audio → player navigation, video → new tab, download present for all)

## 3. Audio player page

- [x] 3.1 Build `AudioPlayerPage` per design D3 and showcase S6_AUDIO: hidden `<audio preload="metadata" src={filesUrl(...)}>`, artwork tile, file name, play/pause (starts paused), ±15s skip, scrubber with elapsed/remaining time, dismiss back; component tests driving the audio element via mocked timeupdate/loadedmetadata/durationchange events; verify with `npm --prefix web run test -- AudioPlayer`
- [x] 3.2 Add the in-page Download action (plain `/files` URL + `download`) and the failure state: element `error` and pre-flight `ls` failures render `FailureState` with retry that re-issues the source (design D6); verify with tests simulating stream error then successful retry

## 4. Image viewer page

- [x] 4.1 Build `ImageViewerPage` per design D5 and showcase S6B: centered `<img src={filesUrl(...)}>`, client-derived name/size/modified, Download action, `onError` (decode failure) falls back to the metadata card, request failure renders `FailureState` with retry; verify with `npm --prefix web run test -- ImageViewer`

## 5. Docs and verification

- [x] 5.1 Update the AGENTS.md web-UI bullet (routes/preview line) to name the in-app audio player and image viewer under `/v/:vdirId/view/*` and the download surfaces (context menu + in-player/in-viewer); verify the section reads accurately against the built app
- [x] 5.2 Run the full local gate: `npm --prefix web run build` and `npm --prefix web run test`; verify both pass and `web/dist` rebuilds for embedding
- [x] 5.3 Extend the browser E2E suite (verification server only) with a media spec in `web/e2e/` using the harness's seeded media file: tapping an audio entry opens the player and an image entry renders inline, download actions fetch the file; run via `npm --prefix web run e2e` on the build/verification server
- [x] 5.4 Run `npx openspec validate --all --strict` and confirm the change is valid before archive
