# Design — `add-sftp-streaming-core`

## Context

First application code in the repo (greenfield Go module). The stack is
already decided: Go single binary (ADR 0001),
`golang.org/x/crypto/ssh` + `github.com/pkg/sftp` (ADR 0003). There is
no HTTP layer, no PocketBase embed, and no persistence yet — this change
is an internal library plus its verification harness. The behavior
contract is in the two spec deltas (`ssh-connection-management`,
`sftp-streaming`); motivation in the proposal.

## Goals / Non-Goals

Goals:

- A connection-manager package other changes can consume behind a
  narrow interface (pooling-ready seam).
- A streaming package offering offset-based read/write with
  transparent resume and error classification.
- A reusable dockerized OpenSSH test fixture, seeded (incl. a multi-GB
  sparse file), reused by later changes.

Non-goals (per proposal): HTTP surface, vdirs, PocketBase, pooling
beyond the interface seam, server-side copy.

## Decisions

### D1 — Package layout: `internal/sshconn` + `internal/sftpreadwrite`, fixture in `internal/testssh`

- `internal/sshconn`: dial, host-key pinning, idle-TTL eviction,
  backoff reconnect; exposes a `Manager` keyed by connection config
  returning a `*sftp.Client` handle plus a health/reconnect signal.
- `internal/sftpreadwrite`: offset read/write with retry-on-retryable
  and resume-at-offset; consumes `sshconn`.
- `internal/testssh`: the dockerized OpenSSH fixture harness (compose
  file + Go test helpers) — built once here, imported by later
  changes' tests.
- Rationale: keeps each spec capability in one package; internal
  because nothing outside the binary imports it.
- Alternative rejected: one monolithic package — couples lifecycle and
  streaming concerns; makes later pooling swap-in touch streaming code.

### D2 — Retry ownership lives in the operation layer, not call sites

Per architecture.md's failure/retry model: `sftpreadwrite` wraps every
operation in a retry loop that consults the error classifier; the
manager only reports connection state (healthy / reconnecting / closed).
- Alternative rejected: retries at manager level — the manager cannot
  know an operation's resume offset; only the operation can.

### D3 — Resume = explicit offset bookkeeping, not protocol features

SFTP has no transfer-resume primitive. Reads and writes carry a
caller-visible offset; on retryable failure the operation reopens the
remote handle and continues at the last confirmed offset
(`ReadAt`/`WriteAt` per ADR 0003). "Last acknowledged" for writes is
the offset of the last completed `WriteAt` chunk; for reads, the last
served chunk. File-length guard detects remote mutation → loud failure.
- Alternative rejected: restart-from-zero on failure — simplest, but
  breaks the tens-of-GB promise (R1 unretired).
- Alternative rejected: rsync-style delta protocol — far more protocol
  work for no benefit; SFTP offset semantics already give resume.

### D4 — Error classification as a small pure function

`internal/sftpreadwrite` (or a tiny shared package) maps errors:
`x/crypto/ssh` transport errors, `io.EOF`/`io.ErrUnexpectedEOF`, net
timeouts → retryable; `sftp.StatusPermissionDenied`, `sftp.SSH_FX_NO_SUCH_FILE`
and host-key mismatch from the manager → permanent. Table-driven unit
tests. Host-key mismatch is permanent by definition (spec requirement).
- Alternative rejected: `errors.Is` chains scattered at call sites —
  untestable, drifts.

### D5 — Backoff as injectable clock, timings as config

Base 1 s, factor 2, cap 5 min, full jitter — all config fields with
those defaults; tests inject a fake clock so backoff unit tests run in
milliseconds. Same for idle TTL (default 20 min): eviction is timer
driven with an injectable clock. Numbers are tunables, not invariants
(architecture.md).
- Alternative rejected: real-time sleeps in tests — slow, flaky.

### D6 — Concurrency: pipelined via `pkg/sftp` defaults, single channel

One SSH connection → one SFTP subsystem; transfers pipeline a bounded
window of offset chunks (default InFlight=32 × 32 KiB chunks ≈ 1 MiB in
flight; both tunables). Progress bookkeeping is the contiguous
acknowledged prefix — the only safe resume point; write bytes pulled
from the reader beyond it are carried to the next attempt (replay), so
a reconnect can never write the wrong bytes at the resume offset. The
SFTP max packet size is a Config tunable (`SFTPMaxPacket`, default
32 KiB). The pool of buffers — not the file size — bounds memory.
- Alternative rejected: multiple SSH connections now — pooling is an
  explicitly deferred extension; the `Manager` interface is the seam.

### D6-outcome — gate results (apply notes, 2026-10-03)

- Throughput gate (SFTP read stream vs `dd` over an exec channel,
  loopback): **0.87× in-proc fixture, 0.85× against real OpenSSH
  (external mode)** — both ≥ the 0.80 margin. The limiter is the
  x/crypto channel window (fixed 64 KiB, not configurable) plus
  per-request crypto; on RTT-bearing links both sides converge to the
  same window limit, so the relative margin holds.
- Memory gate: peak heap 3–8 MiB streaming 4 GiB in both directions.
- Chaos gate: 10 randomized kill/recover rounds per run, checksum-exact,
  in both fixture modes (R1, R6-for-streams retired; R2 retired).

### D7 — Fixture: three modes, dockerized OpenSSH primary

`internal/testssh` provides one `Start(t)` seam with three backends:

1. **docker** (primary, per original design): `docker compose` service
   (OpenSSH + baked throwaway credentials/keypair + seeded dataset incl.
   a ~4 GiB sparse file) started on demand.
2. **external**: a real, existing OpenSSH endpoint supplied via
   `SF_TESTSSH_*` env vars (host/port/user/password). Used to run the
   full suite against a genuine OpenSSH/SFTP subsystem on hosts that
   have no Docker.
3. **inproc**: an in-process `x/crypto/ssh` server serving `pkg/sftp`
   (plus a whitelisted `exec` for seeding/baselines) with a
   kill-the-connection hook — runs anywhere and makes
   kill-at-random-offset chaos deterministic.

Mode resolution: explicit option > `SF_TESTSSH_MODE` > docker if a
Docker socket/CLI is usable > inproc. Unit/table tests never need any
fixture.

**Environment note (2026-10-03, user-confirmed):** neither the dev
container nor the build/verification server can run a Docker daemon, so
docker-mode *container bring-up verification is deferred*; the compose
definition is still shipped for Docker-capable environments (future CI).
Risk retirement (R1/R2) is verified via `external` mode against real
OpenSSH, with `inproc` as the deterministic local harness.
- Alternative rejected (as sole harness): in-process Go SSH server —
  not a real OpenSSH/SFTP subsystem; the whole point is retiring R1/R2
  against the real thing, hence the docker/external modes.

## Risks / Trade-offs

- [Loopback throughput gate may be flaky on CI] → margin-based gate
  (≥80% of `dd` baseline, tunable) with generous warm-up and repeated
  runs before failing.
- [Sparse-file fixture depends on Docker in the test env] → external
  and inproc modes carry the integration coverage; docker mode ships
  for Docker-capable environments (bring-up verification deferred —
  see D7 environment note).
- [WriteAt resume can silently target a mutated remote file] →
  length+fingerprint guard at resume; mismatch fails loudly (spec).
- [Injectable clocks hide real-timer bugs] → one smoke integration
  test uses real timers against the fixture.

## Migration Plan

Nothing to migrate — new code. Rollback = delete the packages; no
consumers yet.

## Open Questions

None blocking. Chunk size and backoff numbers are config tunables;
final values settle during implementation against the throughput and
memory gates.
