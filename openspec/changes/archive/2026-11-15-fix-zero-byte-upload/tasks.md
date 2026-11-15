# Tasks

## 1. Fix transfer completion for empty input

- [x] 1.1 In `internal/sftpreadwrite/transfer.go`, settle `pipelineWrite` completion after the results loop from the final feeder state (`finished && acked >= dispatched`) when no error was recorded, so an empty input returns `done` with zero acknowledged bytes; verify `go test ./internal/sftpreadwrite/` still passes for the existing non-empty transfer, resume, and guard tests
- [x] 1.2 Add primitive regression tests in `internal/sftpreadwrite/transfer_test.go`: a declared zero-size write creates an empty remote file, an EOF-delimited empty reader creates an empty remote file, and an empty write over a non-empty file truncates it; verify with `go test ./internal/sftpreadwrite/ -run 'TestZeroLength|TestFullFileIntegrity'`

## 2. Cover the upload API behavior

- [x] 2.1 Add an fsapi regression test in `internal/fsapi/fsapi_test.go` for a zero-byte upload with an explicit `Content-Length: 0`: assert `200`, `size: 0`, an empty target file, and no leftover `.sfpart-` temp in the directory; verify with `go test ./internal/fsapi/ -run TestUploadZeroByte`
- [x] 2.2 Extend the test to an empty chunked body (unknown length) and assert the same published empty file; verify the same test run
- [x] 2.3 Extend the test to replace an existing non-empty file with an empty body, asserting the target is zero bytes and its version differs from the pre-upload stat; add a matching-`If-Match` empty upload that publishes and rotates the version; verify with `go test ./internal/fsapi/ -run 'TestUploadZeroByte|TestUploadByteExact'`

## 3. Integration verification

- [x] 3.1 Run `go vet ./... && go test ./...` and confirm the full Go suite passes with no new failures in `internal/sftpreadwrite/` or `internal/fsapi/`
- [x] 3.2 Run `npx openspec validate --all --strict` and confirm this change validates without errors
