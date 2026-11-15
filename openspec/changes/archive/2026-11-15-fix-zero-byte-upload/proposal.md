# Proposal

## Why

Creating an empty file through the filesystem API fails with `503
Remote host unavailable`: an upload whose body is zero bytes
(`Content-Length: 0`, or a chunked body that ends immediately) is
treated by the transfer pipeline as an attempt that made no progress,
so `WriteAll` burns its whole retry budget against a perfectly healthy
connection and then reports a retryable-class failure. Every creation
path for an empty file goes through upload, so the web upload queue,
`@stratofold/client`, and raw API callers all hit the same false `503`.

## What Changes

- Make an empty byte stream a *completed* write in the pipelined
  transfer: when the feeder reaches EOF (or the declared size of zero)
  before dispatching any chunk, the transfer reports success with zero
  acknowledged bytes instead of an unfinished attempt.
- Preserve the existing upload contract end to end: the empty temp file
  is created next to the target, renamed into place atomically, the
  response is `200` with `{"path", "size": 0}`, and the target's
  content version rotates exactly as for a non-empty upload.
- Keep replacement semantics: uploading an empty body over an existing
  non-empty file replaces it with a zero-byte file.
- Add regression coverage at both layers: the transfer primitive
  (empty `WriteAll` with a declared size and with an EOF-delimited
  stream creates/truncates an empty remote file) and the HTTP API
  (zero-byte upload creates an empty file, reports `size: 0`, leaves no
  temp file, and replaces existing content).

No route, request, or response shape changes. Error classification and
retry budgets are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `filesystem-api`: the upload requirement gains the zero-byte case —
  an empty body SHALL publish an empty file at the target, return
  `200` with size `0`, rotate the version, and leave no temp file,
  rather than failing as retryable.
- `sftp-streaming`: the full-file write requirement gains the
  zero-length case — an empty byte stream is a completed write of zero
  bytes (the remote file exists and is empty), not an exhausted retry
  budget.

## Impact

- `internal/sftpreadwrite/transfer.go`: completion bookkeeping in
  `pipelineWrite` / `WriteAll`.
- `internal/sftpreadwrite/transfer_test.go`,
  `internal/fsapi/fsapi_test.go`: regression tests.
- Client packages (`web/`, `client/`) need no change; they already send
  empty bodies and will simply stop seeing the false `503`.
- docs: no end-user documentation change — `README.md`,
  `docs/hosting.md`, and `docs/using-stratofold.md` describe no
  zero-byte restriction, and `AGENTS.md`'s upload summary stays
  accurate.
- **No ADR** — this restores the behavior the existing upload and
  streaming decisions already promise; it settles no new durable
  architecture choice.

## Non-goals

- No client-side workaround, new "create file" endpoint, or API shape
  change.
- No change to retry budgets, error classification, atomic-publication
  rules, or conditional (`If-Match`) semantics.
- No new content-version scheme; the existing rotation applies
  unchanged.
- No UI work beyond the upload queue naturally succeeding.
