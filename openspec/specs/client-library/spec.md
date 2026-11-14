# client-library Specification

## Purpose

A typed, zero-dependency browser client for one vdir-scoped bearer
token, plus a static frontend-only test client that proves the package
works from a foreign origin and against a public vdir.

## Requirements

### Requirement: The package is a zero-dependency browser bundle

The system SHALL provide `@stratofold/client`, a TypeScript package with
no runtime dependencies, an ESM build for bundlers, an IIFE build that
exposes one documented global for plain `<script>` use, and bundled type
declarations. It SHALL be installable from npm and SHALL NOT be served
or embedded by the Stratofold server.

#### Scenario: A bundler consumes the package

- **WHEN** a project imports the package from its npm install
- **THEN** the ESM entry, the type declarations, and every public export resolve without extra configuration

#### Scenario: A plain page consumes the IIFE build

- **WHEN** a page loads the IIFE build with a script tag
- **THEN** one documented global exposes the same public API

#### Scenario: The package has no runtime dependencies

- **WHEN** the published package's dependency metadata and built output are inspected
- **THEN** there are no runtime dependencies, and the smoke builds run without one

#### Scenario: The server does not host the client

- **WHEN** a request targets a `/embed` path on a Stratofold instance
- **THEN** no client bundle is served from the server

### Requirement: The server address is explicit and authentication is header-only

A client SHALL be created with an explicit absolute server base URL and
a vdir id; it SHALL NOT infer the server address. When a token is
configured, every request SHALL carry it as `Authorization: Bearer …`
and SHALL never place it in a URL, query string, fragment, or body.
Requests SHALL NOT require cookies or a credentials mode.

#### Scenario: The token never appears in a URL

- **WHEN** any operation is performed with a token
- **THEN** the token is absent from every request URL and query parameter

#### Scenario: The base URL is required

- **WHEN** a client is created without an absolute base URL
- **THEN** creation fails with a rejected-argument error and no request is attempted

#### Scenario: No credentials mode is used

- **WHEN** a request is sent from a foreign origin
- **THEN** it authenticates from the header alone and sends no cookies

### Requirement: Listing and reading map to the existing endpoints

The client SHALL expose directory listing and file reading. Listing
SHALL return the entries reported by the filesystem API, each with its
name, size, directory flag, modification time, and content version,
with an empty path meaning the vdir root. Reading SHALL fetch the plain
file-server URL, forward caller-supplied range and conditional request
headers, and resolve to the response so callers can stream or consume
the body.

#### Scenario: Listing returns the directory entries

- **WHEN** a caller lists a readable directory
- **THEN** the returned entries match the server's listing for that path

#### Scenario: The root is listable

- **WHEN** a caller lists with an empty path
- **THEN** the vdir root is listed

#### Scenario: Entries carry a content version

- **WHEN** a caller lists a directory
- **THEN** every entry carries the server's opaque `version` for that path

#### Scenario: Range headers are forwarded

- **WHEN** a caller reads a file with a range header
- **THEN** the request carries that range header and the response exposes the partial content

#### Scenario: Missing paths are not found

- **WHEN** a caller lists or reads a missing path
- **THEN** the failure is the `notfound` error class

### Requirement: Single-path metadata is exposed

The client SHALL expose `stat(path, { signal })`, returning the
server's `{path, name, kind, size, mtime, version}` for one virtual
path without listing the parent directory. An empty path SHALL stat the
vdir root, and the caller's signal SHALL be forwarded to the request.

#### Scenario: A file is stat-ed

- **WHEN** a caller stats a readable file
- **THEN** the result reports `kind: "file"`, its size, modification time, and opaque version

#### Scenario: A directory and the root are stat-able

- **WHEN** a caller stats a directory path or the empty root path
- **THEN** the result reports `kind: "directory"`, `size: 0`, and a version

#### Scenario: Missing paths are not found

- **WHEN** a caller stats a missing or escaping path
- **THEN** the failure is the `notfound` error class

#### Scenario: The caller signal is forwarded

- **WHEN** a caller supplies an `AbortSignal` to `stat`
- **THEN** the request carries that signal and no retry is attempted

### Requirement: Mutations map to the filesystem API

