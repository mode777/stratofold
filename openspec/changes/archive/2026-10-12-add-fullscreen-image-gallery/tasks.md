# Tasks

## 1. Gallery plumbing (PreviewPage → viewer)

- [x] 1.1 Pass the pre-flight parent listing from `PreviewPage` into `ImageViewerPage`; derive the gallery list (listing order, `entryKind === "image"`) and the opened entry's position in `ImageViewerPage`; verify with a component test that a mixed directory yields only image entries in order and the opened image is current (`npm --prefix web run test`)
- [x] 1.2 Guard `PreviewPage`'s pre-flight `ls` effect so an in-directory path change (swipe replace-navigation) does not refetch the listing while a vdir change still does; verify by asserting fetch/`ls` call counts across a simulated path change in the component tests (`npm --prefix web run test`)

## 2. Immersive presentation and chrome

- [x] 2.1 Rebuild `ImageViewerPage` as the `fixed inset-0` dark overlay (design D5) that owns the full viewport — image loaded through the existing fetch → blob → object-URL pattern, `touch-action: none`/`user-select: none`/`overscroll-behavior` applied — and keep the per-slide state machine (loading spinner, retryable fetch failure, decode → `MetadataCard`); port the existing `ImageViewerPage.test.tsx` cases (render/download, decode fallback, retry) to the new surface (`npm --prefix web run test`)
- [x] 2.2 Add the overlay chrome — back (navigates to the browse listing), file name, gallery position, download link — shown above the image, hidden and re-shown by tapping the image, with Escape as an additional back trigger on desktop; component-test chrome visibility toggling, back navigation, the position indicator, and that download keeps the plain `/files` href (`npm --prefix web run test`)

## 3. Zoom and pan

- [x] 3.1 Add the pure gesture-math module (pointer state → `translate/scale`, fit-to-screen base, scale clamp [1, 4], pan clamped to scaled bounds, double-tap step to 2.5 at the tap point) and unit-test its math directly (pinch in/out, clamp at bounds and max zoom, reset) (`npm --prefix web run test`)
- [x] 3.2 Wire the module into the viewer with Pointer Events + `setPointerCapture` (pinch = two pointers, pan while zoomed, double-tap zoom step, transform reset on image change — spec: fit-to-screen on change); component-test zoom-state reset across an image change and that a drag while zoomed pans instead of paging (`npm --prefix web run test`)

## 4. Swipe cycling and keyboard paging

- [x] 4.1 Implement fit-zoom swipe paging over the gallery list: intent threshold, next/prev image slides in, rubber-band and spring-back at the ends (no wrap), no paging while zoomed; component-test swipe to next/prev, stop-at-ends, and the single-image directory (`npm --prefix web run test`)
- [x] 4.2 On swipe settle, navigate to the new image's preview URL with `{ replace: true }` so the URL tracks the displayed image and browser back lands on the browse listing; component-test the URL update and the resulting back location (`npm --prefix web run test`)
- [x] 4.3 Add left/right arrow-key paging for pointer-capable devices (ignored while composing in inputs — none exist in the overlay, so a plain keydown handler suffices); component-test that arrows page and respect the ends (`npm --prefix web run test`)

## 5. Docs, E2E, and validation

- [x] 5.1 Update the AGENTS.md web-UI bullet: the image viewer is now the fullscreen gallery (zoom/pan, swipe cycling in listing order, stop-at-ends, route-follows-swipe, dismissible chrome) and `web/src/pages/ImageViewerPage.tsx` is the gallery surface; verify the section reads accurately against the built app
- [x] 5.2 Extend `web/e2e/` with a gallery spec on the seeded dataset (open an image from browse → fullscreen; double-tap zoom; swipe/arrow to the next image; back returns to browse) — seed an image entry in `internal/e2eharness` if none exists — and run the E2E suite on the build/verification server only (`npm --prefix web run e2e`; the dev container cannot launch the browser)
- [x] 5.3 Full local gate: `npm --prefix web run test` (all suites), `npm --prefix web run build`, `go test ./internal/e2eharness/` if the fixture changed, and `npx openspec validate add-fullscreen-image-gallery --strict`; note the archive-ordering constraint — archive `add-audio-player-image-viewer` (specs synced) before archiving this change
