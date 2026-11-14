# filesystem-api Specification

## Purpose

The `/api/sf/*` filesystem surface: directory listings, remote
mutations, and uploads that stream straight to the SSH host through
the vdir sandbox — so clients can browse, reorganize, and publish
files of any size without the Stratofold host ever buffering them, and
without a dropped connection ever half-applying a mutation.

## Requirements

### Requirement: Listings resolve through the vdir sandbox

The system SHALL expose directory listing
(`POST /api/sf/vdirs/{vdirId}/ls` with a virtual path, the vdir root
when empty) that returns the entries of the remote directory at the
sandbox-resolved location — each entry carrying its name, size,
directory flag, modification time, and content version; sandbox
rejections and missing targets SHALL yield `404` with no content from
outside the root ever reachable.

#### Scenario: Listing maps the real remote subfolder

- **WHEN** a directory containing known entries exists at `<root>/docs` on the remote host and `docs` is listed through the vdir
- **THEN** the response contains exactly the remote entries, each with its real size, type, modification time, and content version

#### Scenario: Nested virtual path lists

- **WHEN** a virtual path with nested segments (e.g. `docs/sub`) resolves inside the root and is listed
- **THEN** the entries of the corresponding remote subfolder are returned

#### Scenario: Escape attempts are rejected without listing anything

- **WHEN** the virtual path attempts escape — lexically (`../`), after percent-decoding (`%2e%2e/`), or via a remote symlink pointing outside the root
- **THEN** the response is `404` and nothing outside the root is listed

#### Scenario: Unknown vdir or missing directory is not found

- **WHEN** the vdir id does not exist or the virtual path does not resolve to a remote directory
- **THEN** the response is `404`

### Requirement: Single-path metadata is available without listing the parent

The system SHALL expose `POST /api/sf/vdirs/{vdirId}/stat` with a JSON
body `{"path": …}` (an empty path or empty body means the vdir root)
returning at least `{path, name, kind, size, mtime, version}`. `kind`
SHALL be `"file"` or `"directory"`; a directory SHALL report
`size: 0`; `mtime` SHALL use the same RFC3339 form as listing entries;
the vdir root SHALL be statable.

#### Scenario: A regular file is stat-able by path

- **WHEN** a known file is stat-ed through the vdir
- **THEN** the response reports its virtual path, name, `kind: "file"`, real size, modification time, and content version

#### Scenario: A directory reports its own metadata

- **WHEN** a known directory is stat-ed
- **THEN** the response reports `kind: "directory"`, `size: 0`, the directory modification time, and a content version

#### Scenario: The vdir root is stat-able

- **WHEN** `stat` is called with an empty path
- **THEN** the vdir root itself is described with `kind: "directory"` and a stable version

#### Scenario: The requested virtual path is echoed

- **WHEN** a nested virtual path is stat-ed
- **THEN** the response `path` is the requested virtual path and `name` is its final segment

#### Scenario: Missing or escaping paths are not found

- **WHEN** the virtual path is missing, lexically escapes (`../`, an absolute path), or a remote symlink resolves outside the root
- **THEN** the response is `404` and no metadata from outside the root is returned

### Requirement: Stat follows the listing access and error rules

`stat` SHALL require the same read access as `ls`: the vdir's owner, a
`viewer` or `editor` share holder, or an anonymous request to a public
vdir; a bearer token SHALL follow the existing vdir-scope and role-cap
rules. Access SHALL be decided before any SSH dial. Failures SHALL map
like listing failures — `401` for missing or invalid credentials, `403`
for an authenticated request without a sufficient grant, `404` for
sandbox rejections and missing targets, and `503` for retryable
failures.

#### Scenario: Owner, viewer, and editor can stat

- **WHEN** the owner or a `viewer`/`editor` share holder stats a path with a valid session
- **THEN** the metadata is returned

#### Scenario: Public vdirs are stat-able anonymously

- **WHEN** an anonymous request stats a path on a public vdir
- **THEN** the metadata is returned

#### Scenario: Anonymous request to a non-public vdir is rejected

- **WHEN** a request without a valid session stats a path on a non-public vdir
- **THEN** the response is `401` and no SSH dial is observed

#### Scenario: Authenticated non-owner is forbidden

- **WHEN** an authenticated user with neither ownership nor a share stats a path on a non-public vdir
- **THEN** the response is `403` and no SSH dial is observed

#### Scenario: Bearer scope and role rules apply

- **WHEN** a viewer token, an editor token on a viewer share, a token for another vdir, or an expired/revoked token is used for `stat`
- **THEN** the response follows the existing read/bearer matrix (`403` for the wrong vdir or insufficient grant, `401` for an invalid credential) and never dials a rejected request