The client SHALL expose `mkdir`, `move`, and `remove` using the
filesystem API's request shapes, resolving success without a value and
mapping server rejections to the deterministic error classes. The
client SHALL NOT retry a mutation, so a caller can rely on at most one
application per call.

#### Scenario: A directory is created

- **WHEN** a caller creates a nested path
- **THEN** the request carries that path and success resolves

#### Scenario: A path is moved

- **WHEN** a caller moves a source path to a target path
- **THEN** the request carries both paths and success resolves

#### Scenario: A path is removed

- **WHEN** a caller removes a path
- **THEN** the request carries that path and success resolves

#### Scenario: A rejected mutation is not retried

- **WHEN** a mutation is rejected by the server
- **THEN** exactly one request was sent and the failure is surfaced

### Requirement: Uploads report progress and can be aborted

The client SHALL upload a `Blob`, `File`, or `ArrayBuffer` to a target
path, reporting uploaded and total bytes as the transfer progresses,
and SHALL support aborting through a caller signal. A successful upload
SHALL resolve with the target path and size. An abort SHALL surface as
the dedicated cancellation class; a failed upload SHALL surface as a
deterministic error class. The client SHALL NOT retry an upload, and
there is no cross-request resume.

#### Scenario: Progress is reported

- **WHEN** a caller uploads a body with a progress callback
- **THEN** the callback observes transferred bytes up to the full size

#### Scenario: Abort cancels the transfer

- **WHEN** a caller aborts an in-flight upload
- **THEN** the upload rejects with the cancellation class and reports no success

#### Scenario: Success reports the target

- **WHEN** an upload completes
- **THEN** the result contains the target path and the uploaded size

#### Scenario: Failures are not retried

- **WHEN** an upload fails permanently
- **THEN** exactly one transfer was attempted and the failure class is preserved

### Requirement: Conditional uploads send If-Match and surface conflicts

The client SHALL accept `ifVersion` in the upload options and send
`If-Match` as a strong quoted entity tag; the value `*` SHALL be sent
verbatim, and omitting `ifVersion` SHALL send no `If-Match` header. A
`412` response SHALL surface as the `conflict` kind, carrying the
server's current version when present, and SHALL NOT be retried.

#### Scenario: The version becomes a quoted If-Match

- **WHEN** a caller uploads with `ifVersion` set to a stat version
- **THEN** the request carries `If-Match: "<version>"`

#### Scenario: Star is sent verbatim

- **WHEN** a caller uploads with `ifVersion: "*"`
- **THEN** the request carries `If-Match: *`

#### Scenario: A matching version publishes

- **WHEN** a caller uploads with the target's current version
- **THEN** the upload succeeds and resolves with the target path and size

#### Scenario: A stale version is a conflict

- **WHEN** the target changed after the caller stat-ed it
- **THEN** the upload rejects with `kind: "conflict"`, exposes the server's current version when supplied, and leaves the newer content untouched

#### Scenario: Omitting ifVersion is unchanged

- **WHEN** a caller uploads without `ifVersion`
- **THEN** the request carries no `If-Match` header and keeps today's create-or-replace behavior

#### Scenario: A conflict is not retried

- **WHEN** an upload is rejected with `412`
- **THEN** exactly one transfer was attempted

### Requirement: Temporary links and public URLs are distinct

The client SHALL expose two URL forms. A temporary media URL SHALL mint
a session-free `/s/<token>` link through the file-links API, resolve it
to an absolute URL, and return its expiry; it SHALL require a configured
token and SHALL reject locally when none is set. A plain file URL SHALL
be built from the base URL, vdir id, and virtual path without any
request and SHALL carry no credential.

#### Scenario: A temporary URL is absolute and expiring

- **WHEN** a caller requests a temporary URL for a file with a token configured
- **THEN** the result is an absolute `/s/` URL with an expiry and the token is absent from it

#### Scenario: Public mode builds plain URLs

- **WHEN** a client with no token requests a plain file URL
- **THEN** the absolute `/files/` URL is returned without a request

#### Scenario: A temporary URL needs a credential

- **WHEN** a caller without a token requests a temporary URL
- **THEN** the call rejects with the `unauthorized` class without sending a request

