# 0017 — Long-running operations are in-memory jobs polled over the API

Status: Accepted (2026-11, change `add-archive-extraction`)

## Context

Until archive extraction, every `/api/sf/*` operation either finished
inside its request or streamed a body: `ls`, `stat`, `mkdir`, `mv`, `rm`,
and `upload` all complete in one request/response cycle, with streaming
routed through `appserver.ClearStreamDeadlines`. Extracting a remote
archive breaks that shape — it can run for ten minutes and must report
progress and accept a cancel — and it will not be the last operation of
that kind (bulk moves, remote copies, and thumbnail generation all have
the same profile).

Three shapes were available: a synchronous request, a streaming progress
response, or a job the client observes.

## Decision

A long-running operation is an **in-memory job** exposed over the existing
API, not a durable queue and not a long request:

- `POST` authorizes, resolves, and validates everything knowable at
  request time, then answers `202` with a job object.
- The work runs in a goroutine detached from the request context
  (`context.WithoutCancel`) with its own cancellation.
- `GET …/{jobId}` returns a snapshot: state (`running`/`succeeded`/
  `failed`/`canceled`), phase, counters, current item, and a terminal
  error carrying an HTTP status from the API's existing error classes.
- `DELETE …/{jobId}` cancels idempotently.
- The registry (`internal/archiveextract`, `Registry`) is process-local:
  a restart abandons jobs. Terminal jobs are retained briefly for the
  result read and then evicted; concurrent jobs are bounded and a second
  request for the same target is refused rather than queued.

The implementation lives in `internal/archiveextract` (see the
archive-extraction spec for behavior). The pattern is what future
long-running operations should follow.

## Consequences

- Errors after acceptance cannot be HTTP statuses, so a job carries a
  `{status, message}` pair drawn from the same 400/403/404/409/503/500
  taxonomy the API already uses. Clients read the status from the
  snapshot instead of the response line.
- Restarts abandon in-flight work and can leave a hidden scratch
  directory on the remote; the next operation in that directory sweeps
  stale scratch names. No recovery daemon, no durable job table.
- Progress and cancel exist only while the process lives, matching the
  SPA's in-memory upload queue and the PWA's deliberate lack of offline
  behavior (ADR 0009).
- Admission is explicit: over the concurrency budget the caller gets a
  retryable `503` rather than joining an unbounded queue — no hidden
  backlog, no fairness promise.
- Job ids must be treated as unguessable (128-bit random values) and every
  observation/cancel re-checks write access on the owning vdir.
- Jobs have no deadlines of their own beyond their transfer retry budgets;
  a wedged remote keeps a slot until the operation's own budgets expire.

## Rejected alternatives

- **Synchronous request**: simplest, but no progress, no cancel, and a tab
  close or a reverse-proxy idle timeout aborts a ten-minute operation.
- **NDJSON progress stream on the POST response**: no server state, but
  after the status line is sent every failure becomes `200`-with-an-error,
  which breaks the deterministic error mapping the rest of the API relies
  on, and a dropped connection loses the work.
- **Durable job records (for example an `extract_jobs` collection)**:
  survives restarts at the cost of a collection, recovery, orphan cleanup,
  and a durability promise no other part of the product makes.
- **A background worker pool with a queue**: a second process model with
  its own admission, fairness, and observability needs, for one operation.
