# Design

## Context

See `proposal.md` — Why. Current state that shapes the approach:

- `internal/fsapi` lists with `ReadDir` (`fsapi.go: readDirEntries`),
  resolves every path through `internal/vdir`, and publishes uploads
  with a temp name plus `PosixRename` (`ops.go: publish`). It retries
  mutations inside `withRetry` and maps errors with `httpStatus`.
- `internal/fileserver` resolves and stats once (`StatResolved`), then
  `ServeFile` computes `ETag` from `size + mtime.Unix()` and evaluates
  `If-None-Match`/`If-Modified-Since`. `internal/filelinks` reuses the
  same `StatResolved`/`ServeFile` pair for `/s` links.
- `github.com/pkg/sftp` exposes SFTP v3 attributes: size, mode, and
  mtime at whole-second resolution. There is no portable nanosecond
  timestamp and no remote compare-and-swap.
- The product is single-process, single-node (ADR 0001), with SQLite as
  the only durable store. There is no server-side file/content cache,
  and multi-instance deployment is a non-goal.
- `@stratofold/client` is a zero-dependency TypeScript package over the
  bearer API. Its error mapping is status-based; its upload uses XHR for
  progress and abort and never retries.
- PocketBase's global CORS middleware echoes requested headers on
  preflight; `internal/appserver/cors_test.go` already pins the
  cross-origin behavior the client relies on.
- The vdir sandbox resolves symlinks server-side and requires the
  resolved target to stay under the root. `ls` deliberately uses
  `ReadDir`/`Lstat` and never follows an entry's symlink; reads,
  `stat`, and uploads resolve through the sandbox.

## Goals / Non-Goals

**Goals:**

- One opaque version value with explicit change/stability semantics,
  shared by `ls`, `stat`, `/files` ETag, and conditional upload.
- A single-path metadata primitive that does not list the parent
  directory and does not expose remote paths.
- A conditional upload whose authoritative check happens at publish
  time, rejects stale writes atomically, and leaves no temp behind.
- Exactly one of two concurrent conditional uploads with the same
  precondition may publish.
- Backward compatibility: no `If-Match` means today's upload; ignoring
  `version` means today's listing/reading behavior.
- No full-file reads for metadata and no server-side content cache.

**Non-Goals:**

- Detecting every external SFTP edit. The design states the residual
  collision instead of pretending it is closed.
- Distributed/cross-process locking, or serializing external writers.
- Content hashing, remote sidecars/xattrs, or a metadata cache.
- Changing `mkdir`/`mv`/`rm` semantics, the sandbox, authz, the upload
  stream/resume pipeline, or the SPA.
- Making the version a credential or an authorization input.

## Decisions

### D1 — `stat` is a read with the listing contract

Add `POST /api/sf/vdirs/{vdirId}/stat` with the same JSON edge as
`ls` (`bindPathBody(e, true)`): an empty body or `{"path": ""}` means
the vdir root. The handler order copies `ls` exactly: vdir record →
`requestauth.AuthorizeVdir(e, vd, false)` → parse body → `vdir.Resolve`
→ `withRetry` around `cl.Stat` on the canonical resolved path → version
lookup. The remote stat is a pure, re-runnable read, so a reconnect can
complete it; exhausted retries map `503`. A rejected request never
dials; a malformed body is `400` before resolution.

Response:

```json
{
  "path": "docs/notes.txt",
  "name": "notes.txt",
  "kind": "file",
  "size": 1234,
  "mtime": "2026-11-14T12:34:56Z",
  "version": "v1-…"
}
```

- `path` echoes the requested virtual path, matching `ls`.
- `name` is the last segment of the **lexically canonical virtual path**
  (`vdirpath.Resolve`), never a remote path; for the root it is the vdir
  record's `name`. Remote paths stay server-side.
- `kind` is `"file"` for every non-directory (including a resolved
  symlink target) and `"directory"` otherwise.
- `mtime` uses the existing RFC3339 UTC form.
- `size` is `fi.Size()` for files and exactly `0` for directories, even
  though the raw remote directory size participates in the version
  signature. `ls` keeps its current raw `size` field.