#### Scenario: Retryable failures are reported as unavailable

- **WHEN** `stat` exhausts its retry budget against a dropping connection
- **THEN** the response is `503`

### Requirement: Content versions change on writes and are stable otherwise

The system SHALL assign every listed, stat-able, and served file and
directory an opaque `version`. The version SHALL change after every
successful Stratofold publication at the path — including a same-size
upload within the same whole second — and SHALL remain the same across
repeated observations while no publication and no observed remote size
or whole-second modification-time change has occurred.

#### Scenario: Repeated observations are stable

- **WHEN** the same unchanged path is stat-ed or listed repeatedly
- **THEN** every observation returns the same version

#### Scenario: An upload changes the version

- **WHEN** a file is uploaded and then stat-ed
- **THEN** the version differs from the version observed before the upload

#### Scenario: A same-size, same-second upload still changes the version

- **WHEN** a file is uploaded twice with the same byte length within one whole second
- **THEN** the version after the second upload differs from the version after the first

#### Scenario: An external edit with changed metadata changes the version

- **WHEN** a file is edited outside Stratofold such that its size or its whole-second modification time changes
- **THEN** the next `stat` or `ls` reports a different version

### Requirement: Listing, stat, ETag, and conditional upload share one version

The system SHALL use the same opaque version value for the same
resolved file or directory on every surface: `ls` and `stat` SHALL
return it as `version`; the file server SHALL send it as the quoted
strong `ETag` of the file actually served; and an upload's `If-Match`
SHALL compare strongly against it. The version is a validator only and
SHALL NOT be accepted as a credential or used for authorization.

#### Scenario: Listing, stat, and ETag agree

- **WHEN** a regular file is listed, stat-ed, and fetched through `/files`
- **THEN** the entry's `version`, the stat `version`, and the response `ETag` carry the same opaque value (the ETag in its quoted form)

#### Scenario: Stat of a served index.html agrees with its ETag

- **WHEN** a directory URL serves `index.html`
- **THEN** the response `ETag` is the quoted version that `stat` reports for that `index.html` path

#### Scenario: A version from stat is accepted by a conditional upload

- **WHEN** a client uploads with `If-Match` set to the version it just stat-ed
- **THEN** the upload publishes and the target's version changes

### Requirement: Mutations are complete-or-nothing and idempotent under retry

The system SHALL expose `mkdir`, `mv`, and `rm` operations through the
vdir sandbox: `mkdir` creates the directory including missing parents
(an already-existing directory at the target is success); `mv` renames
a source to a target within the vdir, replacing an existing file
target; `rm` deletes recursively (directories including their content,
symlinks as links — never following them out of the tree). Each
operation SHALL either apply completely or not at all, and SHALL be
retryable across connection drops such that a retried operation never
partially applies, never duplicates its effect, and converges to the
same final state as a single application.

#### Scenario: Nested mkdir creates parents

- **WHEN** `mkdir` targets `a/b/c` where `a` and `a/b` do not exist
- **THEN** the full chain is created and a subsequent `ls` of `a/b` shows `c`

#### Scenario: Mkdir of an existing directory succeeds

- **WHEN** `mkdir` targets a path that already exists as a directory
- **THEN** the operation succeeds without altering the directory

#### Scenario: Mv moves content byte-exactly

- **WHEN** `mv` renames a file within the vdir
- **THEN** the content at the target equals the source content (checksum equality) and the source no longer exists

#### Scenario: Mv replaces an existing file target

- **WHEN** `mv` renames a file onto an existing file target
- **THEN** the target is replaced by the source content and the source no longer exists

#### Scenario: Rm removes recursively

- **WHEN** `rm` targets a directory tree with nested files and subdirectories, including a symlink inside the tree
- **THEN** the whole tree and the symlink (as a link) are removed and nothing outside the tree is touched

#### Scenario: Disconnect during a mutation is retried transparently

- **WHEN** the SSH connection is dropped during `mkdir`, `mv`, or `rm` and reconnection succeeds
- **THEN** the operation is retried and the final remote state is exactly as if it had been applied once — never a half-created chain, never both source and target after `mv`, never a partially deleted tree

### Requirement: Uploads stream to the remote with atomic publication

The system SHALL expose upload
(`POST /api/sf/vdirs/{vdirId}/upload?path=…`) that streams the request
body directly into bounded remote writes as bytes arrive — peak host
memory bounded by the transfer window regardless of file size — and
SHALL publish the target atomically: bytes are written under a
temporary remote name and renamed to the target path only after the
final byte is acknowledged, so an interrupted or unresumable upload
SHALL leave no file at the target path. A disconnected upload SHALL
resume at the last acknowledged offset rather than restarting, and an
upload that cannot resume SHALL fail loudly.

