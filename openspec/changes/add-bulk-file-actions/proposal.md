# Proposal

## Why

Stratofold's browse view handles one entry at a time: moving or deleting a
folder full of files means repeating the same context-menu flow for every
item. A Drive-like file manager is expected to let a user select several
entries and act on them together, especially when reorganizing or cleaning
up a directory. The single-entry write path, the move picker, the delete
confirmation, and the per-item atomic filesystem API are all in place, so
bulk move and delete can be added now as a UI composition of operations the
server already supports.

## What Changes

- Writers (owner or `editor` share) get an explicit **Select** action in the
  browse folder header. Viewers and anonymous public visitors never see it,
  because selection in this change only leads to write actions.
- Selection mode works in both list and grid views: checkboxes appear on
  entries, tapping an entry toggles it instead of opening it, per-entry
  ellipsis/long-press menus are suspended, and a selection bar shows the
  count with **Select all** / **Deselect all** and **Done**. Selection is
  scoped to the currently listed directory and clears when the directory
  changes.
- The selection bar offers **Move** and **Delete**. Bulk move reuses the
  existing move picker (the title names the number of items), refuses a
  destination that is the source directory, one of the selected folders, or
  inside one of them, and moves every selected entry to the chosen folder.
  Bulk delete asks for confirmation, names the number of entries, and warns
  that selected folders are deleted with their contents.
- Bulk operations fan out over the existing per-entry `mv`/`rm` endpoints
  with bounded concurrency; no new server endpoint is introduced. A failure
  on one item does not stop the rest: successful items are applied, the
  listing refreshes, and a dismissible result notice reports the failed
  items with their error classes (a bounded sample when many fail). Failed
  items remain in the listing.
- While a bulk operation runs, its actions are disabled and a progress
  label reports how many items have been processed. Leaving the directory
  or the app does not roll back already-applied items; each item remains
  complete-or-nothing and idempotent under retry, as the filesystem API
  already guarantees.
- The existing long-press/ellipsis context menu, single-entry move, and
  single-entry delete flows keep their behavior outside selection mode.

Assumptions (recorded, not blocking): selection covers only entries in the
current listing (no cross-directory selection); **Select all** selects the
currently listed entries after sorting/filtering; bulk actions do not gain
an undo; and the result notice is shown on the browse view rather than kept
as a durable activity record.

## Capabilities

### New Capabilities

None — this extends existing SPA behavior.

### Modified Capabilities

- `web-ui`: new requirements pin the writer-only selection mode, its list
  and grid interaction, the selection bar actions, the bulk move
  destination rules, bulk delete confirmation, partial-failure reporting,
  and progress state. The existing header-actions requirement gains the
  **Select** control, and the file-management requirements scope the
  forbidden/not-found states to single-entry actions while bulk failures
  use the result notice.

## Impact

- Code: `web/src/pages/BrowsePage.tsx` (selection state, bulk execution,
  result notice), `web/src/components/EntryViews.tsx` (selection rendering
  and tap behavior in list/grid), a new selection-bar component,
  `web/src/components/FileOpsDialogs.tsx` (bulk delete confirmation), a new
  framework-free `web/src/lib/bulkOps.ts` executor, and
  `web/src/pages/MovePickerPage.tsx` (multi-entry move state and
  destination validation). No server change: the filesystem API's
  `mv`/`rm` operations, retry model, and access rules are unchanged.
- Tests: unit tests for the bulk executor (ordering, bounded concurrency,
  continue-on-failure, progress, unauthorized stop), component tests for
  selection in both views, select all/none, header gating, delete
  confirmation, partial-failure notice, and multi-entry move destination
  rules; a Playwright bulk-actions flow on the verification server.
- Docs: `docs/using-stratofold.md` (how to select and bulk move/delete),
  the web-UI bullet in `AGENTS.md`, and the browse-route bullet in
  `docs/architecture.md`. `README.md` needs no change because it does not
  enumerate individual browse actions.
- **No ADR** — this change composes existing per-item-atomic filesystem
  operations in the SPA; it introduces no new server contract, storage,
  credential, or cross-cutting invariant. The durable decision that
  mutations are per-item atomic and idempotent already lives in the
  `filesystem-api` spec and ADR 0015's version model.

## Non-goals

- No bulk download or ZIP archive download; downloads stay per file.
- No server-side batch endpoint, batch job, or durable bulk-operation
  record; the fan-out stays client-side over the existing endpoints.
- No bulk rename, bulk extract, bulk share/role changes, bulk copy of
  public or 24-hour links, or bulk move/copy between different vdirs.
- No cross-directory or cross-view selection, no selection persistence
  across reloads or navigation, and no range/shift-click selection.
- No undo after a bulk operation completes; per-item failures are reported
  but successful mutations are not reverted.
- No change to access control or write gating: viewers, public visitors,
  and read-only bearer tokens still cannot write.
