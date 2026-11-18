# Design

## Context

The browse view (`web/src/pages/BrowsePage.tsx`) owns the listing, sorting,
role derivation, mutations, and overlays; `web/src/components/EntryViews.tsx`
renders the virtualized list and grid with a long-press/ellipsis context
menu; `web/src/pages/MovePickerPage.tsx` is the pushed destination picker;
and `web/src/components/FileOpsDialogs.tsx` holds the single-entry New
Folder, Rename, and Delete overlays. Each mutation goes through one
`POST /api/sf/vdirs/{id}/{mkdir,mv,rm}` call in `web/src/lib/filesApi.ts`.
The server decides access before dialing, applies each operation
complete-or-nothing, and retries it across connection drops
(`filesystem-api` spec). There is no batch endpoint and no client-side
retry.

The web UI is an iOS-style mobile shell (ADR 0008) with a compact toolbar
that is required to hold only view controls, writer actions in the folder
header, a fixed mobile tab bar, and an upload indicator that can float over
the bottom of the screen. These constraints shape where selection controls
live.

## Goals / Non-Goals

**Goals:**

- A writer-only selection mode in list and grid views with explicit entry
  and exit, per-entry toggles, select all/none, and a selection bar.
- Bulk move through the existing destination picker and bulk delete through
  a confirmation that names the selection.
- A framework-free bulk executor over the existing per-item endpoints with
  bounded concurrency, progress, and per-item outcomes.
- Continue past item failures, refresh the listing, and report failures in
  a dismissible notice without auto-retry.

**Non-Goals:**

- No new server endpoint, batch job, durable operation record, or API spec
  change.
- No bulk download, ZIP download, rename, extraction, sharing, or
  cross-vdir operation.
- No cross-directory selection, selection persistence, undo, or a
  configurable concurrency/cancellation surface.

## Decisions

### D1: An explicit Select action, not long-press-to-select

The folder header gains a **Select** control next to New and Upload for
writers. Entering selection mode is deliberate; outside it, long-press,
right-click, and the ellipsis keep opening the single-entry context menu
unchanged.

Rejected:

- **Long-press enters selection (Drive mobile behavior).** It would take
  over the existing gesture that the `web-ui` spec requires to open the
  context menu, and would make Open/Download/link actions harder to reach.
- **Always-visible checkboxes.** It changes the default listing for every
  user, including viewers and public visitors who have no bulk action, and
  clutters the compact mobile rows.

### D2: Selection is a set of virtual paths owned by the browse page

`BrowsePage` holds `selected: Set<string>` of virtual paths and derives the
selected entries by zipping the sorted listing with its joined paths.
Selection is cleared when the virtual path changes, pruned when a reload no
longer lists a selected path, and preserved across sort changes and
list/grid switches. Names are unique within a directory, but paths are used
as keys to survive re-sorting and to build mutation targets.

Rejected:

- **Selecting by index.** Sorting reorders indices and would silently
  change the selection.
- **Holding full `LsEntry` objects.** They go stale after a reload and add
  a second source of truth beside the listing.

### D3: EntryViews takes selection props instead of gaining a second renderer

`EntryList` and `EntryGrid` accept `selectionMode`, `selected`, and
`onToggle`. In selection mode a row/cell becomes a toggle target with a real
checkbox named `Select <entry>`, the ellipsis button is not rendered, and
the long-press handler is not attached; tapping a directory toggles instead
of navigating, and tapping a file toggles instead of previewing. Checkboxes
remain keyboard operable with Space, so selection does not depend on a
pointer.

Rejected:

- **An overlay capture layer over the listing.** It would intercept
  scrolling and virtualization and still need per-row accessibility.
- **Keeping the menus active in selection mode.** A single-entry action
  while several entries are selected is ambiguous and contradicts the
  selection-bar actions.

### D4: An inline selection bar replaces the header actions

