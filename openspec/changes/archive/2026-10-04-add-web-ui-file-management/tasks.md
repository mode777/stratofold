# Tasks

## 1. Client write API (`web/src/lib/filesApi.ts`)

- [x] 1.1 Add `mkdir(vdirId, path)`, `mv(vdirId, path, to)`, and `rm(vdirId, path)` wrappers (design D3) over `sfFetch` with JSON bodies and `204` handling, reusing `failureFor` so `401/403/404/503/400/500` map to the existing `ApiFailure` classes; verify with Vitest unit tests asserting each request's method, URL, body shape, and error-class mapping for a `403`/`404`/`503` response
- [x] 1.2 Add `uploadFile(vdirId, path, file, { onProgress, signal })` using `XMLHttpRequest` (design D1/D7): raw body, target path in the query string, `onProgress(loaded, total)`, abort support, response `{path, size}`, and network/status failures mapped through `failureFor`; verify with Vitest unit tests over a mocked XHR covering progress events, abort, success shape, and a retryable vs permanent failure

## 2. Upload queue service (`web/src/lib/uploadQueue.ts`)

- [x] 2.1 Implement the framework-free queue singleton (design D2/D6): ordered items, single active upload, FIFO dispatch, `enqueue/pause/resume/cancel/retry`, `subscribe/getSnapshot`, and the dedupe key (`vdirId` + normalized target path) checked against queued and running items; verify with Vitest unit tests (injected fake upload) for ordering, dedupe coalescing, pause holding later items, and resume continuing dispatch
- [x] 2.2 Implement per-item lifecycle and progress (design D6/D7): states queued/running/paused/completed/canceled/failed, `loaded`/`total` progress, cancel aborting the in-flight request and publishing nothing, re-enqueue restarting from byte zero, bounded auto-retry for retryable failures, and immediate terminal failure for `403/404/400/500` with no auto-retry; verify with Vitest unit tests covering progress advancement, cancel, re-enqueue restart, bounded retry, and the permanent-failure no-retry-storm case
- [x] 2.3 Add the `useUploadQueue()` binding over `useSyncExternalStore` and verify with a component test that subscribers re-render on queue changes and clean up on unmount

## 3. File-management UI in the browse view

- [x] 3.1 Derive `effectiveRole` for the current vdir (design D4): owner when `vdir.owner === userId`, else read the user's own `vdir_shares` record and map `editor` → writable, `viewer`/none → read-only; memoize per vdir; verify with a unit/component test over the owner/editor/viewer/no-share matrix
- [x] 3.2 Add create-folder, rename, move, and delete affordances to `EntryActions`/the browse toolbar with dialogs reusing `Dialog` (design D5), delete requiring confirmation, and a listing refresh on success via the existing `attempt` counter; gate every affordance on `effectiveRole`; verify with component tests: owner/editor see and complete each action, viewer sees none, delete confirmation cancels without change, and a successful mutation re-lists
- [x] 3.3 Map mutation failures to UI states (design D5): `404` not-found, `403` forbidden (no repeating write offer), `503` retryable with a working retry, `400`/`500` message; verify with component tests over the error-class matrix using `mockApi.ts`

## 4. Upload initiation and the persistent status panel

- [x] 4.1 Add multi-file selection/upload to the browse view that enqueues files with the current directory as the target (design D3/D6) and does not block the view; verify with a component test that selecting files enqueues them with the current virtual path and the view stays interactive
- [x] 4.2 Mount the upload status panel in `AppShell.tsx` (design D2) showing each item's state and progress with pause/resume/cancel/retry controls; verify with component tests that the panel is present on multiple authenticated routes, reflects queue changes, and its controls drive the queue

## 5. E2E suite (`web/e2e/`) on the verification server

- [x] 5.1 Extend the Playwright suite with the R7 acceptance test (design D8): upload a small and a large file with visible progress, then **navigate away mid-upload and assert the upload still completes**; verify with `npm --prefix web run e2e` against `cmd/stratofold-e2e`
- [x] 5.2 Extend the Playwright suite with the mutation flows and failure handling (design D8): mkdir → rename → move → delete against the seeded dataset, a viewer seeing no write affordances, and a permanent-failure upload surfaced without a retry storm; verify with `npm --prefix web run e2e` against `cmd/stratofold-e2e`

## 6. Docs and validation

- [x] 6.1 Update docs: `docs/architecture.md` Upload key flow gains the queue lifecycle and the pause/cancel/restart-from-zero semantics, and `AGENTS.md` gains the frontend write-path + upload-manager verification notes; verify the docs match the shipped code and commands run as written
- [x] 6.2 No ADR — ADR 0005 already pins the in-app upload-manager service and this change is frontend mechanics within that decision (design D1/D6 record the transport and pause/cancel choices); if apply surfaces a new durable decision, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note it in this file if so)
- [x] 6.3 Run the full harness: `go vet ./... && go test ./...` (unchanged backend regression), `npm --prefix web run test` (queue + component matrices), `npm --prefix web run e2e` (harness suite on the verification server), and `npx openspec validate --all --strict`; verify all pass
