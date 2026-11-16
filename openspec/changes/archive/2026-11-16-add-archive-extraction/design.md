# Design

## Context

See `proposal.md` for motivation. The relevant current state:

- `internal/fsapi` owns every `/api/sf/vdirs/{vdirId}/*` route behind one
  PocketBase router group with shared auth middleware, and maps failures
  through `classify` + `respondErr` (`sandbox/missing 404`, permission
  `403`, bad shape `400`, conflict `409`, retryable `503`).
- `internal/sftpreadwrite.Transfer` already provides exact ranged reads
  (`ReadRange`, retried per call) and a resumable streaming writer
  (`WriteAll`) that resumes at the acknowledged offset across reconnects
  **for non-seekable readers** by replaying the unacknowledged chunks it
  still holds.
- `internal/vdir` resolves virtual paths through the sandbox and rejects
  escapes before dialing; `internal/vdirpath.Resolve` is deliberately
  *normalizing* (it drops `.`/empty segments and walks back over `..`).
- `internal/vdirauthz` resolves `None`/`Viewer`/`Editor`/`Owner` plus
  `is_public` per request with no caching, so revocation is immediate.
- Nothing in the codebase is asynchronous: every request either finishes
  in-request or (uploads) streams a body. There is no job, queue, or
  background-worker concept server-side. The SPA's upload manager is a
  module-level in-memory singleton.
- Go 1.27 gives `archive/zip` (incl. zip64), `io.ReaderAt`, and
  `zip.FileHeader.Flags` for encryption detection. No new dependency is
  needed for `.zip`.

## Goals / Non-Goals

**Goals:**

- Extract a remote `.zip` without downloading it, with one read pass and
  one write pass over the existing single SFTP channel.
- Keep peak host memory bounded and independent of archive size.
- Make publication all-or-nothing and invisible until complete.
- Survive reconnects mid-member.
- Keep the existing error contract: a caller can distinguish
  invalid/permission/missing/conflict/unavailable exactly as on the other
  write routes.
- Leave a seam for more container formats without touching the job API.

**Non-Goals:**

- Durability, resumption across a server restart, or a worker pool.
- Any format other than `.zip` (see proposal Non-goals).
- Changing `mkdir`/`mv`/`rm`/`upload` semantics.
- Extending `@stratofold/client`.

## Decisions

### D1. Extraction runs server-side, streamed through the vdir

The archive is read with ranged SFTP reads and members are written back
with the resumable writer; no archive bytes reach the browser.

Rejected:

- **Browser-side unzip** (`fflate`/`zip.js`): zero new server surface and
  free reuse of the upload queue, but the archive must be transferred to
  the browser and every member transferred back, which doubles traffic for
  a feature whose point is large remote archives, and puts multi-GB
  archives in browser memory.
- **Remote `unzip` over an SSH exec channel**: fastest and free, but it
  introduces remote command execution (shell-quoting a user-controlled
  path), depends on host tooling and BSD/GNU flag differences, breaks the
  documented "streams through the server" stance, and offers no bounded
  progress or byte accounting.

### D2. A long-running operation is an in-memory job, polled over the API

`POST …/extract` authorizes, validates the source, and returns `202` with
a job id; the work continues in a goroutine detached from the request
context; `GET …/extract/{id}` returns a snapshot; `DELETE …/extract/{id}`
cancels. The registry is a package-level map guarded by a mutex, with job
ids from `crypto/rand` (128-bit hex).

Rejected:

- **Plain synchronous request**: simplest, but no progress, no cancel, and
  a tab close or reverse-proxy idle timeout aborts a ten-minute operation.
- **NDJSON progress stream on the POST response**: no server state, but
  once the status line is sent every error becomes a `200`-with-an-error
  body, which breaks the deterministic mapping the rest of the API relies
  on; a dropped connection also loses the work.
- **Durable `extract_jobs` collection**: survives restarts, but adds a
  collection, recovery, and orphan cleanup for a guarantee the product
  does not make anywhere else (the upload queue and the PWA are both
  deliberately non-durable).

### D3. `io.ReaderAt` over `Transfer.ReadRange`, with a bounded read-ahead

`archive/zip` needs `ReadAt` plus a total size, so a small adapter wraps
`ReadRange`, clamps reads to the file size, and translates a short final
read into `io.EOF`. `zip.NewReader` then reads the EOCD and the central
directory and inflates members by seeking to each local header — all
without a host-side copy of the archive.

