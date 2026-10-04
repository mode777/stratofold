# 0003 — SSH/SFTP via golang.org/x/crypto/ssh + github.com/pkg/sftp

Status: Accepted (2026-10)

## Context

The vision requires direct streaming to/from SSH hosts (no host-side
caching), on-demand connections, resumable large transfers, and directory
listing/stat. The library choice hinged on streaming support.

## Decision

Use `golang.org/x/crypto/ssh` as the transport and `github.com/pkg/sftp`
as the file protocol client, one SFTP subsystem channel per SSH connection.
Auth methods: password, public key (with optional passphrase),
keyboard-interactive. Host keys are pinned: the user supplies the SHA256
host key fingerprint at connection creation; a changed key aborts the
connection and requires re-approval.

## Consequences

`pkg/sftp` exposes `ReadAt`/`WriteAt`/`ReadFrom`/`WriteTo` — HTTP Range
requests, seek, and resumable uploads/downloads are directly implementable,
and SFTP requests pipeline concurrently over the single channel. Accepted
costs: reconnection/backoff is our own code (no library support), and
SFTP's limits shape features — remote move is a rename on the same
filesystem, and remote copy streams through the server (no server-side
copy).

## Rejected alternatives

- `go-scp` / exec-wrapped `scp`: no listing, stat, seek or rename.
- FTP/WebDAV clients: out of scope — Stratofold is an SSH client.
- Implementing SFTP directly on `x/crypto/ssh`: unnecessary protocol work;
  `pkg/sftp` is the de-facto standard client for it.
