# Tasks

## 1. Version store and ADR

- [x] 1.1 Add migration `1770000008_file_versions.go` with the internal
  `file_versions` collection (`vdir` relation with cascade,
  `remote_path`, `generation`), a unique `(vdir, remote_path)` index,
  and no record-API rules; add a migration test asserting the schema,
  the unique pair, and cascade behavior, verified with
  `go test ./internal/migrations/`.
- [x] 1.2 Implement `internal/fileversion`: deterministic version hash
  (vdir, connection, canonical remote path, kind, size, whole-second
  mtime, generation), single and batched generation lookup, atomic
  bump, and conditional rollback; unit-test determinism, stability,
  generation change, batch misses, and rollback-only-if-current,
  verified with `go test ./internal/fileversion/`.
- [x] 1.3 Write ADR `docs/decisions/0015-content-version-and-conditional-writes.md`
  from `TEMPLATE.md` (generation + signature version, bump-before-
  publish, lock scope, external residual, rejected hash/sidecar/
  distributed-lock alternatives) and add its row to
  `docs/decisions/README.md`; verify every relative link and the
  `0015` index row resolve.

## 2. Stat, versioned listing, and ETag

- [x] 2.1 Add `/api/sf/vdirs/{vdirId}/stat` to `fsapi.CustomRoutes` and
  the router, implement `handleStat` with the response shape, root and
  directory rules, echo/name rules, and the listing auth/error order;
  test file/directory/root/missing/escape/auth matrix and no-dial on
  rejection with `go test ./internal/fsapi/ -run 'Stat'`.
- [x] 2.2 Add `version` to `fsapi.entry` and fill it from
  `fileversion.VersionsForDir` after `ReadDir`; test that every entry
  carries a version, repeated listings are stable, an external edit
  with changed size/mtime rotates it, and a store failure maps `500`,
  verified with `go test ./internal/fsapi/`.
- [x] 2.3 Thread the version through `fileserver.StatResolved` and
  `ServeFile` (including the `filelinks` call sites) and set the ETag
  to the quoted strong version; test ETag/stat agreement, `index.html`
  resolution, `If-None-Match` `304`, `If-Modified-Since` `304`, Range
  `206`, `HEAD` headers, and a store failure mapped to `500` rather
  than `404` on `/files` and `/s`, with `go test
  ./internal/fileserver/ ./internal/filelinks/`.
- [x] 2.4 Update `docs/architecture.md` with the stat route, the
  version invariant, the ETag source, and the conditional publish;
  verify the API list and the file-server section name the new
  behavior and link the ADR.

## 3. Conditional upload

- [x] 3.1 Add `If-Match` parsing (strong entity-tag list, `*`; weak
  tags never match; malformed/empty `400`) and the preliminary target
  check before the temp write; unit-test every accepted and rejected
  form and the fast-fail `412`, verified with `go test
  ./internal/fsapi/ -run 'Precondition|IfMatch'`.
- [x] 3.2 Implement the per-target publication lock, generation
  reservation (bump before rename, rollback on permanent failure, retry
  state that does not re-check the consumed precondition), publish-time
  check, `412` body with the current version, and temp cleanup; test
  matching version, stale version (newer content intact, no `.sfpart-*`
  temp), missing target, `*`, no header unchanged, change during a long
  upload, concurrent same-precondition race, and a retry between bump
  and rename, verified with `go test ./internal/fsapi/`.
- [x] 3.3 Add the version-change tests: stable repeated observations, a
  normal upload changes it, a same-size upload inside one whole second
  changes it, and a changed-signature external SFTP edit changes it;
  include the documented residual (same-size, same-second external
  edit) in the design/ADR rather than asserting it away, verified with
  `go test ./internal/fsapi/ -run 'Version'`.
- [x] 3.4 After a successful `mv`, best-effort bump the target
  generation without changing the `204` response or introducing a new
  failure path; test that a normal move rotates the target version and
  that an injected bump failure is logged but does not fail the move,
  verified with `go test ./internal/fsapi/ -run 'Mv|Move'`.

## 4. CORS and agent docs

- [x] 4.1 Extend `internal/appserver/cors_test.go` with a `stat`
  preflight and an upload preflight requesting
  `authorization,content-type,if-match`, asserting
  `Access-Control-Allow-Headers` includes `If-Match`; verify with
  `go test ./internal/appserver/`.
- [x] 4.2 Update the filesystem-api and client bullets in `AGENTS.md`
  (stat, version, `If-Match`/412, client `stat`/`ifVersion`/`conflict`,
  and the verification commands); verify the new text points at the
  owning specs and ADR 0015 rather than restating them.
- [x] 4.3 Update `docs/roadmap.md`: add this change and move the
  conditional follow-ons' reserved ADRs from 0015/0016 to 0016/0017;
  verify no duplicate `0015` remains and every ADR reference resolves.

## 5. Client package

- [x] 5.1 Add `LsEntry.version`, `StatEntry`, `UploadOptions.ifVersion`,
  the `conflict` kind, and the optional version on `StratofoldError`
  (with an optional `failureFor` argument) while keeping every existing
  kind/status mapping stable; unit-test the `412`/other-status matrix
  and the error version field, verified with
  `npm --prefix client run test`.
- [x] 5.2 Implement `stat(path, { signal })` over `POST /stat` with
  root/empty-path handling and signal forwarding; unit-test file,
  directory, root, missing (`notfound`), signal/abort behavior, and
  that no retry occurs, verified with `npm --prefix client run test`.
- [x] 5.3 Implement `upload(..., { ifVersion })`: quote a version,
  send `*` verbatim, reject an empty value locally, parse the `412`
  body for `message`/`version`, and never retry; unit-test the header,
  success, conflict-with-version, omitted-header behavior, and
  exactly one transfer, verified with `npm --prefix client run test`.
- [x] 5.4 Update `client/README.md` for `version`, `stat`, conditional
  upload/resync, and the `conflict` row; verify with
  `npm --prefix client run typecheck:readme` and
  `npm --prefix client run test`.

## 6. Integration verification

- [x] 6.1 Run `go test ./internal/fsapi/ ./internal/fileserver/ ./internal/appserver/`
  and record the exact output.
- [x] 6.2 Run `npm --prefix client run test` and
  `npm --prefix client run typecheck:readme` and record the exact
  output.
- [x] 6.3 Run `SF_RUN_GATES=1 go test ./internal/fsapi/ -run Gate` for
  the upload memory/concurrency gates and record the result.
- [x] 6.4 Run `go vet ./...` and `npx openspec validate --all --strict`;
  the change is ready for review only if the validator prints its
  success output for every spec and change.