- The root is statable: `Resolve("")` returns the canonical root,
  `Stat` describes it, and the version follows the same formula.

Errors reuse `httpStatus`: sandbox/missing `404`, permission `403`,
auth `401`/`403`, retryable/exhausted `503`, invalid shape `400`,
anything else `500`. A version-store failure is a server error (`500`),
not a disguised `404`; the handler keeps resolution errors and version
errors distinguishable.

Alternatives: (a) reuse `ls` on the parent and filter — rejected, that
is exactly the primitive the caller lacks, and it costs a full
directory read; (b) return remote `st` fields verbatim — rejected, it
leaks remote paths and current directory sizes; (c) make `stat` a `GET`
with a path query — rejected, every other path operation is a `POST`
JSON body and paths must not be percent-decoded twice; (d) follow
symlinks for `ls` too — rejected, it would weaken the sandbox's
listing behavior.

### D2 — Version = publication generation + remote signature, not a content hash

For a canonical resolved remote path, define:

```
signature = (kind, size, mtime.Unix())        // whole seconds, SFTP v3
generation = per-(vdir, remote_path) counter  // default 0
version = "v1-" + base64url(
    SHA-256("stratofold-file-version\0" + vdirID + "\0" + connectionID +
            "\0" + remotePath + "\0" + kind + "\0" + size + "\0" +
            mtimeUnix + "\0" + generation)[:16])
```

The value is opaque, deterministic, stable across restarts, and
128-bit truncated. It is not secret and not a credential. The ETag is
the quoted strong form: `"` + version + `"`.

Why it satisfies the contract:

- **Every accepted Stratofold upload changes it.** The publish path
  increments `generation` before the rename (D6), so even a same-size
  upload inside the same whole second produces a different version.
- **Unchanged observations are stable.** Same resolved path, same
  signature, same generation → same hash. The generation row is
  durable, so a restart does not reset it.
- **External SFTP edits are detected without reading content.** An
  external write that changes the size or the whole-second mtime
  changes the signature and therefore the version on the next `stat`,
  `ls`, or `/files` request.
- **The same value is computable on every surface.** `ls` uses the
  directory's canonical remote path plus `"/" + entry name`; `stat`,
  `/files`, and upload use the canonical resolved path. For a regular
  file these are the same path and signature. The key follows the
  sandbox's existing convention (`""` denotes the remote `/`), so the
  entry builder must not use `path.Join`, which would drop the root
  slash (`"file"` instead of `"/file"`).

Residual collisions, stated explicitly:

- An external SFTP edit that keeps the same size **and** the same
  whole-second mtime is invisible. This includes a write within the
  same second after the last observation, a writer that restores the
  previous mtime, and a delete followed by a re-create with the same
  signature. SFTP v3 has one-second timestamps and no content hash;
  closing this needs a full content hash (rejected below) or a
  remote-side version store. `rm`/external deletes do not bump the
  generation, so a re-created file can inherit the old version in this
  residual class.
- A metadata-only mtime change (e.g. `touch`) rotates the version
  because mtime is part of the signature. This over-rotation can cause
  a spurious `412`, but never a silent overwrite. A `chmod` that leaves
  size and mtime unchanged does not rotate it; mode is not content.
  The spec's stability clause is therefore "unchanged observed
  signature", not "unchanged bytes".
- A symlink entry listed by `ls` carries the version of the **link
  entry** (`Lstat` semantics), while `stat`/`/files`/upload follow the
  sandbox to the resolved target. A client that needs a write guard
  must `stat` the path it will upload to; it must not use a symlink
  entry's `ls` version as an `If-Match` for the target.
- Different vdirs over the same remote file have different keys
  (vdir id is in the hash), so their versions are independent. A
  write through one vdir is detected by the other through the
  signature, not through shared generation bookkeeping. The connection
  id is also in the hash, so re-pointing a vdir at another host cannot
  reuse a version from the old host's same-named path.

Alternatives:

- **Content hash (SHA-256 of bytes).** Correct for every content
  change, including external same-size/same-second writes, but `stat`
  and `ls` would have to read every file to answer, turning a listing
  of large files into a full download. A `/files` GET would have to
  hash before it could send an ETag, doubling transfer work, and the
  no-cache/no-buffer principle forbids keeping the result as a
  server-side content index. Hashing during upload covers only writes
  through Stratofold and cannot serve pre-existing files. Rejected.
