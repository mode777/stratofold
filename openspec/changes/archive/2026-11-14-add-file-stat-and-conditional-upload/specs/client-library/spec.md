# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
