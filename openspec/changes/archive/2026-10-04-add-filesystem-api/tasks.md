# Tasks

## 1. Operation layer and error mapping (`internal/fsapi`)

- [x] 1.1 Create the `fsapi` package with the route table and the retry helper (design D3): one `withRetry` over `sshconn.ClientProvider` + `ssherr.Classify`, bounded by MaxAttempts, with already-applied semantics supplied per operation; verify with unit tests over the SSH fixture: a retryable failure is retried to success, a permanent failure returns immediately (attempt counters observed)

- [x] 1.2 Implement the deterministic error mapping (design D6): sandbox rejections/invalid config/not-found → `404`, permission denied → `403`, invalid request shape → `400`, retryable exhaustion → `503`, unclassified → `500`; verify with a table-driven test mapping representative classified errors to statuses

## 2. Listings

- [x] 2.1 Implement the `ls` handler (design D1/D2): `POST /api/sf/vdirs/{vdirId}/ls`, JSON body `{"path": …}` (vdir root when empty), resolution via `vdir.Resolver`, `ReadDir` returning entries with name, size, directory flag, modification time; verify with fixture integration: the listing maps the real remote subfolder, nested virtual paths list, lexical/encoded/symlink-escape attempts return `404` listing nothing, unknown vdir and missing directory return `404`

## 3. Mutations

- [x] 3.1 Implement the `mkdir` handler (design D3): creates missing parents, already-existing directory is success; verify with fixture integration: nested chain `a/b/c` created end to end, `mkdir` of an existing directory succeeds without altering it, and an injected disconnect mid-mkdir is retried to exactly-once final state (no half-created chain)

- [x] 3.2 Implement the `mv` handler (design D3): rename within the vdir, PosixRename replace of an existing target, already-applied detection on retry (source gone + target present = success, both gone = permanent); verify with fixture integration: content byte-exact at target with source gone, replace-on-existing, and a disconnect before acknowledgment retried transparently — never both source and target, never a duplicated move

- [x] 3.3 Implement the `rm` handler (design D4): recursive post-order `Lstat` walk, symlinks deleted as links (never followed), per-entry not-found counts as deleted; verify with fixture integration: a nested tree plus an inside-the-tree symlink pointing outside is removed with nothing outside touched, a disconnect mid-`rm` retries to no partial tree, and retrying a completed `rm` succeeds

## 4. Uploads

- [x] 4.1 Implement the upload handler (design D5): `POST /api/sf/vdirs/{vdirId}/upload?path=…` streaming the raw body through `sftpreadwrite.Transfer.WriteAll` into a `.<base>.sfpart-<random>` temp in the target's directory, then publishing with `PosixRename`; Content-Length sizing with chunked-to-EOF fallback; verify with fixture integration: published checksum equals the uploaded body, upload over an existing file fully replaces it, missing parent directory returns `404` writing nothing, and the success response reports the published path and exact byte count

- [x] 4.2 Implement the abandon paths (design D5): permanent error, unresumable resume guard, exhausted attempts, and client cancellation each remove the temp file best-effort; verify with fixture integration tests that no file exists at the target path after every abandon path (atomicity scenario), and the request fails with an explicit mapped error

- [x] 4.3 Add the deterministic mid-upload disconnect test (roadmap R5/R6): the fixture's connection killer drops the SSH connection mid-write; the upload resumes at the last acknowledged offset and the published file checksums equal to the uploaded body; verify it passes in the normal suite (`go test ./internal/fsapi/`)

- [x] 4.4 Add the upload memory-ceiling gate (roadmap R5): a multi-GB sparse upload streams end to end with flat peak process memory; verify with `SF_RUN_GATES=1 go test ./internal/fsapi/`

## 5. Access control

- [x] 5.1 Implement the authorize-before-dial decision on every route (design D2): non-public vdirs require the owner's valid `sf_session` for all operations; public vdirs serve anonymous `ls` only, writes stay owner-only; verify with an httptest matrix: owner executes each operation, anonymous requests to non-public vdirs get `401` with zero SSH dials observed on the fixture, authenticated non-owner gets `403`, forged/expired cookies get `401`, public vdir serves anonymous `ls` and rejects anonymous `upload` with `401`

## 6. Wiring, streaming, concurrency

- [x] 6.1 Wire `fsapi` into `internal/appserver.Install` with `ClearStreamDeadlines` on the `/api/sf/vdirs/*` group and extend the route-collision assertions to cover the new routes vs PocketBase built-ins (including `/api/files/*`); verify the existing `internal/appserver` and `internal/authbridge` suites pass with the extended assertions

- [x] 6.2 Add the concurrency validation (design D7): parallel uploads to distinct targets and mixed parallel `ls`/`mkdir`/`mv`/`rm`/upload traffic over one vdir complete without interleaving corruption (each published file matches its own body; no partial file visible at any target path); verify with the fixture test in the normal suite and the sustained variant under `SF_RUN_GATES=1`

## 7. Docs and validation

- [x] 7.1 No ADR — 0003 (SSH/SFTP stack, offset streaming, host-key pinning) already records the durable decisions this change implements (D1–D7 are mechanics within it; the endpoint set and retry model are pre-pinned in `docs/architecture.md`); if apply surfaces a new durable decision, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note it in this file if so)

- [x] 7.2 Update docs: reconcile `docs/architecture.md`'s `/api/sf/*` section with the shipped handlers (route shapes, body/query encoding, temp-then-rename publication, error mapping) and add dev/verification notes to `AGENTS.md` (packages to test, gates, fixture usage); verify the docs match the shipped code

- [x] 7.3 Run the full harness: `go vet ./...`, `go test ./...` (fsapi operation/retry/authz matrices, wiring, concurrency), `SF_RUN_GATES=1 go test ./...` for the risk gates (upload memory ceiling, sustained concurrency), and `npx openspec validate --all --strict`; verify all pass
