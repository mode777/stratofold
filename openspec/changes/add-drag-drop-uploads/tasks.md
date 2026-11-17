# Tasks

## 1. Queue: folder items, subdirectory targets, cascade

- [x] 1.1 Extend `UploadItem` with `kind: "upload" | "folder"` and add a path-carrying enqueue (the existing `enqueue` delegates to it); run folder items through an injected `mkdir` beside the injected upload and map failures through the existing retryable/permanent classes — verify `uploadQueue.test.ts` covers parents-complete-before-their-files (FIFO), empty folders, folder retry within the bound, and dedupe by full normalized target across both kinds
- [x] 1.2 Implement the cascade — a folder item's cancel/terminal failure moves its `queued`/`paused` dependents (target under `folder.path + "/"`) to canceled/failed with the folder's error via a `failedBy` marker, and `retry` on a failed folder item re-queues the folder plus its `failedBy` descendants — verify unit tests for fail-cascade, cancel-cascade, retry-restore, and an own-failure staying failed
- [x] 1.3 Add the `onSettled(listener)` seam mirroring `extractJobs` (fires when an item reaches a terminal state, unsubscribe cap) — verify a unit test observes completed/failed/canceled settles for both kinds

## 2. Drag payload traversal

- [x] 2.1 Create `web/src/lib/dragDrop.ts`: collect `webkitGetAsEntry()` entries synchronously from a `DataTransfer`, recurse directories with `readEntries` looped until a short batch, promisify `entry.file()`, keep the dropped folder's name as the root segment, record empty folders and enumeration failures, fall back to flat `dataTransfer.files` when no entries exist, no-op for file-less payloads — verify `dragDrop.test.ts` drives fake entry trees (nested, >100-entry paging reader, mixed file/folder drop, empty folder, unreadable folder, fallback, non-file drag) and asserts the resulting plan
- [x] 2.2 Add the minimal local type declarations for the entries API if the installed `lib.dom.d.ts` lacks them — verify `npm --prefix web run test` and the workspace type-check still pass

## 3. Uploads destination renders folder items

- [x] 3.1 Render folder items in `UploadPanel` with the shared lifecycle states, a folder-scoped label, cancel/retry controls, and no byte-progress bar — verify panel component tests cover a queued/running folder row, a failed folder with its error, and that uploads keep their progress rendering

## 4. Browse view drop zone and refresh

- [x] 4.1 Wire the listing container as a writer-gated drop zone: `dragenter`/`dragover` with `preventDefault()` + `dropEffect = "copy"` and an enter/leave counter for the highlight, `onDrop` feeding the traversal plan to the queue (folders first), no handlers mounted for viewers/anonymous public — verify `BrowsePage.test.tsx` covers file drop enqueued into the browsed directory, highlight on hover/leave, viewer and public-mode mounting no drop behavior, and no-op for file-less drags
- [x] 4.2 Surface traversal failures as a dismissible `role="alert"` notice naming the unreadable item while readable siblings still enqueue, and add the writer-only drop hint to the empty-directory state — verify component tests for the partial-failure notice, its dismissal, and the empty-state hint gating
- [x] 4.3 Subscribe `BrowsePage` to the queue's `onSettled` and bump the existing reload counter when a completed item targets the browsed directory (upload `dir` or folder parent) — verify component tests show a completed upload/folder appearing in the listing without a manual reload and no refresh for other directories

## 5. E2E and docs

- [x] 5.1 Add `web/e2e/drag-drop-uploads.spec.ts`: synthesized file drop uploads into the browsed directory with highlight and listing refresh, mixed multi-file drop, replace parity with the picker path, and no drop affordance in public browse — verify `npm --prefix web run e2e` passes on the build/verification server (directory-entry drags cannot be synthesized there and stay unit-gated per design D6)
- [x] 5.2 Update `docs/using-stratofold.md` (Uploads / browse sections) with drag & drop including folder drops and the notice behavior, and extend `AGENTS.md`'s file-management sentence — verify the cited facts match the new `upload-queue`/`web-ui` specs and `npx openspec validate --all --strict` passes
- [x] 5.3 Run the full local harness: `npm --prefix web run test` (queue, dragDrop, panel, browse suites) plus `npx openspec validate --all --strict` — verify both pass with no skipped new tests
