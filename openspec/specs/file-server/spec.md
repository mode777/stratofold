# file-server Specification

## Purpose

Serves remote files to browsers over `/files/*` with the semantics of a
state-of-the-art static file server — streamed straight from the SSH
host through the vdir sandbox, with Range seeking, conditional
requests, and correct content headers — so plain URLs work for
downloads, `<img>`, and `<video>` without JavaScript authentication.

## Requirements

### Requirement: Files are served through the vdir sandbox

The system SHALL serve `GET /files/<vdir-id>/<virtual-path>` (and the
bare `/files/<vdir-id>` form for the root) by streaming the remote file
at the vdir-resolved location; the response bytes SHALL equal the bytes
at the corresponding location under the vdir root, and paths the
sandbox rejects or targets that do not exist SHALL yield `404`, with no
content from outside the root ever served.

#### Scenario: File content is byte-exact

- **WHEN** a file is requested through its virtual path
- **THEN** the response body equals the remote file's bytes exactly (checksum equality)

#### Scenario: Escape attempts are rejected

- **WHEN** the virtual path attempts escape — lexically (`../`), after percent-decoding (`%2e%2e/`), or via a remote symlink pointing outside the root
- **THEN** the response is `404` and nothing outside the root is served

#### Scenario: Missing targets are not found

- **WHEN** the vdir id or the virtual path does not exist on the remote
- **THEN** the response is `404`

### Requirement: Access control on /files

The system SHALL serve non-public vdirs to requests carrying a valid
`sf_session` cookie of the vdir's owner or of a user holding a
`viewer` or `editor` share on the vdir, and public vdirs to any
request; other requests are rejected before any remote operation —
`401` when unauthenticated (no cookie, or expired, invalidated, or
forged token), `403` when authenticated but holding neither ownership
nor a share on the vdir.

#### Scenario: Owner with a valid session downloads

- **WHEN** the owner requests a file on a non-public vdir with a valid `sf_session` cookie
- **THEN** the file is served

#### Scenario: Shared viewer or editor downloads

- **WHEN** a user holding a `viewer` or `editor` share on a non-public vdir requests a file on it with their valid `sf_session` cookie
- **THEN** the file is served

#### Scenario: Anonymous request to a non-public vdir is rejected

- **WHEN** a request without a valid session cookie targets a non-public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: Authenticated non-owner is forbidden

- **WHEN** an authenticated user with neither ownership nor a share requests a file on a non-public vdir
- **THEN** the response is `403`

#### Scenario: Public vdir serves anonymous requests

- **WHEN** an anonymous request targets a file on a vdir marked public
- **THEN** the file is served

#### Scenario: Invalid cookies are unauthenticated

- **WHEN** a request presents an expired, invalidated, or forged `sf_session` cookie to a non-public vdir
- **THEN** the response is `401`

### Requirement: Single-range partial responses

The system SHALL honor a single `Range: bytes=...` header on an
otherwise-200 GET: `start-end`, open-ended `start-`, and suffix
`-length` forms yield `206` with a `Content-Range:
bytes <start>-<end>/<total>` header and exactly the requested byte
slice; an `end` beyond the file's last byte clamps to it, and a suffix
length at or beyond the file size yields the whole file as `206`.

#### Scenario: Bounded range

- **WHEN** `Range: bytes=2-5` targets a 10-byte file
- **THEN** the response is `206` with `Content-Range: bytes 2-5/10` and a body of exactly the bytes at offsets 2–5

#### Scenario: Open-ended range

- **WHEN** `Range: bytes=7-` targets a 10-byte file
- **THEN** the response is `206` with `Content-Range: bytes 7-9/10` and the bytes at offsets 7–9

#### Scenario: Suffix range

- **WHEN** `Range: bytes=-3` targets a 10-byte file
- **THEN** the response is `206` with `Content-Range: bytes 7-9/10` and the last 3 bytes

#### Scenario: End clamped to the last byte

- **WHEN** `Range: bytes=8-100` targets a 10-byte file
- **THEN** the response is `206` with `Content-Range: bytes 8-9/10`

#### Scenario: Oversized suffix range serves the whole file

- **WHEN** `Range: bytes=-50` targets a 10-byte file
- **THEN** the response is `206` with `Content-Range: bytes 0-9/10` and the whole file

### Requirement: Unsatisfiable and malformed Range headers

The system SHALL reject a syntactically valid `bytes` Range that cannot
be satisfied with `416` and a `Content-Range: bytes */<total>` header,
and SHALL ignore Range headers it cannot parse or honor (foreign units,
multiple ranges, malformed values) by serving the full file with `200`.

#### Scenario: Start beyond EOF is unsatisfiable

- **WHEN** `Range: bytes=10-` targets a 10-byte file
- **THEN** the response is `416` with `Content-Range: bytes */10`

