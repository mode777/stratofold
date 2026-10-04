# Proposal — `add-filesystem-api`

## Why

Changes 1–4 built the machinery and the read side: resumable SFTP
streams, cookie sessions, the vdir sandbox, and the `/files/*` file
server. Stratofold still cannot write anything to a remote host — no
listing for the UI to render, no upload, no rename or delete. This is
roadmap change 5, the write path sketched in `docs/architecture.md`:
`/api/sf/*` listings, mutations, and uploads. It retires **R5** (large
uploads buffered in RAM/disk on the host — violates "stream, don't
cache") and the **R6 remainder** (a retry partially applying or
duplicating a mutation) for mutating operations, the last two
core-promise risks without a proven mechanism.

## What Changes

- New `POST /api/sf/vdirs/{vdirId}/…` surface on the embedded
  PocketBase router: `ls`, `mkdir`, `mv`, `rm`, `upload` — the
  endpoint set of `docs/architecture.md`. All custom routes stay under
  `/api/sf/` per the route-collision invariant.
- Every operation resolves through the vdir sandbox (lexical anchoring
  + server-side symlink walk) before any SSH dial; rejections and
  missing targets are `404`, consistent with `/files/*`.
- Access control decided before dialing: non-public vdirs serve only
  the owner's `sf_session` session for every operation; public vdirs
  additionally allow anonymous `ls` (read-only) — writes stay
  owner-only until sharing exists (change 6).
- `ls` returns JSON directory entries (name, size, type, modification
  time); `mkdir` creates missing parents and treats an existing
  directory as success; `mv` renames within the vdir (replacing an
  existing target); `rm` deletes recursively server-side.
- `upload?path=…` streams the request body straight into bounded SFTP
  chunk writes — peak host memory stays flat for multi-GB uploads, no
  host-side buffering (R5). The bytes land under a temporary name and
  are renamed to the target only after the final byte is acknowledged:
  an interrupted or unresumable upload leaves **no file at the target
  path**, and a mid-upload disconnect resumes at the last acknowledged
  offset instead of restarting.
- Mutating operations are idempotent per operation and retried
  transparently across injected disconnects — never partially applied,
  never duplicated (R6): read-only ops re-run freely, `mkdir` treats
  already-exists as success, `rm` treats not-found as success, `mv`
  detects its own already-applied state.
- Error classification carries to the HTTP surface: retryable
  failures are retried through the connection manager's backoff within
  the request; permanent failures are mapped deterministically without
  retry; upload/streaming routes clear per-request deadlines.
- Parallel API operations multiplex safely over the single managed
  SFTP channel (per-transfer bounded windows; no cross-request
  serialization added).

## Capabilities

### New Capabilities

- `filesystem-api`: the `/api/sf/*` write-and-list surface — sandboxed
  `ls`/`mkdir`/`mv`/`rm` operations, owner/public access control,
  streamed atomic uploads with offset resume, idempotent mutation
  retries across disconnects, deterministic error mapping, and safe
  concurrency over the managed connection.

### Modified Capabilities

None — `virtual-directories`, `auth-session`, `ssh-connection-management`,
and `sftp-streaming` are consumed as-is (the resolver, session
middleware, connection manager, and transfer pipeline are unchanged;
the upload helpers added to `internal/sftpreadwrite` are new internal
surface, not a change to its pinned behavior — same situation as
change 4's ranged-read addition).

## Impact

- New `internal/fsapi` package (route registration, handlers, the
  mutation/upload operation layer) wired in `internal/appserver.Install`;
  small additive helpers in `internal/sftpreadwrite` (temp-target
  upload + rename) and one additive resolver method in `internal/vdir`
  (`ResolveAncestor`: sandbox-checked partial resolution for
  create-type operations — pinned behavior unchanged, see design D5
  apply corrections); `internal/authbridge`, `internal/connreg`,
  `internal/sshconn`, `internal/ssherr` consumed unchanged.
- No new collections, no migration, no new third-party dependencies.
- Verification additions per the roadmap row: per-operation integration
  tests against the SSH fixture (nested paths, recursive rm); retry
  tests with injected disconnects during `ls`/`mkdir`/`mv`/`rm`/upload
  (transparent retry, never partially applied; upload resumes at the
  last offset); upload memory-ceiling gate (multi-GB upload, flat peak
  RAM); atomicity test (interrupted upload leaves no file at the
  target path); concurrency test (parallel operations over the single
  channel without interleaving corruption). All run against the
  existing fixture (in-proc locally; external OpenSSH on the build
  server); memory gates under `SF_RUN_GATES=1`.
- ADRs: **No new ADR — 0003** (SSH/SFTP stack, offset streaming, host
  key pinning) already records the durable decisions this change
  implements; the retry model and endpoint set are already pinned in
  `docs/architecture.md`. Affected docs: `docs/architecture.md`
  (reconcile the `/api/sf/*` section with the shipped handlers) and
  `AGENTS.md` (dev/verification notes if workflows change).

## Non-goals

- No sharing or roles: `vdir_shares`, viewer/editor enforcement, and
  full public browse semantics are change 6; here non-public vdirs are
  strictly owner-only and public vdirs only gain anonymous `ls`.
- No write methods on `/files/*` and no listing there — listing stays
  API-only (change 4's contract).
- No SPA or upload queue (changes 7–8); no upload progress protocol —
  the body is the raw file stream, progress is client-side.
- No rename across vdirs or connections, no server-side remote copy
  optimization, no move-to-trash, no versioning.
- No quota/size limits, multipart/form parsing, checksum
  verification endpoint, or directory-pagination protocol (large
  listings are returned whole — accepted trade-off, see design).
- No stale-temp reaper beyond failure-path cleanup of this change's
  own uploads; no connection pooling (future extension per
  `docs/architecture.md`).
