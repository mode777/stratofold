# Tasks

## 1. Module scaffold and fixture

- [x] 1.1 Initialize the Go module with `golang.org/x/crypto/ssh` and `github.com/pkg/sftp` dependencies (ADR 0003); verify `go build ./...` succeeds
- [x] 1.2 Build the fixture harness under `internal/testssh` with three modes (D7): `docker` (compose service, baked keypair, seeded dataset incl. ~4 GiB sparse file), `external` (real OpenSSH via `SF_TESTSSH_*` env vars), `inproc` (in-process server + kill hook); verify `external`+`inproc` modes start/serve/authenticate locally — docker-mode container bring-up verification is **deferred** (no Docker daemon available in dev container or build server; user-confirmed 2026-10-03) and documented per 5.2
- [x] 1.3 Implement host-key pinning in `internal/sshconn` (SHA256 fingerprint match; mismatch → permanent error, connection refused); verify with fixture tests: matching fingerprint dials, wrong fingerprint aborts with a permanent error

## 2. Connection lifecycle (`ssh-connection-management`)

- [x] 2.1 Implement the `Manager` keyed by connection config with on-demand dial and single connection per config; verify fixture test: first op dials, second op reuses (no second dial observable via fixture connection count)
- [x] 2.2 Implement idle-TTL eviction with injectable clock (default 20 min); verify unit tests with fake clock: eviction fires at TTL, next operation dials fresh; one real-timer smoke test against the fixture with a short TTL
- [x] 2.3 Implement exponential-backoff reconnect (base 1 s, factor 2, cap 5 min, full jitter, injectable clock) surfacing "reconnecting" as retryable; verify unit tests assert delay sequence and cap; fixture test: drop connection (kill container network/sshd), manager reconnects without intervention
- [x] 2.4 Serialize operations through connection replacement so concurrent ops during reconnect never interleave; verify a fixture test issuing concurrent ops across an injected drop — each completes or fails retryable, none partially applied

## 3. Error classification and offset streaming (`sftp-streaming`)

- [x] 3.1 Implement the retryable-vs-permanent classifier as a pure function over `ssh`/`sftp`/net errors; verify table-driven unit test covers the class table (EOF, net timeout, permission denied, no-such-file, host-key mismatch)
- [x] 3.2 Implement offset-based `ReadAt`/`WriteAt` operations with bounded chunk buffers (default 32 KiB, bounded in-flight chunks) on top of `pkg/sftp`; verify fixture integration tests: byte-exact range reads and writes at offsets, checksum equality for full-file read and write paths
- [x] 3.3 Implement retry loop owned by the operation layer: retryable errors reopen the handle and resume at the last confirmed offset (reads: last served chunk; writes: last acknowledged `WriteAt` chunk) with length/fingerprint guard failing loudly on remote mutation; verify fixture tests: killed connection mid-read and mid-write, final checksums match after resume; mutated-remote case fails with an explicit error
- [x] 3.4 Implement permanent-error fast path (never retried); verify fixture test: permission-denied and missing-file operations return immediately with no retry attempts (assert via attempt counter)

## 4. Risk-retirement gates

- [x] 4.1 Chaos/resume test: kill the SSH connection at randomized offsets repeatedly during a single transfer; verify final checksum matches source every run (retires R1, R6-for-streams)
- [x] 4.2 Throughput gate: measure streaming throughput vs `dd`/`scp` baseline on loopback over the fixture; verify ≥80% (configurable margin) with warm-up and repeated runs (retires R2)
- [x] 4.3 Memory assertion: stream a multi-GB sparse file in both directions with peak-RSS instrumentation; verify peak memory stays within the chunk/concurrency budget, flat vs file size (supports R5 foundation)

## 5. Docs and validation

- [x] 5.1 No ADR — 0001 and 0003 already record the durable decisions; if implementation surfaces a new durable decision during apply, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note in change log if so)
- [x] 5.2 Update `docs/` and `AGENTS.md`: document the development-environment constraints (no Docker daemon in dev container or build server; Go installed user-locally at `~/.local/go`; docker-mode fixture verification deferred) and any divergence of `docs/architecture.md` SSH-connection-manager / failure-and-retry-model sections from the shipped tunables; verify docs match the shipped code
- [x] 5.3 Run the full harness: `go vet ./...`, `go test ./...` (unit + fixture integration incl. gates), and `npx openspec validate --all --strict`; verify all pass