- **Per-file revision only (no signature).** Cheap and correct for
  Stratofold writes, but every external SFTP edit is invisible until
  something bumps the revision, which never happens for an external
  writer. Rejected.
- **Today's `size + mtime` ETag only.** No server state, but a
  same-size same-second save is invisible and there is no value to
  compare conditionally. Rejected.
- **High-resolution mtime.** SFTP v3 attributes carry whole seconds;
  nanoseconds are not portable, and a writer that restores mtime still
  collides. Rejected.
- **Remote xattr or `.sfver` sidecar.** It stores version state on the
  remote host, can be copied/renamed inconsistently, needs permissions
  and cleanup, and would show up in listings or be invisible and
  fragile. Rejected; SQLite is the only durable store (ADR 0001).
- **Hash only when the signature changed.** Still requires a full read
  in the request path with unbounded latency, and adds a second
  version model. A future size-threshold hybrid is possible; not now.

### D3 — `file_versions` stores only generation counters

Add an internal PocketBase collection `file_versions` (migration
`1770000008_file_versions.go`):

| Field | Type | Notes |
| --- | --- | --- |
| `vdir` | relation → `vdirs`, required, cascade | version scope |
| `remote_path` | text, required | canonical resolved remote path |
| `generation` | number, required, default 0 | publications at this path |

A unique index on `(vdir, remote_path)`; no record-API rules (superuser
only, like `file_links`/`vdir_tokens`); PocketBase `created`/`updated`
for audit. There is exactly one row per uploaded path, and it contains
no content, size, mtime, or hash of the file — it is not a file cache,
just a publication counter. Paths never uploaded through Stratofold
have no row and use generation 0, so no backfill is needed.

`fileversion` (new `internal/fileversion`) owns:

- `Version(app, vdirID, connectionID, remotePath, fi)` — generation
  lookup + hash;
- `VersionsForDir(app, vdirID, connectionID, dirRemotePath, entries)` —
  one batched query (chunked `IN` list, misses = 0) for a listing;
- `Generation(app, vdirID, remotePath)` and `Current(...)`;
- `Bump(app, vdirID, remotePath)` — atomic upsert `generation + 1`,
  returning the reservation;
- `Rollback(app, vdirID, remotePath, reservation)` — decrement only if
  the row still holds that reservation.

Rows for deleted or renamed paths are harmless and are removed only
when the vdir is deleted (relation cascade). No sweep job is added;
a scan would touch `rm`/`mv` behavior, which is out of scope.
A changed vdir root resolves to different remote paths; a changed
connection id is part of the version hash, so either change makes old
rows inapplicable rather than colliding with the new target.

Alternatives: (a) store generation in the `vdirs` record — rejected,
one record write per file publication and a cross-user write conflict;
(b) an in-memory map — rejected, versions must survive restarts;
(c) a random token per version in the row — rejected, the hash is
already opaque and no extra secret is needed; (d) raw SQLite table
without a collection — workable, but the repo's internal-state
precedent is an unruled collection with cascade (`file_links`,
`vdir_tokens`).

### D4 — One version seam feeds `ls`, `stat`, ETag, and upload

- `internal/fsapi/readDirEntries` returns the remote `FileInfo` list;
  the handler then calls `fileversion.VersionsForDir` and fills
  `entry.Version`. A batch-store error is `500`, not `404`.
- `handleStat` uses `fileversion.Version` after `cl.Stat`.
- `fileserver.StatResolved` keeps resolving and statting; a sibling
  `fileserver.VersionFor` (or a second return value) computes the
  version immediately after the stat, and `ServeFile` takes the
  version explicitly. `internal/filelinks` calls the same pair, so
  `/s` links inherit the same ETag with no `file-links` requirement
  change. The version lookup is kept separate from resolution errors:
  both `/files` and `/s` must map a store failure to `500`, never to
  their usual resolution `404`.
