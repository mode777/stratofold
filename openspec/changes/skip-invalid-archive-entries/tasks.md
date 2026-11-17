# Tasks

## 1. Entry-name validation accepts the directory convention

- [x] 1.1 Strip exactly one trailing `/` in `ValidateEntryName` before splitting (design D1) and update `internal/archiveextract/entry_test.go`: accept `POLY_SurvivalWorkshop/` → `["POLY_SurvivalWorkshop"]` and `docs/2026/` → `["docs", "2026"]`; keep refusing `/`, `a//`, `//`, and every existing rejection case — verify with `go test ./internal/archiveextract/ -run TestValidateEntryName`
- [x] 1.2 Teach the test fixture to emit real directory entries: extend `buildZip` in `internal/archiveextract/run_test.go` to create `zip.FileHeader` entries with trailing-slash names, and add a regression test extracting an archive containing `POLY_SurvivalWorkshop/` plus nested `POLY_SurvivalWorkshop/readme.txt` — verify the job succeeds and the folder exists

## 2. Skip records and snapshot reporting

- [x] 2.1 Add the skip record type (closed reason vocabulary `unsafe-name`, `depth`, `symlink`, `encrypted`, `unsupported-compression`, `corrupt` — design D2) and extend `Snapshot` in `internal/archiveextract/job.go` with `skippedInvalid` and a `skippedDetails` list capped at 16 records keeping the true total (design D3); verify with new `job_test.go` assertions that the cap holds and `skipped` (cosmetic) stays separate
- [x] 2.2 Update `internal/fsapi/extract_test.go`'s `jobDoc` for the new JSON fields and assert they round-trip through `GET …/extract/{jobId}` unchanged — verify with `go test ./internal/fsapi/ -run TestExtract`

## 3. Scan-time skips replace fatal validation

- [x] 3.1 Rework `scan` in `internal/archiveextract/run.go` (design D2, D6): count every central-directory record toward the entry ceiling before validation, record a skip (name + reason) instead of returning the error for name rules, depth, symlink, encrypted, and unsupported compression, and keep zip-parse, sniff, and byte-ceiling failures fatal — flip `TestExtractRefusesUnsafeEntries`, `TestExtractRefusesSymlinkEntry`, and `TestExtractRefusesEncryptedAndUnsupported` into the skip matrix (state `succeeded`, offending path absent, `skippedInvalid` and `skippedDetails` asserted, remaining entries published) — verify with `go test ./internal/archiveextract/ -run 'TestExtract'`
- [x] 3.2 Add the depth case: an entry deeper than `MaxDepth` is skipped and counted while the rest extracts, and a mostly-invalid archive still fails at the entry ceiling (design D6) — verify with a new `run_test.go` case using small `MaxEntries`/depth overrides

## 4. Corrupt-member skip with partial-file cleanup

- [x] 4.1 In `extractMember` (design D4): treat `memberReadError` as a per-member skip — remove the member's partially written scratch file via `withRetry` + `Remove` (fail the job if the removal fails), record a `corrupt` skip, and continue; keep `ErrBudget` and transient connection failures fatal — add a fixture that writes a member then corrupts its stored bytes/CRC and assert the job succeeds without the member, its partial file is gone, and other members are byte-identical — verify with `go test ./internal/archiveextract/ -run Corrupt`
- [x] 4.2 Re-check the chaos/disconnect suite still converges: transient drops resume mid-member (never classified as corrupt) — verify with `go test ./internal/archiveextract/ -run 'Chaos|Resume|Disconnect'` and `SF_RUN_GATES=1 go test ./internal/archiveextract/ -run Gate` where applicable

## 5. All-skipped guard

- [x] 5.1 After the member loop, before publish (design D5): fail with the unsupported-archive class naming the dominant skip reason when `entriesDone == 0` — cover a fully encrypted archive, an all-invalid archive, and a cosmetic-only archive (new failure, disclose in docs) — verify with `go test ./internal/archiveextract/ -run Nothing|AllSkipped|Guard` plus an `internal/fsapi/extract_test.go` case asserting the 400 and that nothing published

## 6. Web surface

- [x] 6.1 Add `skippedInvalid` and `skippedDetails` to `ExtractJobJson` in `web/src/lib/filesApi.ts` and pass them through `web/src/lib/extractJobs.ts` — verify with the tracker's unit tests
- [x] 6.2 Render the skip split in the Uploads progress row and the `ExtractSheet` result state (count by kind; sample names when present — design D7) — verify with `ExtractSheet.test.tsx` and `UploadPanel.test.tsx` cases covering mixed, invalid-only, and cosmetic-only counts via `npm --prefix web run test`

## 7. Docs

- [x] 7.1 Update the archive-extraction paragraphs that state fail-closed behavior: `docs/using-stratofold.md` (extraction bullet: skips are counted and reported, cosmetic-only archives fail), `docs/hosting.md` (refusal list: ceilings stay fatal, entries skip), and the archive-extraction section of `AGENTS.md` (skip-and-count policy, trailing-slash convention, all-skipped guard). No ADR — policy lives in the spec; ADR 0017 is untouched (proposal states this) — verify by re-reading the three docs against the delta spec for drift
- [x] 7.2 Check `README.md`'s extraction mention still holds — verify by reading its archive bullet and adjusting only if it claims whole-archive refusal

## 8. Verification

- [x] 8.1 Run the full local harness: `go vet ./... && go test ./internal/archiveextract/ ./internal/fsapi/ ./internal/migrations/` and `npm --prefix web run test` — all green
- [x] 8.2 Run the existing extraction E2E (`web/e2e/archive-extraction.spec.ts`) against the harness on the build/verification server via `npm --prefix web run e2e` to confirm the success path and UI surfaces still pass end-to-end
- [x] 8.3 Validate the change: `npx openspec validate skip-invalid-archive-entries --strict` passes