The adapter adds a **single-entry read-ahead window** (1 MiB) that serves
ranged reads from a buffered span and refills it on a miss. A zip reads
its local header and then streams the member data immediately after it, so
one window usually covers an entire small member and collapses three
round trips per entry into one.

Measured on the in-proc fixture with 2 ms injected per round trip
(`TestReadAheadThroughput`, 48 small members): 194 ranged reads in 599 ms
without the window, 3 in 12 ms with it. The window size stays 1 MiB — one
bounded span per job, irrelevant next to a transfer window, and the
measurement shows the win is about round-trip count, not span size.

Rejected:

- **Download the archive, then unzip locally on the host**: violates
  "stream, don't cache" and the R5 memory rule, and needs temp disk space.
- **No read-ahead**: correct, but `ReadRange` is one pipelined round trip
  per call; a 10k-entry archive would spend most of its wall time in
  latency.

### D4. Entry names get a strict validator, separate from `vdirpath.Resolve`

Extraction rejects rather than normalizes: any empty, `.`, or `..`
segment; an absolute name; a `\` or NUL byte; invalid UTF-8; symlink and
encrypted entries. Objects are assembled by joining validated segments
under the temporary directory, never by handing a raw entry name to
`filepath.Join`/`vdirpath`.

Rejected:

- **Reuse `vdirpath.Resolve`**: it walks back over `..` by design, so
  `a/../b.txt` silently becomes `b.txt` — two entries can collide on one
  path, and a hostile archive's intent is erased instead of refused.

### D5. Cosmetic metadata is skipped; structural violations fail the archive

`__MACOSX/`, `._*`, `.DS_Store`, and `Thumbs.db` are skipped and counted.
Everything in D4 fails the whole job, publishes nothing, and names the
offending entry.

Rejected:

- **Fail on everything**: a macOS-produced archive is routinely full of
  `__MACOSX`, so this makes ordinary archives un-extractable.
- **Skip everything unsafe**: never blocks a user, but a malicious archive
  would still yield partial content the user may not inspect, and a silent
  skip hides intent.

### D6. Temporary directory plus one rename; publish with `PosixRename`

Members are written under `.<archive-name>.sfext-<8 hex>` in the archive's
own directory (same filesystem, so the publish is a rename). It is
published with `PosixRename` where the server advertises the extension
(atomic per POSIX, and reliable about non-empty targets) and falls back to
`Rename` after a pre-flight `Stat` of the target. Nothing is published
until the last member is done.

Rejected:

- **`mkdir` the target first and write into it**: a killed extraction
  leaves a browsable half-archive and a retry has to merge, which also
  removes the free collision rule.

### D7. Resource ceilings are enforced on inflated bytes, not declared sizes

Defaults: 100,000 entries, path depth 64, 50 GiB total uncompressed.
Declared uncompressed sizes from the central directory are used only for
the advisory totals a job reports before extraction starts; the enforced
counter increments as bytes are actually inflated, through a
budget-limited reader in front of `WriteAll` (which is given `size = -1`
because a lying entry must fail the budget, not silently truncate).

Rejected:

- **Trusting `UncompressedSize64`**: it is attacker-controlled, so a bomb
  declares 1 GiB and inflates terabytes onto the remote disk.

### D8. One publish per job, one running job per target, bounded total

A second `POST` for the same (archive, target) while a job runs is `409`.
At most 4 jobs run concurrently server-wide; beyond that the request is
refused with a retryable class rather than queued. Terminal jobs are
retained for 10 minutes for the result read, then evicted; eviction never
touches published output.

Rejected:

- **Unbounded concurrency**: every job holds SFTP pipeline windows and
  competes for the same single channel, so it degrades interactive
  browsing for everyone.
- **Queueing instead of refusing**: a queued job has no admission
  contract and would need its own UX; the SPA can retry a `503`.

### D9. Access is checked at creation and re-checked between batches

`requestauth.AuthorizeVdir(..., write=true)` gates creation. While
extracting, the job re-resolves `vdirauthz` every 64 entries or 32 MiB
(whichever comes first) and aborts with a `403` class terminal error,
removing its temporary directory.

Rejected:

- **Authorize once at start**: consistent with an in-flight upload stream,
  but leaves a window where a revoked editor keeps writing to someone
  else's host, and this loop can afford the check that a single stream
  cannot.
- **Authorize only on each poll**: polls come from the client, so a closed
  tab would disable the check entirely.

### D10. Errors split at the acceptance boundary

Everything knowable at request time is an HTTP status on the `POST`
(`400` malformed/not-an-archive, `401`, `403`, `404` missing/sandbox,
`409` target exists). Once a job is accepted, failures are recorded on the
job as `{status, message}` using the same classes, because the response
was already `202`. The job's `status` is a number drawn from that mapping,
not a new taxonomy.

Rejected:

- **Blocking the POST until the scan finishes** so that scan failures get
  HTTP statuses: the scan reads the central directory, which is fast for
  small archives but not for 100k entries, and it would resurrect the
  long-request problem for a failure that the SPA can render from the job
  just as well.

### D11. `ls` stops listing Stratofold's own scratch names

`readDirEntries` filters names matching the system's in-flight patterns
(`.<base>.sfpart-<hex>` and `.<base>.sfext-<hex>`). This is required for
the job's "no temporary directory is presented as a member" guarantee, and
it fixes the same visibility wart for running uploads. It is NOT a general
dotfile filter: this is an SSH file manager and `.bashrc`/`.git` must keep
listing.

Rejected:

- **Leaving the scratch directory visible**: for a ten-minute extraction
  every user of the folder sees (and can browse into) a partially written
  tree with a generated name.
- **Filtering all dot-prefixed entries**: would hide legitimate remote
  dotfiles, which this product exists to manage.

### D12. SPA: a module-level tracker, a confirm sheet, and an existing destination

`web/src/lib/extractJobs.ts` mirrors the upload queue's shape: a singleton
that starts a job, polls it on a timer, exposes snapshots, and survives
navigation; a hook binds it to React. `entryKind` gains `archive`; the
context menu gains Extract for writers; a confirm sheet shows the derived
folder name and lets the user edit it, re-offering the field on `409`.
Progress renders in the Uploads panel beside uploads and in the floating
indicator, which is why the navigation destination is unchanged.

Rejected:

- **A separate navigation destination for extraction**: a fifth iOS tab
  slot for an occasional action; the panel already has the shape.
- **Page-local job state**: a job would vanish on navigation while still
  running server-side, and progress would be lost.

## Risks / Trade-offs

- **Read amplification on small-entry archives** → the D3 read-ahead
  window; the tasks include a measurement spike against the fixture over a
  latency-injected transport, with the window size as the tuning knob.
- **Interactive latency while extracting** (one SFTP channel per
  connection) → accepted, as with uploads; the concurrency cap bounds it.
- **Deflate is single-threaded per member** → CPU is not the expected
  bottleneck at these sizes; no worker pool is added.
- **Caps are arbitrary** → a legitimate 60 GiB archive is refused; the job
  reports the ceiling in its error, and the caps are package-level
  constants with a single documented location.
- **Archive changes mid-extraction** (someone uploads over it) → zip's
  CRC32 check surfaces `zip.ErrChecksum`; the job fails and publishes
  nothing rather than publishing corrupted members.
- **Rename semantics vary by server** → `PosixRename` first, `Rename` with
  a pre-flight `Stat` as fallback; the race window is documented as
  residual.
- **Process restart orphans a scratch directory** → the next extraction in
  the same parent sweeps stale `.*.sfext-*` directories best-effort; no
  daemon.
- **Registry growth** → terminal retention plus eviction; job creation is
  write-gated so only users who can write can add jobs.

## Migration Plan

Pure addition: no schema change, no collection, no new dependency, no
backfill. Rollout is a normal binary/SPA deploy; rollback leaves at most an
orphaned scratch directory that the next extraction sweeps. Old clients
never call the route and are unaffected; the SPA's Extract action is
gated on the server accepting the request, so a UI-first rollout degrades
to a `404` on the route rather than a broken screen.

## Open Questions

- Whether the Uploads navigation label should become something broader
  (for example "Activity") once extraction tasks live there. Deferrable:
  it changes copy, not behavior.
- The exact read-ahead window size, pending the spike in D3.

## Apply notes

Two refinements settled during implementation, recorded so the archived
change carries them:

- **Member-side read failures are permanent for the transfer.** A ceiling
  breach or a checksum/format error comes from the archive, not the
  connection, so `memberReadError` marks it and the writer's classifier
  refuses to retry it (otherwise a bomb would burn the whole retry budget
  before failing). This is a refinement of D7, not a new decision.
- **The content sniff runs before the collision check.** A non-archive
  file derives a target name equal to itself, so checking the target first
  reported a `409` where the spec requires `400`. The order is now stat →
  directory check → sniff → target name → existence, which keeps every
  creation-time status meaning what the spec says.
- The ceilings accept per-request overrides (`Request.MaxBytes`,
  `Request.MaxEntries`) so bounded tests can work with small archives;
  zero keeps the package defaults, which stay the only production values.
