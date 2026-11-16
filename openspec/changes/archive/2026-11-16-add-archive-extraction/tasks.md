# Tasks

## 1. Entry validation and target naming

- [x] 1.1 Add the strict entry-name validator to the new
  `internal/archiveextract` package: reject empty/`.`/`..` segments,
  absolute names, backslashes, NUL bytes, invalid UTF-8, and over-deep
  paths; return the validated segment list; verify with a table-driven
  unit test covering every rejected form from the spec plus the accepted
  forms (`a/b.txt`, `a b.txt`, `.bashrc`, unicode names)
- [x] 1.2 Add cosmetic-entry classification (`__MACOSX/` contents, `._*`,
  `.DS_Store`, `Thumbs.db`) and verify a unit test classifies each as
  skipped while near-misses (`macosx/`, `.ds_store`) stay extractable
- [x] 1.3 Add target-folder derivation from the archive name (strip a
  case-insensitive `.zip`, reject an empty result) and the optional
  single-segment `name` override; verify a unit test covers
  `photos.zip`/`Backup.ZIP`/root archives and rejects an override
  containing `/`, `..`, or NUL
- [x] 1.4 Add the package's bounded constants with one documented
  location (entries, depth, total inflated bytes) and verify a unit test
  asserts the values and that the budget reader errors one byte past the
  remaining allowance

## 2. Archive access over the SFTP channel

- [x] 2.1 Add an `io.ReaderAt` adapter over
  `sftpreadwrite.Transfer.ReadRange` that clamps to the file size and
  translates a short final read into `io.EOF`; verify a unit test against
  a fake provider covers in-range, end-of-file, past-end, and zero-length
  reads
- [x] 2.2 Add the bounded single-entry read-ahead window in front of the
  adapter; verify a benchmark or test against the in-proc fixture over a
  latency-injected transport records throughput, and note the chosen
  window size in `design.md` (D3)
- [x] 2.3 Open the archive with `zip.NewReader` over the adapter,
  detecting zip64, unsupported methods, and the encryption flag; verify a
  unit test opens crafted archives through a fake `ReaderAt` and reports
  `ErrFormat`/unsupported/encrypted distinctly

## 3. Job registry and lifecycle

- [x] 3.1 Implement the in-memory registry: random 128-bit ids, per-vdir
  lookup, state/phase transitions, monotonic counters, terminal
  snapshots, per-target single-running enforcement, the global
  concurrency cap, and terminal retention with eviction; verify unit
  tests for each rule including that eviction leaves the entry's
  published path untouched
- [x] 3.2 Implement cancellation with an idempotent `DELETE` that reports
  an existing terminal state; verify a unit test cancels a running job and
  then re-cancels a finished one with no error
- [x] 3.3 Run the job on a context detached from the request with its own
  deadline, and make every exit path (panic included) remove the scratch
  directory; verify a unit test that kills the job at each phase leaves no
  scratch directory and no published folder
- [x] 3.4 Write ADR `docs/decisions/0017-long-running-jobs.md` from
  `TEMPLATE.md` recording that long-running operations are in-memory jobs
  polled over the API, with the rejected alternatives from design D2, and
  add its row to the `docs/decisions/README.md` index; verify the index
  links the file and `docs/decisions/` contains no unindexed record

## 4. Extraction driver

- [x] 4.1 Implement the scan phase: read the central directory, publish
  advisory totals, count cosmetic skips, and refuse on the first
  structural violation with an error naming the entry; verify a unit test
  against a crafted archive in the in-proc fixture reports totals, skips,
  and a named offending entry
- [x] 4.2 Implement the extract phase: create
  `.<archive>.sfext-<hex>` in the archive's directory, then per entry
  stream the inflated reader through a budget-limited reader into
  `sftpreadwrite.WriteAll` with `size = -1`, applying entry mode and
  mtime best-effort; verify an integration test compares every member
  byte-for-byte with the source entry and asserts a lying declared size is
  caught by the running budget
- [x] 4.3 Implement the publish phase: pre-flight `Stat` of the target,
  `PosixRename` with a `Rename` fallback, a `409` when the target exists,
  and a best-effort sweep of stale `.*.sfext-*` directories in the same
  parent; verify integration tests cover publish success, the existing-
  target conflict, and the sweep
- [x] 4.4 Propagate member checksum failures and unsupported-entry errors
  as terminal job errors with the mapped status; verify an integration
  test modifies a member between scan and extract (fake `ReaderAt`) and
  observes a `failed` job with nothing published

## 5. Routes, access control, and listing

- [x] 5.1 Register `POST /api/sf/vdirs/{vdirId}/extract`,
  `GET`/`DELETE …/extract/{jobId}` in the existing `internal/fsapi` route
  group with typed request/response bodies, wire them into
  `CustomRoutes()` and the route-collision assertion; verify
  `go test ./internal/fsapi/` passes the new route-shape tests and
  `go test ./internal/appserver/` still finds no shadowed PocketBase route
- [x] 5.2 Authorize creation with `requestauth.AuthorizeVdir(..., true)`
  before dialing, resolve the archive through `vdir.Resolver`, and map
  bad shape/not-an-archive/missing/target-exists to
  `400`/`400`/`404`/`409`; verify the authz matrix test covers owner,
  editor, viewer, anonymous, public, bearer viewer/editor, wrong-vdir
  token, and asserts no dial on every rejection