- `ServeFile` sets `ETag: "<version>"` and keeps `Last-Modified`,
  `If-None-Match`, `If-Modified-Since`, Range, and `HEAD` untouched.
  `notModified` still compares the incoming tag list to the new ETag;
  weak incoming tags still compare by opaque part for `If-None-Match`
  (RFC 9110 weak comparison is correct there). The ETag itself is
  strong.
- For a directory URL, `handle` already re-resolves `index.html`; the
  version and ETag are that file's, not the directory's.
- ETag values change once on upgrade because the validator formula
  changes. A client holding an old ETag gets a `200` with the new
  representation and ETag; a matching new ETag still gets `304`.
  `HEAD` and Range responses use the same version.

Alternatives: (a) keep the size+mtime ETag and add a separate
`version` field — rejected, the task requires one validator and
conditional upload must agree with the ETag; (b) compute the version
in the HTTP layer only — rejected, `ls`/`stat` and the publish check
would drift; (c) make `StatResolved` return a struct — an option, but
keeping its existing shape and adding a version parameter/return is
the smaller diff.

### D5 — Conditional upload: parse early, check at publish, remove on 412

`If-Match` is parsed after authz and path validation but before the
body is streamed:

- A missing header means today's create-or-replace.
- `*` means "the target must exist"; a missing target is `412`.
- A comma-separated list of strong entity tags is accepted; any exact
  match passes. `W/"…"` tags never match (strong comparison). Empty,
  malformed, or `*` combined with tags is `400`.
- The client-facing form is `If-Match: "<version>"`; the version is
  the unquoted `stat`/`ls` value.

A **preliminary check** runs after `ResolveAncestor` and before the
temp file is created. When the target exists (`Remaining == 0`), stat
it, compute the current version, and fail fast with `412` on mismatch.
When the target is missing (`Remaining == 1`), any `If-Match` is
`412`. A missing parent (`Remaining > 1`) stays `404`. This avoids
streaming a body that can never publish, but is only advisory.

The **authoritative check** runs at publish time, under the per-target
lock (D6), after the body and temp file are complete. It stats the
target, computes the current version, and compares again. A change
during a long upload is therefore caught. On mismatch:

- publish nothing and leave the existing target untouched;
- remove the temp with the existing bounded `abandonTemp` helper;
- return `412` with `{"message": "Precondition failed", "version":
  "<current>"}` when the target exists (omit `version` when it does
  not). This is an additive error body; the client parses `message`
  and exposes `version`.

A successful upload keeps the current `{path, size}` response; adding
the new version there is deferred because `stat` is the contract and
the response shape is already consumed. The precondition error is a
typed sentinel classified **permanent**, so `withRetry` never retries a
`412`; `httpStatus` maps it to `412` and the upload error writer emits
the version body.

Alternatives: (a) check only at request start — rejected, a long
upload would silently overwrite a newer target; (b) check only at
publish — safe but wastes a full body upload on an already-stale
target, so the preliminary check is kept as a fast path;
(c) treat `If-Match` as `If-None-Match` for creation — rejected, this
change only adds the precondition the editor needs; (d) return `409`
— rejected, `412` is the HTTP precondition status and the task names
it; (e) support weak tags — rejected, version equality is strong.

### D6 — A process-local per-target lock and a publish reservation

Enforce atomicity with a `fsapi` keyed mutex:
`map[vdirID + "\0" + targetRemotePath] -> *lockEntry` with `sync.Mutex`
and a refcount, deleted at zero. The lock covers **only** the publish
phase (stat → precondition → generation bump → rename → rollback), not
the body transfer or temp write. Different targets publish in
parallel. This is correct for the single-process deployment (ADR
0001); multi-instance is a non-goal.

Publish ordering, chosen so a completed same-size/same-second upload
can never keep the old version:

1. Acquire the target lock.
2. Load generation `G`; stat the target; compute the current version.
3. Compare `If-Match` (unless this request already holds a
   reservation; see retries).
4. `Bump` to `G+1` and persist it **before** the rename. This is the
   reservation.
5. `PosixRename(temp, target)`.
6. On success, release the lock and respond. The version is now the
   hash of the new signature and `G+1`; no second database write is
   needed.
7. On permanent failure, roll the generation back to `G` only if the
   row still holds `G+1`, remove the temp, and surface the error.