#### Scenario: Uploaded bytes are byte-exact

- **WHEN** a file is uploaded to a target path and then read back through the vdir
- **THEN** the remote content checksum equals the uploaded body's checksum

#### Scenario: Multi-gigabyte upload keeps host memory flat

- **WHEN** a multi-gigabyte body is uploaded end to end
- **THEN** the process peak memory stays within the bounded transfer budget regardless of file size

#### Scenario: Mid-upload disconnect resumes at the acknowledged offset

- **WHEN** the SSH connection is dropped mid-upload and reconnection succeeds
- **THEN** the upload continues from the last acknowledged offset and the published file's checksum equals the uploaded body's

#### Scenario: Interrupted upload leaves no file at the target

- **WHEN** an upload fails permanently or exhausts its resume attempts
- **THEN** the request fails with an explicit error and no file exists at the target path (and no partial content is discoverable under the target name)

#### Scenario: Upload into a missing parent directory is not found

- **WHEN** an upload targets a path whose parent directory does not exist on the remote
- **THEN** the response is `404` and nothing is written

#### Scenario: Published upload reports its size

- **WHEN** an upload completes successfully
- **THEN** the response identifies the published target path and the exact number of bytes published

#### Scenario: Upload over an existing file replaces it

- **WHEN** an upload targets a path where a file already exists
- **THEN** the published file's content equals the new uploaded body, fully replacing the previous content

### Requirement: Conditional uploads enforce a publish-time precondition

The system SHALL accept `If-Match` on
`POST /api/sf/vdirs/{vdirId}/upload?path=…` and decide it with strong
comparison: one or more strong entity tags match only the exact current
version, `*` requires the target to exist, and weak tags never match. A
mismatch SHALL return `412 Precondition Failed`, publish nothing, and
remove the upload's temporary file; when the target exists, the `412`
body SHALL include its current version so a client can resync. A missing
parent or sandbox rejection SHALL remain `404`. The upload route's CORS
preflight SHALL allow `If-Match`.

#### Scenario: A matching precondition publishes

- **WHEN** an upload carries `If-Match` equal to the target's current version
- **THEN** the file is published, the response is successful, and the target carries new content

#### Scenario: A stale precondition publishes nothing

- **WHEN** an upload carries `If-Match` for an older version while the target has newer content
- **THEN** the response is `412` with the current version, the newer content is unchanged, and no upload temp file remains

#### Scenario: A conditional upload of a missing target fails

- **WHEN** an upload carries a version or `*` in `If-Match` and the target does not exist
- **THEN** the response is `412` and nothing is created

#### Scenario: Star requires existence but not a specific version

- **WHEN** an upload carries `If-Match: *` and the target exists
- **THEN** the upload publishes regardless of the target's previous version

#### Scenario: No If-Match keeps create-or-replace behavior

- **WHEN** an upload omits `If-Match`
- **THEN** the upload creates or replaces the target exactly as before

#### Scenario: A change during a long upload is caught

- **WHEN** the target's version changes after the upload starts but before the body finishes
- **THEN** publication fails with `412`, the other writer's content remains, and the temp file is removed

#### Scenario: Concurrent uploads cannot both pass the same precondition

- **WHEN** two uploads carrying the same matching `If-Match` race to publish the same target
- **THEN** exactly one publishes and the other returns `412`, leaving the winner's content intact

#### Scenario: Cross-origin upload preflights accept If-Match

- **WHEN** a foreign origin sends an upload preflight requesting `if-match`
- **THEN** `Access-Control-Allow-Headers` includes `If-Match` and the preflight succeeds

### Requirement: Access control on the filesystem API

The system SHALL decide access before any remote operation. A request
MAY authenticate with the `sf_session` cookie or with a vdir-scoped
bearer token (`Authorization: Bearer …`). `ls` requires read access: the
vdir's owner, a `viewer` or `editor` share holder, or — on the
cookie/anonymous path — a public vdir. `mkdir`, `mv`, `rm`, and `upload`
require the owner or an `editor` share on every vdir. A bearer token
SHALL be accepted only on its own vdir and only while its user holds a
grant at least as strong as the operation requires: a `viewer` token may
read but never write, and an `editor` token may write only where the user
is still an owner or editor. Invalid, expired, or revoked tokens are
`401`; a valid token on another vdir or a user without a sufficient
grant is `403`; an anonymous request to a non-public vdir is `401`;
`is_public` never implies write. A bearer credential SHALL be
authoritative when present, even if a valid cookie is also sent, and
rejected requests never dial.

#### Scenario: Owner operates on own vdir

