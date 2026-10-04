# Design — `add-streaming-file-server`

## Context

The seams this change consumes all exist: `internal/vdir` resolves a
virtual path to a server-resolved remote path plus a
`sshconn.ClientProvider` (fail-closed before dialing);
`internal/sftpreadwrite` streams byte-exact offset reads with
transparent resume; `internal/authbridge` validates the `sf_session`
cookie in-process; `internal/appserver` clears streaming deadlines and
mounts custom routes. `internal/sftpreadwrite` can read from an offset
internally, but its only public ranged read buffers the whole range in
memory (`ReadRange` → `[]byte`), and nothing yet exposes `/files/*` —
`appserver/stream.go` already carries the comment that change 4 applies
`ClearStreamDeadlines` to it. Motivation and scope: proposal.md;
behavior contract: the `file-server` spec delta.

## Goals / Non-Goals

**Goals:**

- One new handler package that turns HTTP requests into vdir
  resolutions and ranged SFTP streams, with everything
  remote-access-shaped delegated to the existing seams.
- Auth decisions made before any SSH dial; responses streamed with
  Range/conditional semantics a browser video player and `<img>` can
  rely on.
- The full Range/conditional/content matrix proven twice: table-driven
  httptest and an in-repo golden curl script.

**Non-Goals:**

- No write methods, listing, sharing/roles, `If-Range`, multi-range,
  compression, or SPA — see proposal Non-goals (changes 5–7 own them).
- No changes to the resolver, session bridge, or connection manager;
  no new collections or migrations.

## Decisions

### D1 — Route shape: wildcard route on the PB router, decoding at the HTTP edge

`internal/fileserver` registers `GET /files/{vdirId}/{virtualPath...}`
plus the bare `GET /files/{vdirId}` on the PocketBase router
(`appserver.Install`, next to `authbridge.RegisterRoutes`). The
wildcard arrives still percent-encoded; the handler splits on `/`,
`PathUnescape`s each segment once (rejecting invalid escapes), and
hands the decoded virtual path to `vdir.Resolver.Resolve` — the
change-3 D4 note that decoding belongs to the HTTP layer. A segment
that decodes to `/` or NUL simply re-joins into a path the resolver
rejects; no bespoke defense here.

*Apply correction:* Go's `http.ServeMux` (which PocketBase v0.40's
router wraps) matches wildcards on the escaped path but hands the
handler already-percent-decoded values via `PathValue` — the mux *is*
the decode-once edge. The handler therefore passes the decoded value
straight to the resolver and never decodes again (the probe also
showed the mux 307-redirects raw `..`/`//` forms to cleaned paths and
leaves `%2e%2e` intact for the resolver to reject after decoding —
exactly the split the spec pins). The decision and its rationale are
unchanged; only the mechanics moved into the mux.

*Rejected:* `http.ServeFile` / PB's static handler — they serve local
filesystems; the source is a remote SFTP file, and the sandbox
semantics (resolve-then-target-resolved-path) must stay in force.
*Rejected:* mounting under `/api/sf/files/...` — the vision pins the
`/files/<vdir-id>/...` pattern, and `/api/` namespace proximity to PB's
`/api/files/*` invites exactly the collision the auth-session spec
forbids. `/files/` is outside every PB-owned namespace.
*Rejected:* unescaping the whole raw path at once (`url.PathUnescape`)
— would turn `%2F` into a separator and blur which segments existed;
per-segment decoding keeps the reject-then-404 behavior deterministic.

### D2 — Authorize before dialing

Handler order: load the vdir record (SQLite only) → access decision →
`vdir.Resolver.Resolve` (which may dial) → stat → serve. Public vdirs
(`is_public`) skip the session check; non-public require
`authbridge.RequireSession` semantics plus owner match (shares/roles
are change 6, which will extend exactly this step). `401`/`403`/`404`
decisions on invalid input therefore never wake an SSH connection,
keeping the resolver's fail-closed property intact end-to-end. The
record is loaded twice (once for authz, once inside the resolver) —
two cheap indexed SQLite reads, chosen over widening the resolver's
API.

*Rejected:* resolve-first, authorize-after — dials SSH for anonymous
garbage and makes a 401 observable as connection churn.
*Rejected:* teaching `vdir.Resolver` about authz — access policy is an
HTTP-surface concern and will grow shares in change 6; the resolver
stays policy-free.
*Accepted:* authenticated non-owner → `403` (not `404`); vdir ids are
unguessable PB record ids, so the existence leak is negligible and the
status is debuggable. Change 6's matrix will revisit.

### D3 — Ranged streaming read added to `internal/sftpreadwrite`

Add one method, e.g.
`ReadRangeTo(ctx, w io.Writer, off, length int64) (int64, error)`:
same pipelined, resume-at-served-offset machinery as
`ReadAll`/`ReadN` (both wrap `readInto`, which already takes an offset
and a length) with the sink writing straight to the HTTP response
writer. A drop mid-response reconnects and continues from the served
offset, so `Content-Length` stays truthful and the client sees one
continuous body; exhausting reconnect attempts fails the response
loudly mid-stream (client retries with Range — the spec's retry
scenario). Existing methods unchanged.

*Rejected:* serving via the existing `ReadRange` (`[]byte`) — a Range
against a multi-GB file could be GBs in RAM; violates "stream, don't
cache".
*Rejected:* raw `sftp.File.ReadAt` in the handler — reimplements
classification/reconnect/pipelining and loses the R1 resume guarantee
the transfer layer already proves.
*Rejected:* an `io.Reader` adapter instead of a writer-sink method —
`http.ResponseWriter` is a writer; an adapter adds a goroutine and a
copy for nothing.

### D4 — Representation headers from one remote Stat

