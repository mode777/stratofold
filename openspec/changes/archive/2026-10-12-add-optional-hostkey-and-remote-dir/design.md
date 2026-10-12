# Design — `add-optional-hostkey-and-remote-dir`

## Context

See `proposal.md` — Why. The relevant current state:

- `connections.host_key_fingerprint` is `Required: true`
  (`internal/migrations/migrations.go`), and the migration is already
  applied, so a new migration must alter the existing collection rather
  than edit the applied one.
- `sshconn.NewManager` rejects an empty fingerprint
  (`internal/sshconn/manager.go:105`) and `sshClientConfig` compares the
  presented key to the pinned value, returning
  `ssherr.HostKeyMismatch` (permanent) on mismatch
  (`manager.go:336-346`).
- `connreg.Registry.configFromRecord` copies the fingerprint into
  `sshconn.Config` (`internal/connreg/connreg.go:147`), and the
  `OnRecordAfterUpdateSuccess` hook invalidates the cached manager on any
  record update (`connreg.go:60-63`).
- The vdir sandbox reads only `vdirs.root_path`; the connection has no
  path field (`internal/vdir/vdir.go:161-189`).
- The UI connection form marks the fingerprint `required`
  (`web/src/pages/ConnectionsPage.tsx:274`) and the vdir form has no
  connection-derived default (`web/src/pages/VdirsPage.tsx:208`).

## Goals / Non-Goals

**Goals:**

- Make the fingerprint optional end to end (record, SSH manager, UI) while
  keeping pinned-fingerprint behavior byte-for-byte for existing records.
- Capture and persist the host key on the first *successfully
  authenticated* connection, then enforce it on every later connection.
- Persist the captured fingerprint without dropping the live connection
  that just established it.
- Add `remote_dir` to the connection record and surface it in the UI as
  the default `root_path` for new vdirs.

**Non-Goals:**

- No interactive key-approval prompt, `known_hosts` import/export, key
  history, or rotation workflow.
- No server-side semantics for `remote_dir` beyond being stored: it is a
  default consumed by the UI, not a sandbox root.
- No change to vdir resolution, the `/files` server, or the filesystem
  API.

## Decisions

### D1 — Fingerprint optional at every layer

- Migration: set `host_key_fingerprint.Required = false` and add
  `remote_dir` (text, optional) via a **new** migration entry
  (`1770000003_connection_remote_dir.go`; `1770000002` is already taken by
  `vdir_shares.go`), because `1770000001_connections_vdirs.go` is already
  applied.
- `sshconn.Config.HostKeyFingerprint` stays a string; `NewManager` only
  runs `validateFingerprint` when it is non-empty, and the
  "fingerprint is required" error is removed.
- UI: drop `required` from the fingerprint input and add helper text.

Alternative considered: keep the field required and auto-generate a
placeholder fingerprint — rejected (a fake pin silently breaks the first
connection).

### D2 — TOFU capture in the SSH layer, invoked after successful auth

Add `sshconn.WithHostKeyCapture(func(fp string))`. In
`sshClientConfig`'s host-key callback, when `cfg.HostKeyFingerprint == ""`
accept the key and stash `Fingerprint(key)` in a per-manager field;
when a fingerprint is pinned, keep the existing compare-and-reject. After
`ssh.NewClientConn` **and** `sftp.NewClient` succeed in `dial`, if the
manager was unpinned and a key was captured, set
`m.cfg.HostKeyFingerprint = captured` and invoke the capture hook once.

Alternatives considered:

