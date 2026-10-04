# Tasks

## 1. Data model: optional fingerprint and `remote_dir`

- [x] 1.1 Add a new migration entry `1770000003_connection_remote_dir.go` (in a new `internal/migrations/connection_remote_dir.go`; `1770000002` is taken by `vdir_shares.go`) that loads the existing `connections` collection, adds an optional `remote_dir` text field, sets `host_key_fingerprint.Required = false`, and saves it (idempotent); verify with `go test ./internal/migrations/`
- [x] 1.2 Extend the migrations authz matrix test to create a connection without `host_key_fingerprint` and with a `remote_dir`, asserting both persist and the record is readable; verify with `go test ./internal/migrations/`
- [x] 1.3 Verify existing connections keep their pinned fingerprint and ownership rules after the migration; verify with `go test ./internal/migrations/`

## 2. SSH layer: optional fingerprint and TOFU capture

- [x] 2.1 Make `sshconn.Config.HostKeyFingerprint` optional: `NewManager` validates the format only when non-empty and no longer rejects an empty value; verify with `go test ./internal/sshconn/`
- [x] 2.2 Add `sshconn.WithHostKeyCapture(func(fp string))`; in the host-key callback accept and stash the presented key when unpinned, and after a successful `ssh.NewClientConn` + `sftp.NewClient` set `m.cfg.HostKeyFingerprint` and invoke the capture hook exactly once; verify with manager tests covering capture, pinned mismatch, and failed-auth-no-pin
- [x] 2.3 Add `sshconn` manager tests: unpinned first connection captures and pins, a later mismatching key aborts as permanent, and a failed authentication does not invoke the capture hook; verify with `go test ./internal/sshconn/`
- [x] 2.4 Confirm pinned-fingerprint behavior is unchanged (matching key connects, mismatching key is `ssherr.ErrHostKeyMismatch`); verify with the existing `TestHostKeyMismatchPermanent` and `go test ./internal/sshconn/`

## 3. Connection registry: persist the captured fingerprint

- [x] 3.1 Wire `WithHostKeyCapture` in `connreg.Register` to a callback that writes the observed fingerprint back to the connection record via a direct, hook-free DB update, leaving secrets and other fields untouched; verify with `go test ./internal/connreg/`
- [x] 3.2 Ensure the capture does not invalidate the live manager (no `OnRecordAfterUpdateSuccess` firing) and that a later record read returns the pinned fingerprint; verify with `go test ./internal/connreg/`
- [x] 3.3 Carry `remote_dir` through the record plumbing where the UI needs it (record type/read); verify with `go test ./internal/connreg/` (no SSH config change)

## 4. Web UI: optional fingerprint and remote directory

- [x] 4.1 Extend `ConnectionRecord` in `web/src/lib/records.ts` with `remote_dir` and keep `host_key_fingerprint` optional; verify with `npm --prefix web run test`
- [x] 4.2 In `web/src/pages/ConnectionsPage.tsx`, drop `required` from the fingerprint field, add helper text explaining first-use pinning, add a Remote directory input, and show the remote directory in the connection list; verify with updated component tests in `npm --prefix web run test`
- [x] 4.3 In `web/src/pages/VdirsPage.tsx`, prefill `root_path` from the selected connection's `remote_dir` when creating a new vdir (editable, never overwriting on edit); verify with updated component tests in `npm --prefix web run test`
- [x] 4.4 Add component tests covering a connection saved without a fingerprint, a saved remote directory, and the vdir root-path prefill; verify with `npm --prefix web run test`
- [x] 4.5 Fix the pre-existing UI create bug surfaced by the E2E (added scope, see design.md "Scope added during apply"): include the signed-in user's id as `owner` in the connections and vdirs create payloads, since the server create rules require it; verify with updated component tests (`npm --prefix web run test`) and the server E2E

## 5. End-to-end harness

- [x] 5.1 Update `internal/e2eharness` seed so the fixture connection carries a `remote_dir` and a vdir is created through the defaulted root path; verify with `go test ./internal/e2eharness/`
- [x] 5.2 Add or extend a Playwright spec exercising connection creation without a fingerprint and the vdir root-path prefill; verify on the build/verification server with `npm --prefix web run e2e` (never a local gate)

## 6. Documentation and ADR

- [x] 6.1 Write `docs/decisions/0007-optional-host-key-tofu.md` from `docs/decisions/TEMPLATE.md` (context, decision, consequences, rejected alternatives) and add its row to `docs/decisions/README.md`; mark ADR 0003 superseded-in-part where it requires the fingerprint at creation
- [x] 6.2 Update `docs/architecture.md` with the optional/TOFU host-key policy and the connection `remote_dir` default; verify the prose matches the spec deltas
- [x] 6.3 Update `AGENTS.md` connection/vdir notes (fingerprint optional, TOFU, `remote_dir` default, new migration and verification commands); verify the guidance names the changed files and tests

## 7. Integration verification

- [x] 7.1 Run `go vet ./... && go test ./...` and confirm the full Go suite passes (including migrations, sshconn, connreg, vdir, fileserver, fsapi)
- [x] 7.2 Run `npm --prefix web run test` and confirm all component/unit tests pass
- [x] 7.3 Run `npx openspec validate --all --strict` and confirm the change validates with no errors