One SFTP stat of the resolved path drives `ETag` (strong,
`"<size-hex>-<mtime-hex>"`), `Last-Modified`, `Content-Length`, and
Range clamping. `Content-Type` comes from a built-in table keyed by
lowercased extension (html, css, js/mjs, json, txt, pdf, png, jpg,
jpeg, gif, webp, svg, ico, mp4, webm, mp3, ogg, wav, wasm, … — exact
rows are implementation details), default `application/octet-stream`.

*Rejected:* `mime.TypeByExtension` as the source of truth — it consults
the host's mime databases on Linux, making responses
environment-dependent; the spec pins deterministic behavior.
*Rejected:* content-hash ETags — a full remote read per request;
size+mtime is the standard cheap validator. *Accepted trade-off:*
remote mtime granularity (sometimes 1 s or coarser) can collapse
distinct versions onto one ETag; conditional tests seed files with
distinguishable mtimes.
*Rejected:* weak ETags / `Vary` machinery — no consumer; the validator
is only compared via `If-None-Match` exact-match against what we sent.

### D5 — Range grammar: strict single-range subset

Parse `bytes=` only. Valid single range → `206` + `Content-Range`:
`start-end` as-is (end clamped to size-1), `start-` → `start-(size-1)`,
`-suffix` → last `min(suffix, size)` bytes. Unsatisfiable (`start ≥
size`, `-0`) → `416` + `Content-Range: bytes */<size>`. Multi-range,
foreign units, and unparseable values → ignore the header, serve `200`
full (RFC 9110 permits ignoring Range). `Accept-Ranges: bytes` on every
successful response. Conditional evaluation (D4's `If-None-Match` /
`If-Modified-Since`) happens first; a `304` suppresses Range handling.

*Rejected:* multipart/byteranges — no consumer in sight (video
elements and download links send single ranges); parsing and
serialization complexity for zero users. *Rejected:* `416` for
malformed syntax — non-`bytes`/garbled headers are a client quirk to
tolerate, not an error to advertise; strict `416` is reserved for
well-formed-but-impossible requests.

### D6 — Directory semantics: index.html or 404, canonical slash redirect

After resolution, stat the target. Directory → resolve and serve
`<dir>/index.html` (missing → `404`; listing stays the change-5 API).
Directory addressed without a trailing slash → `301` to the slashed
form (path only; raw query preserved) so relative references inside a
served `index.html` resolve. Bare `/files/{vdirId}` behaves as the root
directory (slashed form redirects to itself harmlessly — normalize by
redirecting only when the URL lacks the slash). File with trailing
slash → `404`.

*Rejected:* autoindex HTML — `docs/architecture.md` keeps listing
API-only; the UI renders listings from the API. *Rejected:* serving
directories as plain `404` without index resolution — `index.html`
support is an explicit roadmap requirement of this change.

### D7 — Deadlines, cancellation, and concurrency

`ClearStreamDeadlines` binds on the `/files/*` route group; the request
context flows into `Resolve`/`ReadRangeTo`, so a client disconnect
aborts remote reads and releases the client ref. Concurrent requests
multiplex over the single SFTP channel through the manager's refcount
(change-1 machinery); the transfer window bounds per-response memory
(~2 × InFlight × ChunkSize, unchanged).

*Rejected:* a per-response semaphore limiting concurrent /files
responses — no evidence of channel starvation yet; the throughput gate
from change 1 remains the instrument that would justify one.

### D8 — Golden curl matrix script

`scripts/fileserver-golden.sh` (bash + curl + `sha256sum`): assumes a
running Stratofold + seeded SSH fixture, then walks the whole matrix —
content bytes, each Range row (status, `Content-Range`, slice
checksum), conditional rows, mime/index rows, auth rows — asserting
headers and bodies. In-repo per the roadmap; runs anywhere the fixture
runs (in-proc locally, external OpenSSH on the build server). It is a
second harness, not a replacement: the httptest matrix stays the
fast, always-on check.

*Rejected:* golden *file* snapshots — the interesting surface is
headers + status + streaming bytes; curl assertions capture exactly
that without fixture drift. *Rejected:* driving it from Go tests —
the point is an out-of-process, client-side view (real curl, real
HTTP stack) that survives in-repo as a runnable artifact.

## Risks / Trade-offs

- [Range/conditional header subtleties (case, whitespace, multiple
  If-None-Match tags)] → table-driven httptest matrix over the spec's
  scenario rows, mirrored by the golden script; a wrong header fails a
  test, not a user's video seek.
- [Remote mtime granularity makes ETags coarse] → accepted (D4);
  validators only need to distinguish "changed since last fetch" in
  practice; future cache invalidation pain would show up in change 7's
  UI, not here.
- [Wildcard route interactions with PB's router (static handlers,
  later SPA at `/`)] → route-collision assertions extended to
  `/files/*` vs `/api/*` in this change's tests; change 7 must keep
  the SPA mount from swallowing `/files` — flagged in its roadmap row.
- [Mid-response reconnect leaves a half-written socket if resume
  exhausts attempts] → the transfer fails loudly mid-stream (no
  silent truncation); clients recover via the pinned Range-retry
  behavior, and the deterministic killer-based test proves the retry
  completes the file.
- [Directory redirect loops (slash handling bugs)] → redirect fires
  only on the unslashed form of a stat-confirmed directory; the
  slashed form is handled directly, so one redirect is the maximum.

## Migration Plan

No schema, config, or data changes — new routes on the existing
binary. Rollback is reverting; the route simply disappears. Existing
suites (fixture, gates, authz matrix) are untouched consumers.

## Open Questions

None — the roadmap row, `docs/architecture.md`'s `/files/*` sketch,
and the seams above settle the mechanics; header values and table rows
are pinned by the spec delta and tests.