8. On a retryable failure, leave the reservation and let `withRetry`
   reconnect. The retry reacquires the lock, verifies the row is still
   at the reservation and the target signature is unchanged since the
   reservation, and completes the rename without re-checking the
   client's `If-Match`. If another writer superseded the reservation,
   the retry returns `412`. If the temp is gone and the target exists,
   an earlier attempt published (the existing `publish` already-applied
   case); treat it as success.

The request-scoped publish closure holds `reservedGeneration` and the
pre-reservation signature. This is what makes a retry after a mid-
publish disconnect safe: the client's precondition was already
consumed, but the retry can tell its own reservation from another
writer's publication.

Why bump-before instead of bump-after: a crash between the rename and
a post-rename bump would leave new bytes under the old version, which
is exactly the silent overwrite this feature prevents. Bump-before
can only over-rotate on a crash (a spurious `412`), never under-rotate
a completed upload. Rollback on a known permanent failure keeps the
common failure case stable. The reservation window is one stat plus
one rename round-trip; a concurrent GET in that window can see the new
version with the old bytes. That is the deliberate cost.

Residual window: an external SFTP writer (or a writer through another
vdir/process) does not take the lock. Between the publish-time stat
and the rename it can change the target; the rename then overwrites
that content. Closing this would need a remote compare-and-swap or a
lock shared with every SFTP client, neither of which exists. The
design accepts the window and documents it; it does not add a
vdir-wide lock (which would serialize unrelated uploads and still not
stop external writers).

Alternatives: (a) no lock — rejected, two conditional uploads with
the same `If-Match` could both pass and both rename, so the loser
would silently overwrite the winner; (b) a vdir-wide lock — rejected,
unnecessary contention and no external protection; (c) an in-memory
reservation without persistence — rejected, a process restart would
forget it and reset the version; (d) a distributed lock — rejected,
the product is single-node with SQLite; (e) bump-after-rename —
rejected for the crash window above.

### D7 — CORS allows `If-Match` on upload

