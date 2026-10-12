# Proposal — `add-optional-hostkey-and-remote-dir`

## Why

Two frictions keep a first-time user from creating a working connection.
First, a connection cannot be saved without a pinned host-key fingerprint
(ADR 0003, `host_key_fingerprint` is `Required: true`), so a user who does
not already know the host's fingerprint — or who has no shell to run
`ssh-keyscan` — is stuck before their first browse. Second, a connection
records only *where the host is*; the remote directory a user actually
works in (their home, e.g. `/home/`) is re-typed on every vdir they
create. This change makes the fingerprint optional with trust-on-first-use
pinning and gives the connection a default remote directory.

## What Changes

- **Host-key fingerprint becomes optional on a connection.** A connection
  may be created without `host_key_fingerprint`. On the first successful
  connection the presented host key is captured and pinned back onto the
  connection record (trust on first use, TOFU); every later connection
  verifies against the pinned value, and a changed key still aborts with
  the existing permanent mismatch error. When a fingerprint *is* supplied
  it is verified from the first connection onward (no behavior change for
  existing records).
- **TOFU capture is server-side and automatic.** The SSH layer reports the
  observed fingerprint only after a fully successful handshake and
  authentication; the connection registry persists it without dropping the
  live connection. The user never has to copy a fingerprint by hand.
- **Connection gains a remote directory (`remote_dir`).** A new field on
  the connection record holds the default base directory (e.g. `/home/`).
  It is used as the default `root_path` when creating a vdir on that
  connection; each vdir keeps its own `root_path` (prefilled from the
  connection, editable), so the sandbox and resolution behavior are
  unchanged.
- **UI: fingerprint is no longer required and the remote directory is
  editable.** The connection form makes the fingerprint optional (with
  helper text explaining TOFU) and adds a Remote directory field; the
  connection list shows it. The vdir form prefills `root_path` from the
  selected connection's `remote_dir` when creating a new vdir.
- **BREAKING (record shape only):** `connections.host_key_fingerprint`
  moves from required to optional, and a new `connections.remote_dir`
  field is added. Existing records keep working (fingerprint still
  honored); `remote_dir` is empty until set.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ssh-connection-management`: the "Host key changes abort the connection"
  requirement changes — the pinned fingerprint becomes optional, and an
  unpinned connection captures and pins the host key on first successful
  connect before enforcing mismatch aborts thereafter.
- `virtual-directories`: the "Connections are owner-managed records"
  requirement changes — a connection's field set includes an optional
  pinned fingerprint and a default remote directory; vdir creation may
  default its root path from the bound connection's remote directory.
- `web-ui`: the "Connections are manageable in the UI" requirement
  changes — the fingerprint is optional (TOFU helper) and the form carries
  the remote directory; the "Vdirs are manageable in the UI" requirement
  changes — the vdir form defaults its root path from the selected
  connection.

## Impact

- **Backend**: `internal/migrations/migrations.go` (drop `Required` on
  `host_key_fingerprint`, add `remote_dir` to `connections`),
  `internal/sshconn` (optional fingerprint, TOFU capture hook, manager
  validation), `internal/connreg` (wire the capture hook to persist the
  observed fingerprint without invalidating the live manager; carry
  `remote_dir` in the manager config or leave it record-only),
  `internal/vdir` (no sandbox change; the connection's `remote_dir` is a
  default, not an implicit root).
- **Frontend**: `web/src/lib/records.ts` (connection type gains
  `remote_dir`, fingerprint optional), `web/src/pages/ConnectionsPage.tsx`
  (optional fingerprint + remote-directory field), `web/src/pages/VdirsPage.tsx`
  (prefill `root_path` from the selected connection).
- **Tests/fixtures**: `internal/sshconn` manager tests (TOFU capture,
  unpinned accept, pinned mismatch), `internal/connreg` (capture persists,
  no manager invalidation), `internal/migrations` authz matrix (new field,
  optional fingerprint), `internal/e2eharness` seed, and the web component
  tests for the two forms.
- **Docs**: `docs/decisions/` — **new ADR `docs/decisions/0007-optional-host-key-tofu.md`**
  (it changes ADR 0003's "user supplies the fingerprint at creation"
  host-key policy and records the TOFU trade-off; ADR 0003 is marked
  superseded-in-part by linking forward). `docs/architecture.md` (host-key
  and connection-record notes) and `AGENTS.md` (connection fields,
  fingerprint-optional/TOFU verification notes).
- **Compatibility**: no migration of existing data required; existing
  connections with a fingerprint behave exactly as today. A connection
  created without a fingerprint is pinned on first use and behaves as
  pinned thereafter.

## Non-goals

- No interactive "is this key correct?" approval prompt: TOFU pins the
  first successfully authenticated key silently (a later mismatch aborts
  and requires the owner to edit the fingerprint — the existing
  re-approval path).
- No `known_hosts` file import/export, no fingerprint-history or key-rotation
  workflow, no multi-key support.
- No change to the vdir sandbox: `remote_dir` is a form default, not an
  implicit second root; `root_path` stays authoritative and absolute.
- No relative vdir root paths, no per-vdir sub-path field, no change to
  the `/files` or filesystem-API behavior.
- No connection health-check or "test connection" button, no SSH-agent or
  certificate auth, no password/key changes.
