# Tasks

## 1. Bulk executor

- [x] 1.1 Add `web/src/lib/bulkOps.ts` with `bulkMove(vdirId, items, destDir, options)` and `bulkDelete(vdirId, items, options)`: at most four in-flight `mv`/`rm` calls through `filesApi`, outcomes in input order, `onProgress(processed, total)` after each settle, per-item `ApiFailure` capture instead of throwing, continued scheduling after non-`401` failures, and a stop on `unauthorized`; verify `web/src/lib/bulkOps.test.ts` covers all-success, one-failure-continues, input-order results, the concurrency bound, progress callbacks, `503`/`403`/`404` outcomes, and the `401` stop.
- [x] 1.2 Add `normalizeVirtualPath` (fold `.`/`..` segments, return an invalid result when the path escapes the root) to `web/src/lib/listing.ts` for destination comparisons and target building; verify unit tests in `web/src/lib/listing.test.ts` cover plain paths, redundant slashes, `.`, `..` folding, and an escaping path being refused rather than clamped.

## 2. Selection mode in the browse view

- [x] 2.1 Extend `web/src/components/EntryViews.tsx` with `selectionMode`, `selected`, and `onToggle` props: render a named checkbox per row/tile, toggle on row/tile tap without opening or previewing, suppress the ellipsis button and long-press handler, keep checkbox Space/Enter operability, and preserve virtualization; verify `web/src/components/EntryViews.test.tsx` covers list and grid toggling, folders not navigating, menus absent, keyboard toggling, and selected-state rendering.
- [x] 2.2 Add selection state and lifecycle to `web/src/pages/BrowsePage.tsx`: the writer-only **Select** header control (`data-testid="select-button"`), a selection bar (`selection-bar`) with a live count (`selection-count`), Select all / Deselect all (`select-all-toggle`), Done (`selection-done`), Move (`bulk-move`), and Delete (`bulk-delete`), an empty selection disabling the actions, clearing on directory change, and pruning paths that disappear on reload while preserving selection across sorting and list/grid switches; verify `web/src/pages/BrowsePage.test.tsx` covers writer entry/exit, viewer and public gating, toggling via row and checkbox, select all/none, count updates, persistence across sort/view, and clearing on navigation.

## 3. Bulk delete and result reporting

- [x] 3.1 Add `web/src/components/BulkResultNotice.tsx` as a dismissible notice (`data-testid="bulk-result"`, `role="alert"`) with the success/failure counts, a bounded sample of failed names plus an "and N more" suffix, a failure-kind-to-label mapping matching `FailureState`, and a dismiss action; verify `web/src/components/BulkResultNotice.test.tsx` covers all-success (no notice), one failure, the bounded sample, dismissal, and the label mapping.
- [x] 3.2 Add `BulkDeleteAlert` to `web/src/components/FileOpsDialogs.tsx` naming the entry count and warning that selected folders lose their contents, and wire `BrowsePage` to run `bulkDelete` from the selection bar: confirmation closes before execution, the selection bar shows progress and disables its controls, a `bulkRunning` guard prevents a second batch, completion refreshes the listing and exits selection, and failures show the result notice; verify `web/src/pages/BrowsePage.test.tsx` covers cancel (no calls), confirm (one `rm` per entry), recursive folder deletion, partial failure with the successful entry gone and the failed one still listed, progress text, duplicate-activation prevention, and the all-success path.

## 4. Bulk move

- [x] 4.1 Extend `web/src/pages/MovePickerPage.tsx` to accept `{ entries, sourceDir }` navigation state, title the screen `Move N items`, run `bulkMove` for multiple entries while disabling **Move Here** and **Back** and showing `Moving N of M…` progress, preserve the existing single-entry `mv` + `FailureState` path, return to the source directory with `{ bulkResult }` when any item failed, and disable **Move Here** for an empty destination, the source directory, or a destination that equals or lies inside any selected directory using `normalizeVirtualPath`, including the manual-path mode; verify `web/src/pages/BrowsePage.test.tsx` covers a three-entry move issuing three `mv` calls, the count in the title, the disabled controls and progress while the batch is in flight, refusing the source directory, refusing a selected folder, refusing a descendant manually entered as `docs/../docs`, canceling with no calls, and the unchanged single-entry move.
- [x] 4.2 Pass the selected entries from `BrowsePage` to the move picker (a one-item array for the context-menu Move), consume the returned `bulkResult` once into `BulkResultNotice`, and replace the history entry with state-free navigation so reload/back does not replay the notice; verify `web/src/pages/BrowsePage.test.tsx` covers the context-menu path still moving one entry, the multi-entry move returning to the source listing, the partial-failure notice after the return, and the cleared navigation state.

## 5. Documentation

- [x] 5.1 Update `docs/using-stratofold.md` with the Select entry point, selection behavior, bulk move/delete, the destination rule, and partial-failure reporting; update the browse-route bullet in `docs/architecture.md` and the web-UI bullet in `AGENTS.md` to mention selection and bulk actions; verify every statement matches the `web-ui` delta scenarios and that the docs name no server-side batch endpoint.

## 6. Verification

- [x] 6.1 Add `web/e2e/bulk-actions.spec.ts` covering writer selection in list and grid, select all, a multi-entry move into `docs`, a multi-entry delete with confirmation, and a routed `404` on one item producing the result notice while the others apply; run it on the build/verification server with `npm --prefix web run e2e -- bulk-actions.spec.ts` (the local container cannot launch headless Chromium) and record the result in the change.
- [x] 6.2 Run `npm --prefix web run test` and `npm --prefix web run build` and confirm the new unit/component tests pass and the SPA typechecks and builds.
- [x] 6.3 Run `npx openspec validate --all --strict` and confirm the change and the modified `web-ui` spec validate.

## Verification log

- 2026-11-18 — `web/e2e/bulk-actions.spec.ts` on the build/verification server (harness at `127.0.0.1:8090`, Vite at `127.0.0.1:5173`, `SF_E2E_EXECUTABLE` set to the server's chrome-headless-shell): **2 passed** (6.3s).
- 2026-11-18 — `npm --prefix web run test`: **437 passed across 37 files**, including the new `bulkOps`, `listing`, `EntryViews`, `BulkResultNotice`, and BrowsePage selection/delete/move suites. The command still exits 1 because of a pre-existing unhandled Vitest error in `UploadPanel.test.tsx` (`job.target` undefined in `extractName`); it reproduces on that file alone and is unrelated to this change.
- 2026-11-18 — `npm --prefix web run build`: **passed** (`tsc --noEmit` + Vite production build).
- 2026-11-18 — `npx openspec validate --all --strict`: **18 passed, 0 failed**.