While selection mode is active, the header action row becomes the selection
bar: first row with the selected count, **Select all** / **Deselect all**
(toggling label), and **Done**; second row with **Move** and **Delete**.
Move and Delete are disabled with an empty selection; every control is
disabled while a delete runs, and the count line doubles as the progress
label (`Deleting 3 of 7…`). The compact toolbar stays view-controls-only,
and the bar scrolls with the header so it never competes with the fixed tab
bar or the floating upload indicator.

Rejected:

- **A fixed bottom action bar.** It would overlap the tab bar and upload
  indicator on mobile and require duplicated safe-area handling.
- **A modal selection sheet.** It would hide the listing the user is
  selecting from.

### D5: A framework-free bulk executor over the existing per-item endpoints

`web/src/lib/bulkOps.ts` exports `bulkMove(vdirId, items, destDir, options)`
and `bulkDelete(vdirId, items, options)`. Each item maps to one existing
`mv` or `rm` call. The executor runs at most four requests at a time,
preserves input order in the returned outcomes, calls
`onProgress(processed, total)` after each settle, and never throws for an
item failure: an outcome is `{ path, name, failure?: ApiFailure }`.

Requests continue after `403`, `404`, `503`, and other failures so the rest
of the selection applies. A `401` stops scheduling new items, because the
session is gone and the existing unauthorized interceptor routes to login;
already-issued requests finish. There is no client-side retry of a failed
item — the filesystem API's own retry budget already ran — so a `503`
outcome is reported as temporarily unavailable and the user can reselect.

Rejected:

- **A server-side batch endpoint.** It would add a new request/response
  contract, partial-result format, retry semantics, and job model for no
  behavioral gain; the existing per-item API already guarantees atomicity,
  idempotency, authz, and version bookkeeping.
- **Unbounded `Promise.allSettled`.** It floods the server and the
  browser's connection pool for large selections.
- **Strictly sequential execution.** It is needlessly slow when the
  server already multiplexes concurrent operations over one SFTP channel.

### D6: Bulk move reuses the picker and returns a result through navigation state

`BrowsePage` navigates to `/v/:vdirId/move` with
`{ entries: Array<{ entry: LsEntry; path: string }>, sourceDir: string }`.
The context-menu Move passes a one-item array, so there is one state shape.
`MovePickerPage` keeps its existing single-entry path (`mv` + `FailureState`)
and adds a multi-entry path: title `Move N items`, destination validation,
and a bulk execution that disables **Move Here** and **Back** while running,
shows `Moving N of M…` progress in the footer, and returns to `sourceDir`
with `{ bulkResult }` in location state when any item failed. `BrowsePage`
consumes that state once, shows the notice, and replaces the history entry
with a state-free navigation so a reload or back does not replay it.

Destination validation disables **Move Here** when the destination is empty,
equals the source directory, or equals/contains any selected directory
(`dest === dir || dest.startsWith(dir + "/")`). Manual paths are normalized
with a small pure helper (fold `.`/`..`, reject a path that escapes the
root) before that comparison and before building targets, so `docs/../docs`
cannot bypass the rule and `../docs` is refused rather than silently
reinterpreted. The vdir sandbox still decides every path; the client check
is a UX guard, not a security boundary.

Rejected:

- **Executing bulk moves in `BrowsePage`.** The picker already owns
  destination selection and validation, and moving execution back would
  require a second navigation handoff for every move.
- **Making the single-entry move use the bulk path.** It would replace the
  established inline `FailureState` with a batch notice for a one-item
  failure, changing existing behavior for no gain.

### D7: Bulk delete confirms in an alert, then runs from the selection bar

`FileOpsDialogs.tsx` gains a `BulkDeleteAlert` that reuses the existing
`Alert`: it names the entry count, warns that selected folders lose their
contents, and has Cancel/Delete actions. Confirming closes the alert and
starts the executor in `BrowsePage`, so the selection bar is visible and can
show progress and disabled controls. Running the batch inside the alert
would hide progress and keep a modal up during a potentially long operation.

Rejected:

- **Reusing `DeleteAlert` with a synthetic entry.** Its copy and
  single-entry contract do not describe a selection.
- **Deleting without confirmation.** Existing behavior requires a
  destructive confirmation, and a selection can include non-empty folders.

