# Design — `add-web-ui-file-management`

## Context

Change 7 shipped the SPA shell, browse views, and the read/management
surfaces (see `proposal.md` — Why). The backend write path already
exists and is unchanged by this change: `POST
/api/sf/vdirs/{id}/{mkdir,mv,rm}` (JSON bodies, `204`) and `POST
/api/sf/vdirs/{id}/upload?path=…` (raw request body, returns
`{path, size}`), with deterministic error classes already mapped by
`web/src/lib/filesApi.ts`. What the SPA lacks is the write UI and any
queue that outlives a routed page: server state today lives in
per-component `useState` + a manual reload counter, the only global
store is the session context, and the entry actions row has no
mutations. `web/src/components/AppShell.tsx` wraps every authenticated
route, so it is the mount point for a persistent manager. ADR 0005
already commits to "an in-app upload-manager service that keeps
uploading while the user navigates"; this design is the mechanics of
that decision. Behavior contract: the `web-ui` and `upload-queue` spec
deltas.

## Goals / Non-Goals

**Goals:**

- Wire the four existing mutation/upload endpoints into the SPA with the
  smallest possible surface: typed wrappers over `sfFetch`, dialogs that
  reuse `Dialog`/`FailureState`, and a listing refresh after success.
- A queue that provably survives in-app navigation (the R7 acceptance
  test) and is unit-testable without a browser or React.
- Correct, non-destructive write gating: no write affordance is shown to
  a viewer, and the server remains the final authority (`403` surfaced).
- Progress that reflects bytes actually sent, with abort for cancel.

**Non-Goals:**

- No cross-request resume protocol, no upload session ids, no
  server-side changes (`proposal.md` Non-goals; `filesystem-api` is
  consumed as-is).
- No persistence across reload/tab close, no service worker, no drag &
  drop, no folder upload, no bulk multi-select.
- No new global data-fetching or state library; ADR 0005 names SDK +
  Router + Virtual only.

## Decisions

### D1 — Upload transport is `XMLHttpRequest`

`XMLHttpRequest` is the only browser API that both reports upload
progress (`xhr.upload.onprogress`, `loaded`/`total`) and aborts a
request (`xhr.abort()`). The upload wrapper builds the raw body from the
`File`, sets `Content-Type: application/octet-stream`, and maps failure
via the existing `failureFor(status, message)` so upload errors join the
same discriminated `ApiFailure` classes as every other call. The
`/files`-style cookie is sent (`withCredentials`-equivalent same-origin)
and the PocketBase token is not needed because the upload route reads
the session cookie.

*Rejected:* `fetch` — it exposes no upload-progress event, and
streaming request bodies (`duplex: "half"`) report bytes *enqueued* at
request start, not bytes sent, with uneven support. *Rejected:* adding
Axios — a new dependency for one call when XHR is native.

### D2 — Queue store: a framework-free singleton bound with `useSyncExternalStore`

`web/src/lib/uploadQueue.ts` is a plain module singleton: an ordered
array of items (`id`, `vdirId`, `dir`, `name`, `path`, `file`, `state`,
`loaded`, `total`, `error`), a single in-flight slot, and
`enqueue/pause/resume/cancel/retry/subscribe/getSnapshot` methods. React
binds to it through a thin `useUploadQueue()` hook backed by
`useSyncExternalStore`; the status panel mounts in `AppShell.tsx`, so
the queue and its UI outlive every routed page. The service is
constructible with an injected upload function, which is what makes the
queue's ordering/retry/dedupe/cancel behavior unit-testable with no DOM.

*Rejected:* a React Context in `App.tsx` — the queue must run while the
tree around it changes, and a context value re-renders the whole
authenticated tree on every progress tick. *Rejected:* Zustand/Redux/
TanStack Query — new dependencies for a ~150-line service; ADR 0005's
"revisit if change 8's upload queue needs shared mutation state" is
answered by the singleton, not by adopting a library. *Rejected:*
persisting to `localStorage`/IndexedDB — out of scope (reload ends the
queue).

### D3 — Client wrappers live in `lib/filesApi.ts`; listing refresh reuses the existing counter

Add `mkdir(vdirId, path)`, `mv(vdirId, path, to)`, `rm(vdirId, path)`
(JSON, `204`) and `uploadFile(vdirId, path, file, { onProgress, signal })`
(raw body) next to `ls`. All go through `sfFetch`/`failureFor`, so the
`401`-to-login interceptor and the `404/403/503/400/500` mapping are
inherited unchanged. Mutation dialogs on success call the `BrowsePage`
reload counter (`setAttempt`) — the same refetch mechanism the page
already uses — so no cache is introduced.

*Rejected:* optimistic local listing edits — the server is the source of
truth for entry metadata (size/mtime) and a refetch is cheap; optimistic
edits would need rollback machinery for no user-visible gain at this
scale.

### D4 — Write permission is derived client-side from owner/share role

An entry's write affordances are gated by an `effectiveRole` for the
current vdir: `owner` when `vdir.owner === userId` (the same comparison
`VdirSwitcher` already uses to split own vs shared); otherwise the SPA
reads the current user's own `vdir_shares` record for that vdir and maps
`editor` → writable, `viewer` → read-only, no record → read-only. The
share read rule already exposes a grantee's own share
(`user = @request.auth.id`, `internal/migrations/shares.go`), so this
needs **no backend change**. The result is memoized per vdir in the
browse view. This is a UI affordance only — the server independently
enforces the same boundary, and a raced `403` is surfaced as the
forbidden state.