- *Capture inside the host-key callback* — pins a key from a host that
  then fails authentication; rejected (see spec scenario "Failed
  authentication does not pin").
- *A separate "scan fingerprint" route* — more API surface and a second
  connection; rejected.
- *Leave the fingerprint empty forever and always accept* — rejected; the
  user chose TOFU, and the "Host key changes abort" guarantee must survive.

### D3 — connreg persists the captured fingerprint without invalidating the live manager

`connreg.Register` wires `WithHostKeyCapture` to a callback that writes the
observed fingerprint back to the connection record. The existing
`OnRecordAfterUpdateSuccess` invalidation would tear down the manager that
just pinned, so the capture path persists with a **direct DB update**
(`UPDATE connections SET host_key_fingerprint = {:fp} WHERE id = {:id}`)
that does not fire record hooks, and updates the live manager's
`cfg.HostKeyFingerprint` (done in D2) so its own reconnects verify against
the captured value.

Alternatives considered:

- *`app.Save` the record and let the hook invalidate* — rejected: drops a
  healthy connection and can thrash on every first connect.
- *Teach `Invalidate` to ignore fingerprint-only updates* — rejected:
  record-event payload diffing is fragile, and the direct update is
  smaller and testable.
- *Keep the pin in memory only* — rejected: it would not survive restart.

### D4 — `remote_dir` is a record-only default

`remote_dir` lives on the connection record and is not added to
`sshconn.Config` (the SSH layer never uses it). The vdir sandbox keeps
reading the authoritative, absolute `vdirs.root_path`; `remote_dir` is
only the default the UI seeds that field with. A non-absolute or empty
`remote_dir` is allowed and simply yields no prefill (the existing vdir
resolver still rejects a non-absolute `root_path`).

Alternative considered: make the vdir root relative to `remote_dir` or
drop `root_path` — rejected (changes the sandbox contract; proposal
Non-goals).

### D5 — UI prefill on connection selection when creating

In `VdirForm`, make `root_path` controlled. When `existing` is null and the
selected connection changes, set `root_path` to that connection's
`remote_dir` if non-empty; a manual edit wins until the connection is
changed again. Editing an existing vdir never overwrites `root_path`.

### D6 — New ADR for the host-key policy

Record the optional/TOFU policy as **ADR `docs/decisions/0007-optional-host-key-tofu.md`**,
add it to the `docs/decisions/README.md` index, and mark ADR 0003 as
superseded-in-part (link forward) where it states the user must supply the
fingerprint at creation.

## Risks / Trade-offs

- **TOFU first-connection window** (a MITM on the very first connection is
  pinned) → accepted and documented; a user who knows the fingerprint can
  still pin it up front, restoring the old guarantee.
- **Direct DB update bypasses record hooks/validation** → scoped to a
  single non-secret column; covered by a connreg test asserting secrets and
  other fields are untouched and the live manager survives.
- **Concurrent first connects to one record** → both capture the same key;
  the write is idempotent, and each manager sets its own cfg so neither
  re-captures.
- **`remote_dir` diverges from the vdir root** → intentional: the vdir
  root stays authoritative; the field only seeds the form.
- **Existing connections with a fingerprint** → unaffected; the migration
  does not rewrite their values.

## Migration Plan

1. New migration `1770000003_connection_remote_dir.go` loads
   `connections`, adds `remote_dir`, and sets
   `host_key_fingerprint.Required = false`; idempotent and safe
   on existing data (fingerprints preserved, `remote_dir` empty).
2. Deploy backend, then frontend; the API is backward compatible (an
   omitted fingerprint is now valid, `remote_dir` is additive).
3. Rollback: the added column and optional flag are inert if the frontend
   is rolled back; no data migration is needed in either direction.

## Scope added during apply

- **UI create payloads must carry `owner`**: the new E2E spec surfaced a
  pre-existing bug (change 7) — the `ConnectionsPage`/`VdirsPage` create
  payloads omitted the required `owner`, so real-server creation returned
  `400` even though the mocked component tests passed. Fixed here by
  including the signed-in user's id on create (never on update, so
  ownership cannot be rebound). No ADR: this is a bug fix against the
  existing `connections`/`vdirs` create rules, not a durable architecture
  decision.

## Open Questions

None.