### Requirement: Token scope can be discovered

The client SHALL expose token scope discovery using only the bearer
token, returning the vdir identity, role, expiry, last use, and a
non-secret hint — never the plaintext token. This SHALL let a caller
that knows only the server address and token reach the scoped vdir.

#### Scenario: Scope is discovered from the token

- **WHEN** a caller with a valid token asks for its scope
- **THEN** the result names the vdir, its id, the role, and the expiry

#### Scenario: The plaintext is never returned

- **WHEN** the scope result is inspected
- **THEN** it contains only the non-secret hint, never the token

#### Scenario: An invalid token fails cleanly

- **WHEN** scope discovery uses an invalid or expired token
- **THEN** the failure is the `unauthorized` error class

### Requirement: Failures use deterministic error classes

Every failure SHALL carry a machine-readable kind plus the HTTP status
and message, mapping `401` to `unauthorized`, `403` to `forbidden`,
`404` to `notfound`, `412` to `conflict`, `503` to `retryable`, `400`
and other `4xx` to `rejected`, and `5xx` to `server`; a network failure
with no status SHALL map to `retryable` with status `0`. The client
SHALL NOT automatically retry any operation.

#### Scenario: Each status maps to its class

- **WHEN** the server answers `401`, `403`, `404`, `400`, `412`, `503`, or `500`
- **THEN** the surfaced kind is `unauthorized`, `forbidden`, `notfound`, `rejected`, `conflict`, `retryable`, or `server` respectively

#### Scenario: A precondition failure is a conflict

- **WHEN** the server answers `412` to an upload
- **THEN** the surfaced kind is `conflict`, not `rejected`, and the error carries the server's current version when it supplied one

#### Scenario: A dropped connection is retryable

- **WHEN** a request fails before any status is received
- **THEN** the surfaced kind is `retryable` with status `0`

#### Scenario: Cancellation is distinct from failure

- **WHEN** an upload is canceled by the caller
- **THEN** the surfaced error is the cancellation class, not a failure kind

### Requirement: The static test client is safe and runtime-configured

The system SHALL provide a frontend-only test client deployable to
GitHub Pages under a subpath. It SHALL take the server base URL and
token at runtime, persist them only in the visitor's browser, and
SHALL contain no checked-in instance URL or token, nor any such value
in the deployed build. It SHALL exercise listing, reading/downloading,
upload, mkdir, move, remove, scope discovery, temporary URLs, and
public mode, and SHALL surface each operation's result or
deterministic error.

#### Scenario: The deployed client carries no secret

- **WHEN** the production test-client build is inspected
- **THEN** it contains no token and no default instance URL

#### Scenario: Configuration is runtime and local

- **WHEN** a visitor enters a server URL and token
- **THEN** subsequent operations use them and the values persist only in that browser

#### Scenario: Every operation is reachable

- **WHEN** a visitor uses the test client against a vdir
- **THEN** listing, reading, upload, mkdir, move, remove, scope discovery, and temporary URL are each invocable

#### Scenario: Public mode needs no token

- **WHEN** the test client is pointed at a public vdir without a token
- **THEN** listing and reading succeed and token-only actions are unavailable

#### Scenario: The Pages build serves under a subpath

- **WHEN** the built test client is opened under the GitHub Pages repository subpath
- **THEN** its assets and navigation work without rewriting the base URL

### Requirement: Cross-origin use is verified end to end

The package and test client SHALL be verified from a real foreign
origin against a running Stratofold stack: preflighted bearer, JSON,
and upload requests SHALL succeed without cookies, the plain file read
SHALL expose its representation headers, and a temporary link SHALL be
redeemable from a cookieless request.

#### Scenario: A second-origin client lists and uploads

- **WHEN** the test client runs on a different origin from the server
- **THEN** listing, uploading, and range reading succeed with no cookies

#### Scenario: A temporary link redeems without credentials

- **WHEN** the test client mints a temporary URL and fetches it cookieless
- **THEN** the file bytes are returned

#### Scenario: No token appears in any URL

- **WHEN** the cross-origin flow is observed at the browser level
- **THEN** no request URL carries the token
