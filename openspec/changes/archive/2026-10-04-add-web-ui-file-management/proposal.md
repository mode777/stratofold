# Proposal — `add-web-ui-file-management`

## Why

Change 7 shipped the Drive-like browsing foundation: the SPA logs in,
lists vdirs, browses directories, downloads, and manages connections,
vdirs, and shares — but it is still read-only. Every write operation the
backend already offers (`mkdir`, `mv`, `rm`, `upload`) is reachable only
with `curl`, and the vision's core UX promise — files upload in the
background and keep going while the user keeps working — has no proven
mechanism. This is roadmap change 8: the write path in the UI plus the
in-app upload manager, retiring risk **R7**.

## What Changes

- **File-management actions in the browse view**: create folder, rename,
  move (destination picker), and delete (with confirmation) for entries,
  driven by the existing `POST /api/sf/vdirs/{id}/{mkdir,mv,rm}`
  endpoints. Available only where the user may write (owner or `editor`
  share); viewers never see write affordances.
- **Upload**: pick one or more files and upload them to the current
  directory through `POST /api/sf/vdirs/{id}/upload?path=…` (raw body,
  no multipart). Uploads are enqueued, not awaited by the page, so the
  user can navigate and continue working.
- **In-app upload manager** (new `upload-queue` capability): a
  navigation-surviving queue that owns upload lifecycle — ordering,
  progress, pause (stop dispatching), cancel (abort and discard),
  re-enqueue, and per-item retry after a transient failure — with a
  persistent status panel mounted in the app shell. Uploads are
  frontend-driven only: an in-flight upload relies on the server's
  existing within-request resume across SSH drops, and a canceled or
  failed upload restarts from byte zero when re-enqueued (no
  cross-request resume protocol is added).
- **Error surfaces**: queue items and mutations distinguish the API's
  retryable class (`503`/network) from permanent classes (`403`, `404`,
  `400`, `500`) — retryable items offer retry, permanent items surface a
  terminal error and are never auto-retried (no retry storm).
- **Client layer additions**: typed `mkdir`/`mv`/`rm`/`upload` wrappers
  in `lib/filesApi.ts` reusing the existing `sfFetch`/`ApiFailure`
  machinery; upload progress via `XMLHttpRequest` (the one transport
  that reports upload progress and supports abort).
- **Validation per the roadmap row**: Vitest unit tests for the queue
  service (ordering, retry-on-transient, dedupe, cancel, progress) and
  component tests for the action dialogs and write-affordance gating;
  Playwright E2E on the build/verification server for upload
  small + large with progress, **navigate away mid-upload and the
  upload still completes** (the R7 acceptance test), the
  move/rename/delete/mkdir flows, and a permanent-failure surfaced
  without a retry storm.

## Capabilities

### New Capabilities

- `upload-queue`: the SPA's upload-manager service — a queue that
  survives in-app navigation and owns upload scheduling, per-item
  lifecycle (queued/running/paused/done/failed/canceled), progress
  reporting, pause/cancel/re-enqueue, transient-vs-permanent failure
  classification, and a UI status panel that reflects it.

### Modified Capabilities

- `web-ui`: adds the write surface to the browse experience — file
  management actions (mkdir, rename, move, delete) gated by write
  permission, multi-file upload initiation from the current directory,
  and the mapping of mutation/upload errors to the existing UI states.

## Impact

- Frontend only, scoped to `web/`; the Go backend and all backend specs
  are consumed unchanged (the upload endpoint already streams raw bodies
  and resumes across SSH drops within a request).
- New `web/src/lib/` upload transport and queue store (a module-level
  service with a React binding, since there is no global store today),
  new dialog components for mkdir/rename/move/delete, entry-action
  extensions in `components/EntryLinks.tsx`, and a status panel mounted
  in `components/AppShell.tsx` so it survives route changes.
- No new runtime dependency is required; upload progress uses the
  browser's `XMLHttpRequest` (the PocketBase SDK and Vite/Vitest/
  Playwright stack are unchanged).
- Docs: `docs/architecture.md` (the Upload key flow gains the queue
  lifecycle and cancel/restart semantics) and `AGENTS.md` (frontend
  write-path + upload-manager verification notes). **No ADR** — ADR 0005
  already pins the in-app upload-manager service, and this change is
  frontend mechanics within that decision (the pause/cancel-vs-resume
  scope choice is recorded in design.md).
- Verification: `npm --prefix web run test` (queue + component
  matrices), `npm --prefix web run e2e` on the build/verification server
  (R7 acceptance, mutation flows, permanent-failure handling), and
  `npx openspec validate --all --strict`.

## Non-goals

- No cross-request resumable-upload protocol: pause stops dispatching
  and cancel discards the in-flight request; resuming re-uploads from
  byte zero. A paused/canceled upload's partial temp file is the
  server's to discard (existing `filesystem-api` behavior).
- No uploads that survive a page reload or tab close — the queue is
  in-memory and survives in-app navigation only; service-worker
  resilience stays a future extension (ADR 0005, architecture non-goals).
- No drag & drop upload, no folder upload, no clipboard paste, no
  multi-select bulk actions, and no per-entry context menu beyond the
  new action buttons.
- No changes to sandbox, streaming, retry, or authorization behavior;
  no new collections, migrations, or backend routes; no backend spec
  deltas.
- No sharing, search, trash/versioning, notifications, i18n, or theming
  work.