PocketBase's global CORS middleware echoes `Access-Control-Request-
Headers`; the existing client preflight test already depends on that.
Add an upload case requesting `authorization,content-type,if-match`
and assert `Access-Control-Allow-Headers` includes `If-Match`. No
custom CORS middleware is expected. If a future change narrows the
global echo, bind a small header middleware only on the upload route
rather than a bespoke preflight handler. `/s` is read-only and needs
no `If-Match`.

Alternatives: (a) add a blanket custom CORS policy — rejected, the
global middleware already covers the bearer JSON surface; (b) use
`X-If-Version` — rejected, standard HTTP preconditions are the point.

### D8 — Client API: additive methods, one new failure kind

`client/src/types.ts`:

- `LsEntry` gains `version: string`.
- New `StatEntry = { path, name, kind: "file" | "directory", size,
  mtime, version }`.
- `UploadOptions` gains `ifVersion?: string`.

`client/src/client.ts`:

- `stat(path = "", { signal } = {})` posts `{path}` to
  `/stat` through `requestJson`, forwarding the signal. Errors use the
  existing status mapping. The signal follows `read`'s behavior today
  (an abort surfaces as the network/`retryable` failure, not
  `UploadCanceled`); no new cancellation class is added.
- `upload` sets `If-Match: "*"` for `ifVersion === "*"`, otherwise
  `If-Match: "<ifVersion>"`. A non-`*` `ifVersion` must be a non-empty
  string without a quote or a leading `W/`; otherwise it rejects
  locally with `ConfigurationError` before creating the XHR. No header
  is set when `ifVersion` is omitted.
- The XHR `onload` failure path parses the error body for `message`
  and `version`, not just the status text.

`client/src/errors.ts`:

- `FailureKind` gains `"conflict"`.
- `failureKind(412)` returns `"conflict"`; all existing statuses keep
  their kinds. A plain other `4xx` remains `rejected`.
- `StratofoldError` gains an optional `version` property, populated
  only when a `412` body supplies it; `failureFor` takes an optional
  version so existing call sites compile.
- No retry logic is added anywhere; uploads remain one-shot.

The required `version` field on `LsEntry` is a compile-time change for
code that manufactures listing entries, but the runtime response is
additive. The package version is not bumped or published here; the
existing tag-driven release workflow decides when that happens.

Alternatives: (a) `ifVersion` as a quoted raw header — rejected,
callers should not have to know HTTP quoting; (b) map `412` to
`rejected` — rejected, the editor needs to distinguish a stale write
from a bad request; (c) retry a `412` after re-stat — rejected,
automatic retry would overwrite the newer content the precondition
protected; (d) fetch `stat` inside `upload` to resolve `ifVersion` —
rejected, it widens the race and makes upload non-deterministic.

### D9 — ADR and docs

Write ADR `0015-content-version-and-conditional-writes.md` and index
it. The ADR records the version formula, the generation store, the
bump-before-publish ordering, the lock scope, and the external
residual. Because the roadmap had reserved 0015/0016 for the unwritten
conditional follow-ons, move those reservations to 0016/0017 in
`docs/roadmap.md` (a docs-only renumbering) and add a short roadmap
entry for this change. Update `docs/architecture.md` (stat route,
version, ETag, conditional publish), `AGENTS.md` (capability and
verification pointers), and `client/README.md` (stat/version/
`ifVersion`/`conflict`). `README.md`, `docs/hosting.md`, and
`docs/using-stratofold.md` are unchanged: there is no UI or hosting
change.

## Risks / Trade-offs

- **External same-size, same-second edit → stale conditional write can
  pass.** Unavoidable without content hashing or a remote version
  store; documented in the ADR and the spec's external-edit scenario.
  Mitigation: the API is still a strict improvement, and a future
  content-hash mode can be added without changing the surface.
- **Metadata-only touch rotates the version.** Causes a spurious
  `412`, never data loss. Accepted as the conservative direction.
- **Bump-before-rename briefly serves a new version with old bytes.**
  One stat + rename round-trip; conditional writers are rejected
  conservatively. Accepted over a crash-induced under-rotation.
- **Crash between bump and rename leaves an over-rotated generation.**
  The next conditional upload gets a spurious `412`; a fresh `stat`
  resyncs. Accepted.
- **Retries after a mid-publish disconnect need the reservation
  state.** Implemented in the request closure; a test must force a
  retry between bump and rename and assert the upload still completes
  or fails cleanly without double publication.
- **ETag values change once.** Caches revalidate; conditional GET
  semantics are unchanged. Accepted.
- **`If-Modified-Since` keeps whole-second resolution.** A same-second
  save can still yield `304` for a client that sends only
  `If-Modified-Since`; the new version/ETag is the authoritative
  validator and existing `If-Modified-Since` semantics stay untouched.
- **New client against an old server silently ignores `If-Match`.**
  Old servers do not know the header. Document that `ifVersion` needs
  a server with this feature; a `stat` probe is the capability check.
  The change's compatibility promise is old clients against the new
  server, which is unchanged.
- **Extra SQLite lookup per listing/file read.** Indexed and batched;
  no content is stored. A store failure must be `500`, not a fake
  `404`. The upload publish path also depends on a successful bump; a
  store failure aborts before the rename and returns `500`/`503`, so
  no content is published without its version bookkeeping.
- **Stale generation rows after move/delete/re-root.** Harmless;
  cascade on vdir delete. No sweep.
- **Symlink entry versions differ from the resolved target.** Document
  that a conditional write must use `stat` of the write path.
- **`mv` target bookkeeping is best-effort.** A completed rename must
  not become a failed request because the version bump failed; a
  same-size/same-second move may therefore keep the old version (same
  residual class as an external edit).

## Migration Plan

1. Add the `file_versions` collection in a new migration. Existing
   files have no rows and start at generation 0; no backfill.
2. Deploy the server. Old clients keep working: no header means
   create-or-replace, and the extra `version` field is ignored.
3. Deploy/release the client separately. `stat` and `ifVersion`
   require the new server; a client can probe `stat` to detect support.
4. Rollback: removing the feature reverts ETags to the size+mtime
   formula; clients revalidate once. A rolled-back server ignores
   `If-Match`, so roll back the client at the same time if conditional
   writes matter. Dropping `file_versions` loses only version
   generations; content is untouched.