### D8: One dismissible result notice, summarized and bounded

`BrowsePage` renders a `BulkResultNotice` (`role="alert"`,
`data-testid="bulk-result"`) after a batch with failures. It reports the
successful count and the number of failures, names up to five failed entries
as `name (error class)`, and adds `and N more` for the rest. Dismissing it
leaves the applied changes and the failed entries untouched. The notice maps
`ApiFailure.kind` to the same vocabulary as `FailureState`
(`not found`, `permission denied`, `temporarily unavailable`, `rejected`,
`server error`); it does not parse or duplicate server prose.

Rejected:

- **One toast per failed entry.** A long selection would produce a storm of
  messages and could cover the listing.
- **A blocking failure dialog.** The user must be able to read the result
  and keep working; failures are not fatal to the batch.

### D9: Progress, duplicate prevention, and lifecycle

`BrowsePage` guards a delete batch with both state (`bulkRunning`) and a ref
so a double tap cannot start two batches; the executor is invoked once, the
selection bar shows `Deleting N of M…` while its controls are disabled, and
completion refreshes the listing, exits selection mode, clears the
selection, and shows the notice if there were failures. `MovePickerPage`
does the same for a move in its footer, with Move Here and Back disabled
until the batch settles, then navigates back to the source directory.
`BrowsePage` fetches the fresh listing on return and renders the notice from
the returned `bulkResult`. The executor is a plain promise with no abort
signal: navigating away does not cancel already-issued requests or the
remaining concurrency window, but progress callbacks are ignored after
unmount and the operation is not shown as a background activity. Returning
to the directory simply fetches the current state. Per-item atomicity means
an interrupted batch leaves each attempted item whole; the batch itself is
not a transaction.

Rejected:

- **An upload-queue-like background manager.** It would add persistence,
  global UI, and lifecycle semantics for an operation that is expected to
  finish in seconds and whose partial result is already observable in the
  listing.
- **Attempting to cancel in-flight `mv`/`rm` calls.** The operations are
  not cancellable server-side and canceling between items would only make
  the partial result less predictable.

### D10: No server, API, client-library, or ADR change

The filesystem API, `/files`, `/s`, bearer tokens, and `@stratofold/client`
are untouched. Bulk actions are a SPA composition of existing per-item
operations, so the durable per-operation invariants stay where they are
(`filesystem-api` spec, ADR 0015 for versions). No new ADR is needed; this
design record is enough for a UI-level composition choice.

## Risks / Trade-offs

- **Large selections produce many requests.** A select-all over 10,000
  entries starts 10,000 `rm` calls. Concurrency four keeps pressure
  predictable, but the batch can take a long time and a closed tab can
  leave it partially applied. → Each item is atomic and idempotent, progress
  is explicit, and the result notice names failures; a future server-side
  job can replace the fan-out without changing the UI contract.
- **Per-item `503`s are not retried by the client.** A flaky connection can
  produce a long failure list even though the server retried each request. →
  Report each as temporarily unavailable with no retry storm; the user can
  reselect failed entries after reconnecting.
- **No cancellation.** The user cannot stop a batch midway. → Actions are
  disabled and progress is visible; navigating away stops new work only
  after the current concurrency window, and the listing always reflects what
  actually applied.
- **Destination validation is lexical.** The client comparison normalizes
  `.`/`..` but is not a security boundary. → The vdir sandbox still decides
  every path; the client rule is only to prevent obviously invalid moves
  before dialing.
- **Stale selection after an external change.** A path may vanish between
  selection and execution. → The failed item is reported as not found while
  the rest proceeds, and stale paths are pruned on listing reload.
- **Checkbox interaction inside virtualized rows.** Selection must not
  break windowing or consume the row's open action. → Rows use path keys,
  selection props are primitives, and the selection renderer keeps the same
  virtualizer structure.

## Migration Plan

No data or API migration. The change ships with the SPA and is reachable
only through the new header control; rolling back the SPA restores the
previous one-entry-at-a-time behavior with no server state to clean up.
Existing single-entry move, delete, rename, upload, extraction, and
context-menu flows remain in place.
