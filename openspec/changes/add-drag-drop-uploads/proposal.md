# Proposal

## Why

Uploading today requires the hidden file picker behind the folder
header's Upload button — a user with Windows Explorer open cannot just
drag files (or a whole folder) onto the directory they are browsing.
Drag & drop is a baseline expectation for a Drive-like file manager,
and folder drops are the natural way to publish an existing local
folder tree without clicking through the picker per file.

## What Changes

- The browse view's listing area (including the empty-directory state)
  becomes a drop zone for users who may write on the vdir (owner or
  `editor`): dropping one or more files enqueues them into the browsed
  directory through the existing upload manager, exactly like the
  picker path.
- Dropping one or more folders uploads them recursively, preserving
  the structure: a dropped folder lands as a subfolder of the browsed
  directory (Drive-like), its files upload with their relative paths
  beneath it, and empty folders are created too. Mixed drops (files and
  folders) are supported.
- The upload queue gains folder-aware items: an upload item may target
  a subdirectory path, and a folder item creates its directory ahead of
  the files inside it (in queue order), so parents exist before their
  files upload (the API's upload endpoint rejects a missing parent with
  `404`). Folder items appear on the Uploads destination with the same
  lifecycle states (no byte progress), and a folder item's terminal
  failure or cancel carries over to its not-yet-started dependent
  items instead of letting each one fail individually.
- A drag-over highlight marks the listing as a valid drop target while
  a drag hovers it; the empty state gains a drop hint for writers.
- Viewers and anonymous public visitors get no drop behavior: dropping
  onto their browse view does nothing app-specific (the server remains
  the authority on every write).
- A drop payload that cannot be traversed (unreadable folder, aborted
  entry enumeration) surfaces a visible notice naming what failed;
  readable siblings still upload. No drop is ever a silent no-op.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `upload-queue`: items may carry an explicit subdirectory target path,
  and folder items (directory creations) join the same FIFO queue with
  their own lifecycle, running before the files they contain; a folder
  item's cancel/terminal failure applies to its pending dependents and
  its retry restores them.
- `web-ui`: the browse listing (empty state included) is a writer-gated
  drag & drop drop zone with drag-over feedback, recursive folder
  upload via the queue, and a visible notice for unreadable drop
  payloads; non-writers get no drop affordance.

## Impact

- **Code**: `web/src/lib/uploadQueue.ts` (item shape, folder items,
  mkdir integration, cascade semantics), `web/src/lib/useUploadQueue.ts`
  (unchanged binding, new snapshot fields flow through), a new
  `web/src/lib/dragDrop.ts` (DataTransfer → upload-plan traversal),
  `web/src/pages/BrowsePage.tsx` (drop zone, highlight, notice,
  empty-state hint), `web/src/components/UploadPanel.tsx` (folder item
  rows), plus their tests and a new `web/e2e/` spec.
- **APIs**: none new — consumes the existing `upload`, `mkdir`, and
  (for gating) client-side role derivation unchanged; the server
  enforces authorization and sandboxing exactly as today.
- **Docs**: `docs/using-stratofold.md` (Uploads section gains the
  drag & drop behavior) and one line in `AGENTS.md`'s file-management
  section. No ADR — this is UI mechanics over the existing filesystem
  API; it settles no durable architecture decision (the queue's
  design doc records the extension rationale).

## Non-goals

- No drop zones outside the browse view (Locations, Uploads, Settings,
  and preview/player screens stay drop-inert).
- No folder picking through the Upload button (no `webkitdirectory`
  input); the picker path stays flat multi-file.
- No cross-request upload resume, no concurrency increase, no change
  to queue ordering/pause/cancel/retry semantics beyond folder items.
- No server-side changes: no batch/multi-entry upload endpoint, no
  client-visible archive of the drop, no dedupe against the *remote*
  listing (an uploaded file replaces an existing file of the same name
  exactly as the picker path does today).
- No drag-out (download by dragging out of the SPA), no drop-to-move
  within the listing (dragging entries between Stratofold folders).
- No support for dropping non-file payloads (text, URLs, images
  rendered in the page) — only OS file/folder drags.
