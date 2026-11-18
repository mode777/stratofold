# Design

## Context

The browse view (`web/src/pages/BrowsePage.tsx`) hands picker-selected
files to the in-app upload manager (`web/src/lib/uploadQueue.ts`, bound
via `useUploadQueue`) with `enqueue(vdirId, dir, files)` — a flat list
whose target path is `dir + "/" + file.name`. Two constraints shape
this change:

- The upload API (`POST /api/sf/vdirs/{id}/upload?path=…`) rejects a
  target whose parent directory does not exist with `404` — a
  permanent error the queue never retries (`TestUploadMissingParentAndBadShape`).
  Folder drops therefore need directories created *before* their files.
- The browser only exposes drag payload structure through
  `DataTransferItem.webkitGetAsEntry()` (file/directory entries with an
  async traversal API); `dataTransfer.files` alone flattens folders
  away. `mkdir` already creates missing parents and is idempotent
  (`web/src/lib/filesApi.ts`).

Write gating already exists client-side (`useVdirRole` → `canWrite`)
with the server as the authority. The queue is a framework-free
singleton with an injected upload function — the seam its unit tests
use; `extractJobs` established the `onSettled` listener pattern
`BrowsePage` already consumes for extraction refresh. Behavior
contract: the `upload-queue` and `web-ui` spec deltas.

## Goals / Non-Goals

**Goals:**

- Reuse the queue for everything a drop produces — no parallel
  ad-hoc transfer path, no new server surface.
- Parents provably created before their files, under the queue's
  existing FIFO/pause/retry semantics.
- Traversal logic isolated and unit-testable without a real browser
  drag (fake entry trees), matching how the queue is tested with an
  injected upload function.

**Non-Goals:**

- No picker-side folder selection (`webkitdirectory`), no drag-out,
  no drop-to-move, no drop zones outside the browse listing
  (proposal Non-goals).
- No queue virtualization or batching of folder items — one mkdir
  request per folder, one upload per file, as today.

## Decisions

### D1 — Traversal: `webkitGetAsEntry` recursion, entries grabbed synchronously

A new framework-free helper (`web/src/lib/dragDrop.ts`) turns a
`DataTransfer` into an upload plan: for each item,
`item.webkitGetAsEntry()`; a `FileSystemFileEntry` yields
`{relPath: name, file}` (via promisified `entry.file()`), a
`FileSystemDirectoryEntry` recurses with `createReader().readEntries()`
**looped until a batch comes back short** (the reader silently pages
at 100 entries — a single call misses large folders), with the dropped
folder's own name as the root segment (Drive-like: dropping `photos`
onto `docs` targets `docs/photos/…`). The plan carries folder paths
(incl. empty ones) and file `(path, File)` pairs, plus any entry that
failed to enumerate. The `DataTransferItemList` is invalidated once
the drop handler yields, so entries are collected synchronously in the
handler and only the traversal awaits afterwards. If no item exposes an
entry, the helper falls back to flat `dataTransfer.files`; a payload
with no files at all is a no-op.

*Rejected:* the File System Access API
(`getAsFileSystemHandle`/`values()` async iteration) — Chromium-only,
while `webkitGetAsEntry` works in every current engine that supports
directory drags. *Rejected:* relying on `dataTransfer.files` — it
cannot represent folders. Minimal local type declarations cover
`webkitGetAsEntry` if the installed `lib.dom.d.ts` lacks it.

### D2 — Directory creation rides the queue as folder items

`UploadItem` gains `kind: "upload" | "folder"`. A folder item runs the
existing `mkdir` wrapper (injected into the queue beside the upload
function, so unit tests fake both) and maps failures through the same
`ApiFailure` classes — `503`/network retried under the existing
`MAX_ATTEMPTS`, `403/404/400/500` permanent. FIFO with one active item
guarantees every folder completes before the files enqueued after it,
and pause/cancel/retry/visibility (the Uploads destination) apply to
the whole drop for free. `enqueue` keeps its signature and delegates
to a new path-carrying enqueue for drop plans; dedupe stays
`normalizeTarget(vdirId, path)` over the full target path, so a folder
item and an upload can never double-run the same path.

*Rejected:* eager mkdirs outside the queue before enqueueing files —
invisible "dead air" for large trees (nothing on the Uploads screen
until every mkdir resolves), not pausable, and a failed eager mkdir
strands the files into guaranteed `404`s or forces a browse-level
error path the queue already owns.

### D3 — Cascade: a folder item's terminal outcome carries to pending dependents, its retry restores them

