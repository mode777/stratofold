# 0015 — Content versions from publication generations plus remote signatures

Status: Accepted (2026-11, change `add-file-stat-and-conditional-upload`)

## Context

A browser editor needs a single-path validator that changes on every
save and a way to reject a stale write atomically. The existing `ls`
entry has no version, and the file server's ETag is `size + mtime` in
whole seconds, so a same-length save inside one second is invisible.
SFTP v3 exposes only whole-second mtimes and has no remote
compare-and-swap, while the product promise forbids reading whole files
just to answer a metadata request. See
`openspec/changes/add-file-stat-and-conditional-upload/` for the full
process record and `openspec/specs/filesystem-api/spec.md` for the
behavior contract.

## Decision

Every sandbox-resolved file or directory has an opaque version:

```
v1- base64url(SHA-256(
  "stratofold-file-version" |
  vdir id | connection id | resolved remote path |
  kind | size | whole-second mtime | publication generation
)[:16])
```

The **publication generation** is a durable counter stored in the
internal `file_versions` collection, keyed by `(vdir, remote_path)`. It
is incremented before an upload's atomic rename and rolled back only
when that same reservation is still current. `ls`, `stat`, the
`/files` ETag (quoted strong form), and conditional upload all use this
one value. The ETag is the version, not a second validator.

A conditional upload (`If-Match`) compares strongly at publish time,
under a process-local per-target mutex; the generation reservation makes
the check and the rename behave as one publication for concurrent
requests. A `412` leaves the target untouched and removes the temp.

External SFTP edits are detected through the remote signature (size and
whole-second mtime). The residual is explicit: an external edit that
preserves both, or a delete/recreate with the same signature, cannot be
distinguished without reading content. A metadata-only `touch` rotates
the version (a safe, spurious conflict); `chmod` does not.

## Consequences

- Metadata operations stay bounded: no file bytes are read for a
  version, and the store holds only counters — no content, size, mtime,
  or hash — so it is not a file cache.
- Same-size/same-second writes through Stratofold always rotate the
  version; repeated observations with the same signature and generation
  are stable across restarts.
- ETags change once on upgrade; `If-None-Match`, `If-Modified-Since`,
  Range, and `HEAD` semantics are unchanged. `If-Modified-Since` keeps
  its whole-second blind spot; the ETag is the authoritative validator.
- A crash between the reservation and the rename can only over-rotate
  the generation (a spurious `412`), never leave new bytes under an old
  version. A concurrent read in that window may briefly see the new
  version with the old bytes.
- The lock is in-process only, matching the single-node/SQLite
  deployment (ADR 0001). External writers can still race the
  publish-time stat and rename; that stat→rename window is accepted.
- The version is a validator, not a credential or an authorization
  input.

## Rejected alternatives

- **Content hash as the version** — correct for every external edit, but
  `ls`/`stat`/ETag would have to read every file; listing large files
  becomes a full download and the no-cache promise forbids keeping a
  content index. Upload-time hashing alone cannot serve existing files.
- **Publication revision only, without the signature** — cheap, but
  external SFTP edits never bump it and become invisible.
- **The old `size + mtime` ETag only** — no state, but same-size
  same-second saves collide and there is no value to compare.
- **High-resolution mtime** — SFTP v3 carries whole seconds; a writer
  that restores mtime still collides.
- **Remote xattr or `.sfver` sidecar** — adds remote state, permissions,
  copy/rename inconsistency, and cleanup; SQLite is the durable store.
- **A vdir-wide or distributed lock** — unnecessary contention in a
  single-node product, and neither can serialize external SFTP clients.
- **Bump the generation after the rename** — a crash in the window
  leaves new content under the old version, the exact silent overwrite
  conditional upload exists to prevent.
