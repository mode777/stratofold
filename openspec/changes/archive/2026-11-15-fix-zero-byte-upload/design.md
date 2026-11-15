# Design

## Context

See `proposal.md` — Why. The failure is a completion-bookkeeping bug in
the pipelined write, not a connection problem.

`Transfer.WriteAll` (`internal/sftpreadwrite/transfer.go`) opens the
remote path on its first attempt with `O_CREATE|O_TRUNC`, then asks
`pipelineWrite` to stream the reader. `pipelineWrite` marks an attempt
complete only from inside its `for wr := range results` loop:
`finished && acked >= dispatched` sets `done`. With an empty input the
feeder sets `finished` and closes the task channel without dispatching
a chunk, workers produce no results, and the results loop never runs —
so `done` stays false. `pipelineWrite` returns `(0, nil, false, nil)`:
no error (`err == nil`) and not done. `WriteAll`'s success branch is
`if done`, its error branch is `if err != nil`, so neither runs; the
attempt is treated as retryable and re-run until `MaxAttempts` is
exhausted, ending in the "transfer failed after N attempts" error.
`fsapi.httpStatus` classifies that as retryable, so the upload becomes
`503`. The temp file is then abandoned, exactly as for any failed
upload.

The symmetric read path already short-circuits `limit == 0`
(`pipelineRead`), which is why empty files download and empty uploads
do not. The upload handler passes `size = 0` for `Content-Length: 0`
and `size = -1` for a chunked body; both reach the same gap.

## Goals / Non-Goals

**Goals:**

- An empty upload succeeds once, publishing an empty file through the
  existing temp-file → atomic-rename path, with the normal response,
  version rotation, and temp cleanup.
- Cover both empty-body shapes: declared `Content-Length: 0` and an
  unknown-length body that reaches EOF immediately.
- Leave non-empty transfer behavior, retry budgets, and error
  classification unchanged.

**Non-Goals:**

- No changes to the read pipeline, the upload handler's shape, or the
  API surface.
- No client/UI changes; clients already send empty bodies.
- No new retry, resume, or version mechanisms.

## Decisions

### Decision 1: Settle completion after the results loop, not per input shape

After `pipelineWrite`'s results loop, when no error has been recorded,
re-read the final feeder state under the existing mutex and set `done`
when `finished && acked >= dispatched`. This is the same predicate the
in-loop check uses, so it is idempotent for every non-empty transfer and
becomes the deciding check when zero results were produced. The results
channel closes only after the feeder and all workers finish, so the
post-loop snapshot is stable.

Alternatives rejected:

- **Early `size == 0` return in `WriteAll`** — would have to be placed
  after the `O_CREATE|O_TRUNC` open to keep creating the temp file, and
  would still miss `size < 0` (chunked empty bodies). Two code paths for
  one rule is worse than one post-loop predicate.
- **Dispatch a sentinel zero-byte chunk** — forces a synthetic result
  through the workers, adding a needless remote write and special cases
  in replay accounting.
- **Treat `!done && err == nil` as success in `WriteAll`** — would mask
  a future bug that drops chunks and could publish a truncated file.
  Completion must be earned by the feeder's `finished` flag.

### Decision 2: Keep creation/truncation in the attempt loop

The first attempt still opens the target with `O_CREATE|O_TRUNC` before
streaming. For an empty body that produces the empty temp file the
publisher renames into place. `internal/fsapi`'s conditional publisher,
version bump, and abandoned-temp cleanup are untouched, so the empty
case inherits all existing atomicity and version behavior.

Alternative rejected: special-case empty uploads in `handleUpload`
(e.g. create via `cl.Create` and skip the transfer). That duplicates
publication logic and would drift from the conditional/precondition
path.

### Decision 3: Pin the behavior at both layers

- Primitive: `sftpreadwrite` tests write an empty stream with a declared
  size of zero and with no declared size, asserting success with zero
  bytes and a remote empty file; a third case writes over a non-empty
  file and asserts truncation.
- API: `fsapi` tests upload a zero-byte body (declared and chunked),
  assert `200` with `size: 0`, an empty file with no temp sibling, and
  that replacing a non-empty file rotates its version; a conditional
  empty upload with a matching `If-Match` publishes.

No client tests change; the existing fake-server suites already model
the request shape and would not catch a server-side completion bug.

## Risks / Trade-offs

- **Completion check now runs once more per attempt** → It is a
  mutex-protected read of two integers plus a comparison, only after
  the results loop drains; negligible next to SFTP I/O.
- **Empty `WriteAll` truncates an existing remote file** → This is the
  documented whole-file-write semantic (`O_TRUNC` on first attempt) and
  the upload path only ever writes fresh temp names; a primitive test
  pins it so it cannot surprise callers later.
- **Chunked empty bodies depend on the server delivering EOF with
  `n == 0`** → `io.ReadFull` returns `io.EOF` for an immediate EOF,
  handled by the same finished/EOF branch as short final chunks; the
  API-level chunked test exercises the real `net/http` path.
- **No observable change for non-empty uploads** → The post-loop check
  can only set `done` when the in-loop check would also have set it, so
  resume and mid-stream disconnect tests remain valid.

## Migration Plan

No data or API migration. Deploy the server binary as usual; clients
pick up the fix transparently. Rollback is a revert of the code change
(no schema, no stored state).
