# 0007 — Optional pinned host key with trust on first use

Status: Accepted (2026-10)

## Context

ADR 0003 pinned host keys: the user had to supply the SHA256 fingerprint
at connection creation, and a changed key aborts the connection. Requiring
the fingerprint up front blocks a first-time user who does not already
know the host key (or has no shell to run `ssh-keyscan`). The change
`add-optional-hostkey-and-remote-dir` makes the fingerprint optional.

## Decision

A `connections` record's `host_key_fingerprint` is optional. When set,
every connection verifies the remote key against it and a mismatch is a
permanent error (`ssherr.ErrHostKeyMismatch`, `internal/sshconn`). When
unset, the SSH manager accepts the key presented by the first
**successfully authenticated** connection, pins it in memory, and reports
it through `WithHostKeyCapture`; `internal/connreg` persists it to the
record with a hook-free DB update (so the live manager is not torn down).
Every later connection verifies against the captured value.

## Consequences

- Trust on first use: a MITM on the very first connection is pinned. A
  user who knows the fingerprint can still pin it up front, restoring the
  original guarantee.
- Pinning happens only after handshake and authentication succeed, so a
  host that fails authentication is never pinned.
- Existing connections with a fingerprint behave exactly as before; the
  migration only drops the required flag.
- Re-approval after a genuine host-key change is the existing owner-edit
  path (change the fingerprint on the record).
- The `remote_dir` field added alongside is record-only (a UI default for
  vdir root paths) and is not part of this decision.

## Rejected alternatives

- Keep the fingerprint required with a placeholder value: silently breaks
  the first connection.
- Pin inside the host-key callback (before authentication): pins a key
  from a host that never authenticates.
- Keep the pin in memory only: does not survive a restart.
- Persist via `app.Save` and let the update hook invalidate the manager:
  drops a healthy connection and can thrash on every first connect.
