# Design — `add-filesystem-api`

## Context

The seams this change consumes all exist and are proven: `internal/vdir`
resolves a virtual path to a server-resolved remote path plus a
`sshconn.ClientProvider` (fail-closed before dialing); the provider's
`Client`/`Invalidate` pair plus `ssherr.Classify` is the retry substrate
(`sftpreadwrite.WriteChunkAt` already demonstrates the retry-loop shape
for non-stream operations); `sftpreadwrite.Transfer.WriteAll` streams a
reader into bounded pipelined remote writes, resuming at the last
acknowledged offset across drops; `internal/authbridge` owns session
validation and `internal/fileserver.handle` established the
authorize-before-dial handler order and the 401/403/404 semantics this
change mirrors. `docs/architecture.md` fixes the endpoint set and the
failure/retry model; motivation and scope: proposal.md; behavior
contract: the `filesystem-api` spec delta.

## Goals / Non-Goals

**Goals:**

- One new handler package that turns HTTP requests into sandboxed SFTP
  operations, with every remote-access-shaped concern (containment,
  reconnection, classification, bounded buffers) delegated to the
  existing seams — plus one additive resolver method for create-type
  operations (see D5 apply corrections).
- Mutations whose retry behavior is *derived from the operation's
  semantics* (idempotency per operation), not bolted on per call site.
- Uploads that honor "stream, don't cache" end to end and publish
  atomically.

**Non-Goals:**

- No sharing/roles, SPA, upload queue, `/files/*` writes, cross-vdir
  moves, quotas, multipart, pagination, stale-temp reaper, pooling —
  see proposal Non-goals.
- No changes to the resolver, session bridge, connection manager, or
  existing transfer methods' behavior.

## Decisions

### D1 — Route shape and request encoding

`internal/fsapi` registers `POST /api/sf/vdirs/{vdirId}/{op}` for
`ls`, `mkdir`, `mv`, `rm` on the PocketBase router (`appserver.Install`,
next to the file-server group), plus
`POST /api/sf/vdirs/{vdirId}/upload?path=…`. JSON bodies:
`{"path": …}` (`ls`, `mkdir`, `rm`), `{"path": src, "to": dst}` (`mv`);
empty/absent `path` means the vdir root for `ls`. Upload takes the
target in the query string and the raw bytes as the body — the body *is*
the file stream. `vdirId` arrives percent-decoded from the mux (the
same single-decode edge as file-server D1); the upload query value gets
one `QueryUnescape` at the handler edge; JSON body paths need no
decoding — they are handed to the resolver verbatim.

*Rejected:* `GET` for `ls` — the architecture sketch pins `POST` for
the whole operation set; one shape keeps the access-control and
deadlines story uniform. *Rejected:* multipart/form upload — parsers
spool bodies to disk or memory, exactly what R5 forbids; a raw body
streams through unchanged. *Rejected:* path-in-URL for every operation
(`POST …/ls/<path...>`) — JSON bodies avoid double-encoding pitfalls
and keep one decoding story per surface; the upload query param is the
sketch's pinned exception.

### D2 — Authorize before dial, mirrored from the file server

Handler order for every route: load the vdir record (SQLite) → access
decision → resolve (may dial) → operate. Non-public vdirs: a valid
`sf_session` of the owner, inline like `fileserver.handle` (cookie →
`FindAuthRecordByToken` → owner match). Public vdirs: anonymous `ls`
passes; `mkdir`/`mv`/`rm`/`upload` still require the owner's session —
public means read-only (change 6 will generalize this step for shares).
`401`/`403`/`400`/`404` on the decision path never wake an SSH
connection.

*Rejected:* resolve-first, authorize-after — dials SSH for anonymous
garbage; breaks the fail-closed property end to end. *Rejected:* a
shared middleware doing vdir+authz lookup for all routes — the lookup
result (the vdir record) is also needed by the handler; passing it
through context adds indirection for one read; change 6 can lift it
when the matrix grows.

### D3 — One retry helper; idempotency declared per operation

