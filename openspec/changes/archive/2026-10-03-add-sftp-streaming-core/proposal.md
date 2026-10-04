# Proposal — `add-sftp-streaming-core`

## Why

Everything else in Stratofold rides on one assumption: transfers of tens
of gigabytes survive SSH disconnects and run at line rate over a single
SFTP channel. That is the highest-risk, completely unproven part of the
product (roadmap risks R1, R2, and the stream half of R6), and it must be
proven before the HTTP surface, virtual directories, or any UI exist.
This change builds and retires that risk first.

## What Changes

- New internal Go capability (no HTTP surface yet): an SSH connection
  manager that owns the lifecycle of SSH/SFTP connections keyed by
  connection config — dial on demand, 20 min idle TTL with eviction,
  exponential-backoff reconnect (base ~1 s, factor 2, cap ~5 min,
  jitter; exact timings are tunables), single connection per record for
  now behind a pooling-ready interface.
- Resumable SFTP streaming: offset-based reads and writes
  (`ReadAt`/`WriteAt` per ADR 0003) so large transfers resume at the
  last offset instead of restarting from byte zero.
- Error classification: all SFTP/SSH errors classified as *retryable*
  (network, EOF) or *permanent* (permission, not found); permanent
  errors are never retried, retryable ones ride the reconnect.
- A throwaway dockerized OpenSSH test fixture with a seeded dataset
  (including a multi-GB sparse file), built once and reused by all later
  changes' verification.

## Capabilities

### New Capabilities

- `ssh-connection-management`: lifecycle of SSH/SFTP connections —
  on-demand dial, idle-TTL eviction, backoff reconnect, host-key
  pinning enforcement, and the connection-manager seam other
  capabilities use.
- `sftp-streaming`: byte-exact offset-based reads/writes over SFTP with
  resumable transfers and retryable-vs-permanent error classification.

### Modified Capabilities

None — this is the first change; `openspec/specs/` is empty.

## Impact

- New Go module/package tree (first application code in the repo).
- New dependencies: `golang.org/x/crypto/ssh`, `github.com/pkg/sftp`
  (per ADR 0003).
- New test infrastructure: SSH/SFTP fixture (dockerized OpenSSH) used by
  integration tests.
- ADRs: **No new ADR — the durable decisions this change implements are
  already recorded** in [0001](../../docs/decisions/0001-go-server.md)
  (Go single binary) and [0003](../../docs/decisions/0003-ssh-sftp-stack.md)
  (ssh + sftp stack, host-key pinning, offset read/write seams). The
  backoff/TTL numbers stay tunables per architecture.md, so no new
  invariant to record. Affected docs: `docs/architecture.md` (SSH
  connection manager + failure/retry model sections already describe
  this behavior; update only if implementation diverges).

## Non-goals

- No HTTP surface: no `/files/*`, no `/api/sf/*` routes (changes 2+).
- No virtual directories, no PocketBase collections for
  connections/vdirs (changes 2–3); the manager is configured directly
  for tests.
- No upload/move/delete API operations (change 5) — only the streaming
  and connection primitives they will use.
- No connection pooling (single connection per record; interface seam
  only).
- No server-side copy optimization (streams through the server, per
  ADR 0003).