- [x] 5.3 Re-check `vdirauthz` write access between member batches (every
  64 entries or 32 MiB) and abort with a forbidden terminal error;
  verify an integration test removes the share mid-extraction and observes
  `failed` with `403`, no published folder, and no scratch directory
- [x] 5.4 Authorize observation and cancellation with the same write rule
  and verify a test that another authenticated user gets `403` for both
  while the job continues to completion
- [x] 5.5 Filter Stratofold's own scratch names in `readDirEntries` and
  verify `go test ./internal/fsapi/` covers: an in-flight upload temp, an
  in-flight extraction temp, a real `.bashrc`, a real `.git` directory,
  and a user file that merely contains `sfext-` in its name
- [x] 5.6 Update the filesystem-API and route documentation in
  `docs/architecture.md` (route table, job seam, the scratch-name listing
  rule, and the remote-exec/non-goal note) and the filesystem-API bullet
  in `AGENTS.md`; verify `npx openspec validate --all --strict` passes and
  the documented routes match `fsapi.CustomRoutes()`

## 6. Server behaviour against the fixture

- [x] 6.1 Add the hostile-archive matrix against the in-proc SSH fixture:
  `../` traversal, absolute path, backslash separator, NUL byte, symlink
  entry, encrypted entry, invalid UTF-8 name, and the
  `a/../b.txt`+`b.txt` pair; verify every case ends `failed`, publishes
  nothing, creates no path outside the target, and leaves no scratch
  directory
- [x] 6.2 Add the cosmetic-skip test (a macOS-style archive) and verify
  the job succeeds, the target holds only real members, and the skipped
  count matches
- [x] 6.3 Add coverage for zip64, stored-only, zero-byte member, empty
  archive, and single-top-level-directory archives; verify each extracts
  byte-identically and the single-top-level case is not flattened
- [x] 6.4 Add the decompression-bomb test with a member that lies about
  its declared size; verify the job fails at the budget, publishes
  nothing, and the peak host memory assertion holds
- [x] 6.5 Add a chaos test that kills the SFTP connection at random
  points during one extraction; verify the completed tree is
  byte-identical to a clean extraction, and a concurrent `ls` never
  observes the target name partially populated
- [x] 6.6 Add the memory gate under `SF_RUN_GATES=1` using a
  multi-gigabyte archive; verify process RSS stays flat within the
  transfer budget with `SF_RUN_GATES=1 go test ./internal/archiveextract/
  -run Gate`
- [x] 6.7 Add the restart and observation-boundary tests: an abandoned
  job (simulated restart) leaves no published folder and an unknown id,
  an over-capacity request is refused retryably, and a second request for
  the same target is `409`
- [x] 6.8 Re-run the whole suite against a real OpenSSH server with
  `SF_TESTSSH_MODE=external` on the build/verification server; verify
  `posix-rename` and the `rename` fallback both publish correctly

## 7. SPA

- [x] 7.1 Add the `archive` kind to `web/src/lib/entryKind.ts` and verify
  `npm --prefix web run test` passes a unit test for `.zip` (any case) and
  non-archives
- [x] 7.2 Add `web/src/lib/extractJobs.ts` (start, poll, cancel, terminal
  snapshot, retained across navigation) plus a binding hook, modeled on
  `uploadQueue.ts`; verify unit tests with an injected API cover progress
  updates, terminal success, terminal failure mapping, cancel, and
  survival across a simulated remount
- [x] 7.3 Add the writer-only **Extract** item to
  `web/src/components/ContextMenu.tsx` for archive files and verify
  component tests show it for owner/editor and never for viewer,
  anonymous public browsing, directories, or non-archive files
- [x] 7.4 Add the extraction confirm sheet with the derived folder name,
  editing it, and the `409` path that explains the conflict and retries
  with the chosen name; verify component tests cover accept, edit,
  cancel, conflict, and invalid-name rejection
- [x] 7.5 Render extraction progress and cancel in the Uploads panel and
  the floating indicator beside uploads; verify component tests show a
  running extraction from another destination and its canceled outcome
- [x] 7.6 Refresh the browse listing when a job for the current directory
  succeeds, and map terminal failures to the existing error states
  (invalid archive, unavailable, forbidden); verify component tests cover
  the refresh and each error state, and add the Playwright flow to
  `web/e2e/file-management.spec.ts`-style coverage that runs on the
  build/verification server
- [x] 7.7 Update `docs/using-stratofold.md` (extracting an archive, what
  gets skipped, refused archives, collision handling) and the web-UI
  bullet in `AGENTS.md`; verify the documented steps match the shipped
  screens and `npm --prefix web run test` passes

## 8. Integration verification

- [x] 8.1 Update `docs/hosting.md` with the remote-disk requirement for
  the unpacked tree beside the archive and the fact that in-flight jobs do
  not survive a restart; verify the claims against the implemented
  behaviour
- [x] 8.2 Add the change to `docs/roadmap.md` under the additive follow-ons
  with its specs and validation strategy; verify `npx openspec validate
  --all --strict` passes
- [x] 8.3 Run `go vet ./... && go test ./...` and verify the full suite is
  green
- [x] 8.4 Run the gates with `SF_RUN_GATES=1 go test ./internal/fsapi/
  ./internal/archiveextract/ ./internal/sftpreadwrite/` and verify the
  memory, concurrency, and chaos gates pass
- [x] 8.5 Run `npm --prefix web run test` and the Playwright extraction
  flow on the build/verification server; verify both pass and the
  extraction is visible through the SPA end to end
- [x] 8.6 Run `npx openspec validate --all --strict` as the final harness
  check and verify it passes