A single ops helper in `internal/fsapi` (e.g.
`withRetry(ctx, provider, maxAttempts, fn)`) acquires the client,
runs `fn(cl)`, and on a retryable classification invalidates and loops
— the `WriteChunkAt` shape. Each operation supplies its
already-applied semantics:

- `ls`/`stat`: pure reads, re-run freely.
- `mkdir`: walk missing parents creating each; a "file exists" /
  "already exists" classification on any component counts as success.
- `rm`: post-order walk (D4); any component already gone (not found)
  counts as deleted.
- `mv`: on retry, `stat` both ends — source present → rename again
  (PosixRename overwrites, same end state); source gone and target
  present → already applied, success; both gone → permanent "nothing
  to move".
- `upload`: not in this helper — stream resume is `sftpreadwrite`'s
  job (D5).

*Rejected:* retry logic inline in each handler — the architecture's
retry model puts it in the operation layer; per-handler loops drift.
*Rejected:* a generic `internal/sftpops` package — one consumer today;
lifting it out is mechanical if change 6 needs it. *Rejected:* making
"already applied" detection part of the connection manager — the
manager knows connections, not filesystem semantics.

### D4 — Recursive rm: post-order Lstat walk, links never followed

Resolve the target through the sandbox (containment on the target
itself), then walk with `Lstat` only: files and symlinks are removed
as themselves (`Remove`), directories recursed then `Rmdir` after
their content. A symlink inside the tree pointing outside is deleted
as a link — the walk never follows it, so containment cannot leak
through the delete path. Per-entry not-found during retry = already
deleted (D3).

*Rejected:* `RemoveDirectory`-only non-recursive `rm` — the roadmap
pins "delete is recursive server-side". *Rejected:* following symlinks
during the walk (delete targets) — would delete content outside the
tree. *Rejected:* `FindRecordById`-style bulk protocols — SFTP has
none; the walk is the primitive.

### D5 — Upload: temp name in the target directory, rename at the end

After resolution, derive the temp name from the resolved target:
`.<base>.sfpart-<random>` in the same remote directory (same
filesystem → rename is atomic and never crosses the sandbox boundary —
the temp path is `resolved + suffix`, inside the root by
construction). Stream the body with `Transfer.WriteAll(tempPath)`:
first attempt creates+truncates, retries resume at the acknowledged
offset with the existing size guard; `Content-Length` (when present)
is the declared size, chunked bodies stream to EOF. After
acknowledged completion, publish with `PosixRename` (atomic replace of
an existing target — upload-over-existing is consistent with `mv`).
Any failure that abandons the upload — permanent error, unresumable
resume guard, exhausted attempts, client disconnect — removes the temp
file best-effort before returning, so no file exists at the target
path and the partial is gone. `ClearStreamDeadlines` binds on the
route; the request context cancellation aborts the remote write.

*Rejected:* writing directly to the target and truncating on failure —
partial content visible at the target violates the atomicity
requirement. *Rejected:* temp names outside the target directory (e.g.
a scratch vdir) — cross-directory rename is not atomic and may cross
filesystems. *Rejected:* client-driven two-phase publish (upload to
temp, second call to commit) — extra round trips and an orphaned-temp
surface the server can own instead. *Rejected:* `fsync`-before-rename
durability (`fsync@openssh.com`) — the spec pins namespace atomicity,
not crash durability; noted as a future hardening if needed.

*Apply corrections (apply-phase discoveries, same decisions tightened):*

- *The sandbox needs a create-type seam.* `vdir.Resolve` requires the
  full virtual path to exist on the remote, so it can never address a
  new file or a fresh `a/b/c` chain. Added `vdir.ResolveAncestor`
  (additive, same fail-closed ordering and containment): it resolves
  the deepest existing ancestor server-side and returns the not-yet-
  existing lexical tail; create-type operations materialize the tail
  under the contained anchor and cannot leave the sandbox. `rm` reuses
  it for idempotent delete semantics (missing target = already gone —
  a retry of a completed rm succeeds instead of 404-ing).