- **WHEN** the owner calls `ls`, `mkdir`, `mv`, `rm`, or `upload` on a non-public vdir with a valid session
- **THEN** each operation executes

#### Scenario: Viewer lists but cannot write

- **WHEN** a holder of a `viewer` share calls `ls` on the vdir with a valid session, then calls `mkdir`, `mv`, `rm`, or `upload`
- **THEN** the listing is served and every write attempt is rejected with `403` before any remote operation

#### Scenario: Editor executes every operation

- **WHEN** a holder of an `editor` share calls `ls`, `mkdir`, `mv`, `rm`, or `upload` on the vdir with a valid session
- **THEN** each operation executes with the same semantics as for the owner

#### Scenario: Anonymous request to a non-public vdir is rejected

- **WHEN** a request without a valid session targets any operation on a non-public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: Authenticated non-owner is forbidden

- **WHEN** an authenticated user with neither ownership nor a share targets a non-public vdir
- **THEN** the response is `403`

#### Scenario: Public vdir allows anonymous listing only

- **WHEN** an anonymous request lists a public vdir
- **THEN** the listing is served; the same anonymous request to `mkdir`, `mv`, `rm`, or `upload` on that vdir is rejected with `401`

#### Scenario: Invalid sessions are unauthenticated

- **WHEN** a request presents an expired, invalidated, or forged session to a non-public vdir
- **THEN** the response is `401`

#### Scenario: A viewer token lists but cannot write

- **WHEN** a request carries a `viewer` token for the vdir and calls `ls`, then `mkdir`, `mv`, `rm`, or `upload`
- **THEN** the listing is served and every write attempt is rejected with `403` before any remote operation

#### Scenario: An editor token executes every operation

- **WHEN** a request carries an `editor` token for the vdir and calls `ls`, `mkdir`, `mv`, `rm`, or `upload`
- **THEN** each operation executes with the same semantics as for the owner

#### Scenario: An owner's viewer token cannot write

- **WHEN** the owner mints a `viewer` token and uses it for `mkdir`, `mv`, `rm`, or `upload`
- **THEN** every write is rejected with `403` despite the owner's own role

#### Scenario: A token on another vdir is forbidden

- **WHEN** a token scoped to vdir A is used for any filesystem operation on non-public vdir B
- **THEN** the response is `403` and no remote operation is performed

#### Scenario: An expired or revoked token is unauthenticated

- **WHEN** a request presents an expired or revoked token to a non-public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: A token cannot exceed the user's current grant

- **WHEN** an `editor` token is used after its user's share is downgraded to `viewer` or removed
- **THEN** write operations are rejected with `403` (and a removed share rejects reads too)

#### Scenario: A bad bearer is not rescued by a cookie

- **WHEN** a request carries an invalid bearer token and a valid `sf_session` cookie
- **THEN** the response is `401`

#### Scenario: Rejected bearer requests never dial

- **WHEN** a wrong-vdir, expired, revoked, or insufficiently granted token request is issued against the test fixture
- **THEN** no SSH dial is observed

### Requirement: API errors are classified and mapped deterministically

The system SHALL apply the connection manager's error classification
to API operations: retryable failures are retried within the request
through the manager's backoff, and permanent failures (permission
denied, not found, host key mismatch, sandbox rejection) are never
retried and map to deterministic HTTP statuses — sandbox rejections
and missing targets `404`, permission denied `403`, invalid request
shape `400` — independent of which operation produced them.

#### Scenario: Retryable failure is retried within the request

- **WHEN** an operation fails with a connection loss or EOF and the connection recovers
- **THEN** the request completes successfully via retry without surfacing the drop

#### Scenario: Permanent failure is not retried and maps deterministically

- **WHEN** an operation fails with permission denied, or a target does not exist
- **THEN** the error surfaces immediately — no retry attempts — as `403` or `404` respectively

#### Scenario: Exhausted retries fail the request

- **WHEN** retryable failures exhaust the configured attempt budget
- **THEN** the request fails with a retryable-class error status and the remote state reflects no partial application

### Requirement: Concurrent operations multiplex safely over the managed connection

The system SHALL serve parallel API operations targeting the same
connection concurrently over its single SFTP channel such that each
operation's result is exactly as if executed alone — no interleaving
corruption, no cross-talk between targets.

#### Scenario: Parallel uploads land independently

- **WHEN** multiple uploads to distinct target paths run concurrently on one vdir
- **THEN** every published file's content equals its own uploaded body (checksum equality)

#### Scenario: Mixed parallel operations do not corrupt each other

- **WHEN** listings, mutations, and uploads run concurrently against one vdir
- **THEN** each completes with its own expected outcome and no operation observes another's intermediate state (e.g. no partially written file visible at a target path)
