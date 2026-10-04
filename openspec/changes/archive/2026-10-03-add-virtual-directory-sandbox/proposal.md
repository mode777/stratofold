# Proposal — `add-virtual-directory-sandbox`

## Why

Every file operation Stratofold will ever serve must be pinned inside a
user-chosen root on a remote host — this is the security boundary the
vision's "virtual directories" promise rides on (roadmap risk R4: path
traversal escaping the virtual directory root). It is security-critical
and strictly precedes the file server (change 4) and the write API
(change 5): both consume the sandbox; neither must be able to weaken it.
This change also completes the deferred wiring from changes 1–2:
SSH connection configs and vdirs become PocketBase records, so the
standalone connection manager of change 1 finally gets its persistence
layer.

## What Changes

- New PocketBase collections `connections` and `vdirs` (plain record
  CRUD, ADR 0002) with owner-only API rules: `connections` hold host,
  port, username, auth method (password / private key + optional
  passphrase), and the pinned host-key fingerprint; `vdirs` reference a
  connection and a root path, and carry a name and an `is_public` flag
  (flag stored now, enforced public-only in change 6).
- Connection secrets are stored encrypted at rest (never returned by
  the API), decrypted only server-side when dialing; host keys stay
  pinned per ADR 0003.
- A wiring layer that turns a `connections` record into an
  `sshconn.Manager` (change 1) and caches one manager per connection
  record — the manager registry everything later routes through.
- Lexical path resolution that anchors every virtual path at its vdir
  root: traversal (`../`), absolute paths, null bytes and redundant
  segments can never resolve outside the root.
- Symlink-escape defense: after lexical resolution, the remote absolute
  path is resolved via SFTP realpath and rejected if it leaves the
  vdir root's resolved location — a remote symlink pointing outside the
  sandbox cannot be followed.
- The resolution layer is the single seam for reaching the remote
  filesystem: resolving a virtual path yields the remote absolute path
  plus the connection's client provider, and it is the only sanctioned
  way for future HTTP routes (changes 4–6) to touch a vdir.

## Capabilities

### New Capabilities

- `virtual-directories`: the vdir sandbox — `connections`/`vdirs`
  records with owner-only management, the connection-record → SSH
  manager wiring, lexical path anchoring under the vdir root, and
  remote symlink-escape rejection.

### Modified Capabilities

None — no existing capability's requirements change; `auth-session`,
`sftp-streaming`, and `ssh-connection-management` are consumed as-is.

## Impact

- New internal package(s) for path resolution/sandbox enforcement and
  the manager registry; `internal/sshconn` and `internal/sftpreadwrite`
  stay unchanged (consumed, not modified).
- Two new PocketBase collections created via migrations with API rules;
  secrets use an encrypted-at-rest hidden field, adding one crypto
  dependency from the standard library only (no new third-party deps
  beyond what PocketBase already pulls).
- First `OnRecord`-driven wiring between PocketBase records and the SSH
  layer; server bootstrap gains the migrations.
- Verification additions: a traversal test table, symlink-escape
  integration test against the SSH fixture, an authz matrix test over
  the collections' API rules (httptest), and a resolution-maps-to-
  remote-subfolder integration test; existing fixture/gates unaffected.
- ADRs: **No new ADR — 0002** (PocketBase records + API rules for plain
  CRUD) **and 0003** (SSH/SFTP stack, pinned host keys) **already
  record the durable decisions this change implements.** Affected docs:
  `docs/architecture.md` (data-model section already sketches
  `connections`/`vdirs` — reconcile field details if implementation
  diverges) and `AGENTS.md` (dev workflow: creating records for manual
  testing).

## Non-goals

- No HTTP surface: no `/files/*` (change 4), no `/api/sf/vdirs/*/ls`,
  `mkdir`, `mv`, `rm`, `upload` (change 5) — enforcement is built as
  the internal seam those changes consume.
- No sharing: `vdir_shares`, viewer/editor roles, public-vdir anonymous
  access, and `is_public` enforcement (change 6); the flag is stored
  but has no effect yet.
- No SPA/UI for managing connections or vdirs (changes 7–8) — records
  are exercised via the PocketBase API.
- No remote filesystem mutations of its own (mkdir/mv/rm semantics are
  change 5); the sandbox only resolves and proves paths.
- No credential rotation UX, SSH agent auth, or known_hosts prompting —
  auth methods stay password / key+passphrase with a pinned fingerprint.
