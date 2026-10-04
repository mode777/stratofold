# Proposal — `add-streaming-file-server`

## Why

Changes 1–3 built the machinery (resumable SFTP streams, cookie
sessions, the vdir sandbox) but nothing user-visible can read a file
yet. This change delivers the first user-facing surface — the
vision's "state-of-the-art file server": `GET
/files/<vdir-id>/<virtual-path>` streaming straight from the SSH host
with Range seeking, conditional requests, and standard static-server
semantics (roadmap change 4; retires R1's HTTP-layer story and builds
on R3/R4's retired seams). Every later change (write API, sharing, UI)
serves content through it.

## What Changes

- New route `GET /files/{vdirId}/{virtualPath}` (plus the bare
  `/files/{vdirId}` root form) on the embedded PocketBase router,
  registered outside `/api/sf/*` per the route-collision invariant
  (PocketBase keeps `/api/files/*`).
- Streaming responses via SFTP offset reads through the vdir resolver
  and `sftpreadwrite`'s retry/resume pipeline — no host-side buffering
  of the file; a mid-transfer disconnect resumes at the served offset
  inside the same response.
- HTTP Range support: single byte range (`start-end`, suffix `-N`,
  open-ended `N-`) → `206` + `Content-Range`; unsatisfiable/invalid →
  `416`; syntactically unusable Range headers are ignored (full `200`).
  `Accept-Ranges: bytes` on every response.
- Conditional requests: `ETag` and `Last-Modified` from the remote
  stat; `If-None-Match` / `If-Modified-Since` → `304`.
- Content semantics: extension→mime table (deterministic, built-in)
  defaulting to `application/octet-stream`; `Content-Length` set;
  directory URLs resolve `index.html` when present, else `404` (no
  autoindex); a directory addressed without a trailing slash redirects
  (`301`) to the slashed form.
- Auth enforcement: non-public vdirs require a valid `sf_session`
  cookie (owner-only until sharing exists — change 6); public vdirs
  (`is_public`) are served to anonymous requests. The auth decision is
  made before any SSH dial. Streaming routes clear per-request
  deadlines (`appserver.ClearStreamDeadlines`).
- Small additive extension to `internal/sftpreadwrite`: a streaming
  ranged read (offset + limit into an `io.Writer`), so a multi-GB Range
  response never materializes in RAM; existing transfer API unchanged.
- A golden curl matrix script kept in-repo that exercises the whole
  Range/conditional/content matrix against a running server + SSH
  fixture.

## Capabilities

### New Capabilities

- `file-server`: the `/files/*` read surface — URL resolution through
  the vdir sandbox, owner/public access control, Range + conditional
  request handling, content headers (mime, length, ETag,
  Last-Modified), `index.html` resolution, and streamed delivery with
  mid-transfer resume.

### Modified Capabilities

None — `virtual-directories`, `auth-session`, and `sftp-streaming` are
consumed as-is (the resolver, session middleware, and transfer
pipeline are unchanged; the `sftpreadwrite` addition is new surface on
an internal package, not a change to its pinned behavior).

## Impact

- New `internal/fileserver` package (route registration, Range/headers
  logic) wired in `internal/appserver.Install`; `internal/vdir`,
  `internal/authbridge`, `internal/connreg`, `internal/sshconn` are
  consumed unchanged.
- Additive ranged-stream method in `internal/sftpreadwrite`.
- No new collections, no migration, no new third-party dependencies.
- Verification additions: Range test matrix, conditional-request tests,
  mime/index tests, mid-transfer reconnect test (kill SFTP during a
  Range response; a retried Range request succeeds), and the golden
  curl matrix script — all against the existing SSH fixture (in-proc
  locally; external OpenSSH on the build server).
- ADRs: **No new ADR — 0002** (PocketBase embed + cookie bridge,
  streaming deadlines) **and 0003** (SFTP offset streaming) already
  record the durable decisions this change implements. Affected docs:
  `docs/architecture.md` (the `/files/*` section already sketches this
  surface — reconcile details if implementation diverges) and
  `AGENTS.md` (running/verifying notes if workflows change).

## Non-goals

- No sharing or roles: `vdir_shares`, viewer/editor enforcement, and
  full public browse semantics are change 6; here non-public vdirs are
  strictly owner-only and `is_public` only bypasses authentication.
- No directory listing through `/files/*` — listing stays API-only
  (change 5); a directory without `index.html` is `404`, never an
  autoindex.
- No write methods: only `GET` is served (uploads/mutations are change
  5; `HEAD` and `OPTIONS` are not pinned by this change).
- No `If-Range`, multi-range responses (ignored → full `200`),
  `Content-Disposition`/attachment naming, `Accept-Encoding`
  compression, or cache headers beyond `ETag`/`Last-Modified`/
  conditional handling.
- No SPA (change 7) and no Docker packaging (change 9).