- *A truncated body must never publish.* An aborted request body
  surfaces as an ordinary reader EOF, indistinguishable from a clean
  end of stream: `sftpreadwrite.WriteAll` would report success and the
  handler would publish a truncated file at the target. The handler
  therefore validates the published byte count against the declared
  `Content-Length` and the request context before publishing, and
  abandons (temp removed, nothing at the target) otherwise. Caught by
  the client-cancellation test.
- *PocketBase caps request bodies by default* (`BodyLimit` bound on
  the whole router). The upload route unbinds the default limit — the
  same treatment PB gives its own backup-upload route — since the body
  IS the file stream; the JSON operation routes keep the default.

### D6 — Deterministic error mapping

One mapping function used by all handlers, applied *after* the
retry/operation layer reports a final error:
sandbox rejections (lexical, escape, invalid config), unknown vdir,
and not-found → `404`; permission-denied → `403`; invalid request
shape (bad JSON, missing/absolute target, `mv` onto the same path) →
`400`; retryable-class exhaustion → `503`; anything unclassified →
`500`. `mkdir`-exists and `rm`-missing never surface (success by D3).

*Rejected:* leaking `sftp.StatusError` codes verbatim — server-specific
codes make the API surface non-deterministic; the mapping table is the
contract. *Rejected:* `404`-ing sandbox rejections only on the read
surface — uniformity with `/files/*` is the point; a client that can
distinguish "rejected" from "missing" has learned something about the
remote.

### D7 — Concurrency: none added

Parallel requests multiplex over the manager's single SFTP client via
the existing refcount; `pkg/sftp` multiplexes packets over the one
channel and its client is goroutine-safe. Per-transfer memory stays
~2 × InFlight × ChunkSize (per upload/download), so N concurrent
uploads cost N × bounded, not N × filesize. The roadmap's
concurrency validation (parallel ops, no interleaving corruption) is
the gate; if it ever starves, a semaphore is the designed-in seam —
not built now.

*Rejected:* per-vdir operation mutex — serializes independent hosts'
work behind one vdir's traffic for a problem with no observed
instance; the change-1 throughput gate would justify it. *Rejected:*
one SFTP channel per in-flight request — pooling is a declared future
extension; the manager interface remains the seam.

## Risks / Trade-offs

- [`PosixRename` is an OpenSSH extension; servers without it cannot
  replace-on-rename] → the pinned stack is OpenSSH (ADR 0003, the
  fixture); on servers lacking the extension, `mv`/upload-over-existing
  returns a deterministic permanent error instead of corrupting or
  silently skipping — behavior noted in design, fixture-proven
  elsewhere.
- [mv already-applied detection is TOCTOU-ish (source gone + target
  present could also be a concurrent third-party move)] → accepted:
  single-owner API today, narrow window, and the convergent end state
  equals single application; change 6's editor role widens exposure —
  flagged there.
- [Stale `.sfpart-*` temps survive hard process death] → they are
  visible dot-entries in listings, never at target paths; a reaper is
  an explicit non-goal; the namespaced prefix makes manual cleanup
  safe.
- [Large listings materialize whole in RAM (one entry slice per
  response)] → accepted trade-off: bounded by directory entry count,
  orders of magnitude below the file-streaming budgets the gates
  pin; pagination stays a change-7 decision if the UI ever needs it.
- [Retry loops lengthen worst-case mutation latency] → bounded by
  MaxAttempts with the manager's backoff; permanent errors return
  immediately; the disconnect-retry tests pin both paths.
- [Upload overwrite of an existing file may surprise clients] →
  consistent with `mv` and POSIX rename semantics; pinned by a spec
  scenario so it is a contract, not an accident.

## Migration Plan

New routes on the existing binary; no schema, config, or data changes.
Rollback is reverting; the routes disappear and `/files/*`, PB
built-ins, and the fixture/gate suites are untouched. Existing suites
(chaos, gates, authz matrix, golden script) keep running as-is.

## Open Questions

None — the roadmap row, `docs/architecture.md`'s `/api/sf/*` sketch,
and the retry model settle the mechanics; body/response field names
and the mapping table are pinned by the spec delta and the table-driven
tests.