When a folder item is canceled or fails terminally, every item whose
target starts with `folder.path + "/"` and is still `queued`/`paused`
moves to `canceled`/`failed` carrying the folder's error, and each such
item records `failedBy: folder.id`. `retry(folderItem)` re-queues the
folder **and** its `failedBy` descendants (resetting them like the
existing retry); items that failed on their own keep their own retry.
Cancel cascades symmetrically. Already-running items cannot be
dependents (FIFO ran the folder first), so no abort coordination is
needed.

*Rejected:* letting dependents run and fail `404` individually — N
wasted requests and per-file "Not found" noise for one root cause;
rejected hidden re-derivation at dispatch time (walking prefixes on
every start) — implicit state, harder to test than an explicit marker.

### D4 — Drop zone wiring and gating in the browse view

The listing container (the `min-h-0 flex-1` block that renders the
spinner/failure/empty/list/grid states) gets the handlers, so the drop
zone is one region covering the empty state too. For writers:
`onDragOver`/`onDragEnter` call `preventDefault()` and set
`dropEffect = "copy"` (the browser fires `drop` only when dragover is
canceled) and set a highlight state; a counter of
`dragenter`/`dragleave` pairs (they fire per child element) toggles
the highlight off cleanly; `onDrop` prevents the browser's
open-as-document default, hands the plan from D1 to the queue, and
surfaces traversal failures as a dismissible `role="alert"` notice
naming the failed entry — never a silent no-op. Non-writers mount no
handlers at all, so viewers and public visitors get the browser
default and no affordance; the empty state adds a one-line drop hint
only for writers. Upload/replace semantics at an existing target are
unchanged from the picker path.

### D5 — Listing refresh mirrors the `onSettled` seam

`UploadQueue` grows the same `onSettled(listener)` seam
`extractJobs` already exposes (listeners fire when an item reaches a
terminal state). `BrowsePage` subscribes once and bumps its existing
reload counter when a completed item's target directory — an upload's
`dir`, a folder item's parent — is the browsed path. This also makes
empty dropped folders and picker uploads appear without a manual
reload, and it is the pattern the extraction refresh already uses in
this file.

*Rejected:* diffing queue snapshots in an effect inside `BrowsePage` —
re-derives "what just finished" from two list copies instead of the
queue stating it; *rejected:* reloading on every queue emit — a
progress tick is not a reason to refetch.

### D6 — Verification

Unit (Vitest, no DOM): queue tests extend the injected-fake pattern
with a fake `mkdir` (parents-before-files order, empty folders,
retryable-vs-permanent, dedupe across kinds, cascade cancel/fail/
retry-restore); `dragDrop` tests drive fake `FileSystemEntry` trees,
including a reader that pages entries in short batches to reproduce
the `readEntries` trap and an enumeration failure; panel tests cover
folder rows. Component (Testing Library): `BrowsePage` drop events
with a stubbed traversal (file drop enqueues into the browsed dir,
highlight on/off, viewer/public mount no handlers, notice on
unreadable payload, listing refresh on settle). E2E on the
build/verification server: Playwright synthesizes file drops (real
`DataTransfer` with `File`s) — file-drop upload, highlight, refresh —
while directory-entry drags cannot be synthesized there and stay
unit-gated. `npx openspec validate --all --strict` gates the deltas.

## Risks / Trade-offs

- [`DataTransferItemList` invalidates after the drop handler] →
  entries are collected synchronously before any `await` (D1); the
  fallback path reads `dataTransfer.files` in the same tick.
- [Huge tree drops enqueue thousands of items and the panel renders
  them all] → accepted: `File` handles are lazy (no content in
  memory), traffic stays one-at-a-time, and the floating indicator
  keeps count; no virtualization is introduced.
- [Windows/OS drag sources can yield entries the server rejects
  (reserved names, odd characters)] → the item fails with the server's
  deterministic error surfaced per item — same contract as the picker
  path, no client-side name policing invented here.
- [A same-named remote file is replaced without asking] → unchanged
  upload semantics (proposal Non-goals); the E2E asserts replacement
  parity with the picker path rather than new confirmation UX.
- [`readEntries` implementations differ subtly across engines] → the
  traversal loops until a short batch and tolerates an empty first
  batch; fake-reader tests pin the behavior.

## Migration Plan

Client-only change; no API, schema, or data migration. Rollback is a
revert of the `web/` commits. Server behavior is untouched.

## Open Questions

None — the two UX assumptions (dropped folders land as subfolders with
their name preserved; the whole listing is the drop zone, empty state
included) are recorded in the proposal and reflected in the deltas.