*Rejected:* a new backend endpoint returning the effective role — an API
addition to render a button; the rule already leaks the minimum needed.
*Rejected:* inferring writability from a `ls`-and-try — it would surface
write affordances to viewers before failing.

### D5 — Mutation UI reuses the existing dialog and error primitives

`EntryActions` (`components/EntryLinks.tsx`) gains Rename, Move, and
Delete; the toolbar gains New folder and Upload. Create-folder and
rename are small forms; move takes a destination virtual path; delete
opens a confirmation. All render inside the existing `Dialog`
(Escape/backdrop close, `role="dialog"`), show inline `role="alert"`
errors, and map `ApiFailure.kind` exactly as the management pages do
(`notfound` → not-found state, `forbidden` → forbidden notice, etc.).
Successful mutations trigger the D3 refresh; the entry is not mutated
locally.

*Rejected:* an inline rename-in-place editor — more state and focus
handling than a dialog for no behavioral difference; the dialog is the
established pattern (ShareDialog, VdirForm, ConnectionForm).

### D6 — Queue semantics: FIFO, one active upload, pause/cancel/re-enqueue, bounded retry

The queue is FIFO with a single active upload (concurrency 1): ordering
is trivially preserved, the dedupe key (`vdirId` + normalized target
path) is checked against queued and running items, and the single
connection's channel is not saturated with parallel uploads from one
client. "Pause" stops dispatch (no new item starts; the active item is
allowed to finish or is canceled by the user); "resume" continues
dispatch. "Cancel" aborts the XHR — the server's existing upload
handler discards its temp and publishes nothing — and marks the item
canceled. Re-enqueueing a canceled or failed item starts from byte zero
(the accepted no-cross-request-resume scope). Retryable failures
(network/`503`) are auto-retried a small bounded number of times before
surfacing an explicit retry; permanent classes (`403/404/400/500`) fail
immediately and are never auto-retried.

*Rejected:* parallel uploads with per-item concurrency — ordering and
dedupe get more complex and the roadmap only asks for ordering,
retry, dedupe, cancel. *Rejected:* automatic infinite/backoff retry in
the browser — the "retry storm" the roadmap explicitly forbids;
bounded attempts plus a manual retry is the contract.

### D7 — Progress counts bytes sent; 100% is not "done" until the response

`xhr.upload.onprogress` reports `loaded/total`; the panel shows that
percentage. Because the server may still be committing the remote write
after the browser has sent the last byte, the item stays in `running`
(shown as "finishing") until the response resolves, then flips to
`completed` with the server-reported `{path, size}`. This avoids a
"100% then still spinning" illusion.

*Rejected:* treating `upload.onprogress` completion as success — the
response can still be `4xx/5xx` and the temp is then discarded.

### D8 — Verification: queue unit tests locally, E2E on the verification server

The queue service is tested in isolation with an injected fake upload
(ordering, pause/resume, cancel, dedupe, retry classification,
progress) — pure Vitest, no DOM. Component tests cover dialog
validation, write-affordance gating by role, listing refresh, and
error-state mapping using the existing `mockApi.ts` patterns. The
Playwright suite extends `web/e2e/` against the existing in-proc harness
(`cmd/stratofold-e2e`, which already serves the filesystem API): upload
small + large with progress, **navigate away mid-upload and assert it
completes** (R7), mkdir/rename/move/delete flows, and a permanent
failure surfaced without a retry storm. Per repo rules E2E gates on the
build/verification server; component + unit tests gate locally.

*Rejected:* a new upload-specific test harness — the filesystem API and
seeded dataset already exist in the harness, and change 7's spec already
boots it on real ports.

## Risks / Trade-offs

- [XHR upload progress is browser-send progress, not server-commit
  progress] → keep the item `running` until the response (D7); never
  mark complete from the progress event.
- [Pause is not true resume — a paused/canceled upload restarts from
  byte zero] → accepted scope decision (proposal Non-goals); the queue
  labels re-enqueue as a restart, and server-side within-request resume
  still covers SSH drops during a single upload.
- [In-memory queue loses work on reload/tab close] → ADR 0005 defers
  service-worker resilience; the status panel makes the loss visible
  rather than silent.
- [Deriving role costs an extra `vdir_shares` read per browsed vdir] →
  one request per vdir, memoized in the view; negligible next to
  directory listings.
- [A single active upload serializes many small files] → matches the
  roadmap's ordering requirement and one SFTP channel; a concurrency
  knob is a later change if needed.
- [A raced permission change between role derivation and a write] →
  server enforcement returns `403`, surfaced as the forbidden state
  (D4/D5); the UI never assumes success.

## Migration Plan

Additive and frontend-only: new `web/src/lib/uploadQueue.ts` and dialog
components, extensions to `EntryLinks.tsx`, `BrowsePage.tsx`, and
`AppShell.tsx`, and new tests. No backend, data, or route changes.
Rollback is removing the new files and the action wiring; no persisted
state or schema is touched.

## Open Questions

None — the queue concurrency and retry budgets are tunable constants
that do not change the specs, approach, or task breakdown.