#### Scenario: Zero-length suffix is unsatisfiable

- **WHEN** `Range: bytes=-0` targets any file
- **THEN** the response is `416`

#### Scenario: Multiple ranges are ignored

- **WHEN** `Range: bytes=0-1,3-4` targets a file
- **THEN** the full file is served with `200`

#### Scenario: Malformed or foreign-unit Range is ignored

- **WHEN** `Range: bytes=abc` or `Range: chunks=0-1` targets a file
- **THEN** the full file is served with `200`

### Requirement: Conditional requests short-circuit to 304

The system SHALL send `ETag` and `Last-Modified` on served responses
and SHALL answer conditional GETs: a matching `If-None-Match` (a listed
tag or `*`) yields `304` without a body, otherwise a
`Last-Modified` at or after `If-Modified-Since` yields `304`; when both
headers are present `If-None-Match` takes precedence, and conditional
evaluation precedes Range handling.

#### Scenario: If-None-Match match yields 304

- **WHEN** a GET carries `If-None-Match` matching the file's current ETag
- **THEN** the response is `304` without a body

#### Scenario: If-Modified-Since not modified yields 304

- **WHEN** a GET carries `If-Modified-Since` at or after the file's Last-Modified instant
- **THEN** the response is `304` without a body

#### Scenario: Stale validators yield full content

- **WHEN** a GET carries validators that do not match the file's current state
- **THEN** the file is served in full (`200` or `206` per Range)

#### Scenario: If-None-Match takes precedence

- **WHEN** a GET carries a matching `If-None-Match` and a stale `If-Modified-Since`
- **THEN** the response is `304` (not evaluated against `If-Modified-Since`)

### Requirement: Content headers identify the representation

The system SHALL set `Content-Type` from a built-in, deterministic
extension→type table (e.g. `.html` → `text/html`, `.mp4` →
`video/mp4`), defaulting to `application/octet-stream`; SHALL set
`Content-Length` to the exact number of body bytes delivered; and SHALL
advertise `Accept-Ranges: bytes` on successful GET responses.

#### Scenario: Known extension maps to its type

- **WHEN** files with extensions from the table are requested
- **THEN** each response carries the table's Content-Type for that extension

#### Scenario: Unknown extension defaults to octet-stream

- **WHEN** a file with an extension absent from the table is requested
- **THEN** the response Content-Type is `application/octet-stream`

#### Scenario: Content-Length matches the delivery

- **WHEN** a full GET and a Range GET target the same file
- **THEN** Content-Length equals the file size on the full response and the range length on the partial response

### Requirement: Directory URLs resolve index.html

The system SHALL treat a virtual path that resolves to a remote
directory as a request for `<dir>/index.html` — served when present,
`404` when absent (never an autoindex or listing); a directory
addressed without a trailing slash SHALL redirect (`301`) to the
slashed form; a file addressed with a trailing slash SHALL be `404`.

#### Scenario: Directory with index.html serves it

- **WHEN** a directory containing `index.html` is requested
- **THEN** the `index.html` content is served with `200`

#### Scenario: Directory without index.html is 404

- **WHEN** a directory without `index.html` is requested
- **THEN** the response is `404`, with no directory listing generated

#### Scenario: Bare vdir root behaves as the root directory

- **WHEN** `/files/<vdir-id>` is requested and the vdir root contains `index.html`
- **THEN** the root `index.html` is served

#### Scenario: Unslashed directory URL redirects

- **WHEN** a directory is addressed without a trailing slash
- **THEN** the response is `301` with a `Location` pointing at the slashed form

#### Scenario: File with trailing slash is 404

- **WHEN** a regular file is addressed with a trailing slash
- **THEN** the response is `404`

### Requirement: Responses stream without host buffering and survive disconnects

The system SHALL stream responses from the remote source via offset
reads, such that serving a multi-gigabyte file does not require holding
the file in host memory; SHALL resume a response's remote reads at the
last served offset when the connection drops mid-response; and SHALL
clear per-request deadlines so long responses are not aborted by HTTP
timeout defaults.

#### Scenario: Multi-gigabyte file streams fully

- **WHEN** a multi-gigabyte sparse file is downloaded start to finish
- **THEN** the delivered bytes checksum-match the source and the host process's peak memory stays flat

#### Scenario: Mid-transfer drop resumes in-response

- **WHEN** the SSH connection is killed during an in-flight response
- **THEN** the transfer resumes at the last served offset within the same response and the completed body is byte-exact

#### Scenario: Client Range retry after an aborted response succeeds

- **WHEN** a response is aborted mid-transfer and the client retries with `Range` starting at the last offset it received
- **THEN** the retry returns the remaining bytes exactly, completing the file

#### Scenario: Long response outlives HTTP defaults

- **WHEN** a response runs longer than the HTTP server's default write timeout
- **THEN** it completes rather than being aborted by a timeout
