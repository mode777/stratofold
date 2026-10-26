# Tasks

## 1. Entry wiring and routing

- [x] 1.1 Remove the video `<a target="_blank">` branches from `PrimaryTarget` and the grid tile in `web/src/components/EntryViews.tsx` so every non-directory entry uses the `onPreview` path; verify updated `BrowsePage.test.tsx` coverage shows a video tap and grid tile navigating to `/v/<id>/view/...` and opening no new tab.
- [x] 1.2 Change the video context menu in `web/src/components/ContextMenu.tsx` to offer **Open** (the player, through the existing `onPreview` callback) plus the separate **Open in new tab** action at the plain `/files` URL; verify `ContextMenu.test.tsx` asserts both actions and their targets.
- [x] 1.3 Add the video branch to `web/src/pages/PreviewPage.tsx` (`kind === "video"` → `VideoPlayerPage`, passing the held entry and listing) while keeping audio, image, and metadata dispatch; verify `PreviewPage`/`BrowsePage` tests for each kind and for the video back navigation.

## 2. Video player

- [x] 2.1 Implement `web/src/pages/VideoPlayerPage.tsx` around a native `<video playsInline preload="metadata">` streaming the plain `filesUrl`, paused on open, with play/pause, a scrubber with elapsed/remaining time, volume/mute, fullscreen (including the iOS `webkitEnterFullscreen` fallback), download, and the preview screen's back control; verify component tests (with stubbed media methods/properties) for the source URL, paused start, and each control.
- [x] 2.2 Add the stream failure state (element `error` → retryable `FailureState`, retry re-creates the source and resets the state) and confirm the public-mode path streams anonymously through the public `/files` URL; verify the failure/retry and public-mode component tests.
- [x] 2.3 Update `docs/using-stratofold.md` (Previews → video), the SPA section of `docs/architecture.md` (video no longer a new tab), and the `AGENTS.md` web-UI bullet; verify the `README.md` "in-app previews for audio, images, and video" claim is now accurate and the documented controls match the player.

## 3. Content type consistency

- [x] 3.1 Add `.m4v` → `video/mp4` and `.ogv` → `video/ogg` to `internal/fileserver/headers.go` and verify the mime-table test covers both while existing entries and the unknown-extension default stay unchanged.

## 4. Integration verification

- [x] 4.1 Run `npm --prefix web run test` and confirm the new player plus the updated browse/menu suites pass.
- [x] 4.2 Run `go vet ./... && go test ./...` (with `~/.local/go/bin` prepended) and confirm the mime change and existing suites pass.
- [x] 4.3 Update `web/e2e/media.spec.ts` and `web/e2e/browsing.spec.ts` from the new-tab assertion to the in-app player, keeping the Range/seek request assertion, and run them on the build/verification server (the dev container cannot launch the headless browser).
- [x] 4.4 Run `npx openspec validate --all --strict` and confirm the change validates.
