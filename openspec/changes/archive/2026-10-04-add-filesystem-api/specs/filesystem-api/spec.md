# Spec Delta

## Purpose

The `/api/sf/*` filesystem surface: directory listings, remote
mutations, and uploads that stream straight to the SSH host through
the vdir sandbox — so clients can browse, reorganize, and publish
files of any size without the Stratofold host ever buffering them, and
without a dropped connection ever half-applying a mutation.

## ADDED Requirements

### Requirement: Listings resolve through the vdir sandbox

The system SHALL expose directory listing
(`POST /api/sf/vdirs/{vdirId}/ls` with a virtual path, the vdir root
when empty) that returns the entries of the remote directory at the
sandbox-resolved location — each entry carrying its name, size,
directory flag, and modification time; sandbox rejections and missing
targets SHALL yield `404` with no content from outside the root ever
reachable.

#### Scenario: Listing maps the real remote subfolder

- **WHEN** a directory containing known entries exists at `<root>/docs` on the remote host and `docs` is listed through the vdir
- **THEN** the response contains exactly the remote entries, each with its real size, type, and modification time

#### Scenario: Nested virtual path lists

- **WHEN** a virtual path with nested segments (e.g. `docs/sub`) resolves inside the root and is listed
- **THEN** the entries of the corresponding remote subfolder are returned

#### Scenario: Escape attempts are rejected without listing anything

- **WHEN** the virtual path attempts escape — lexically (`../`), after percent-decoding (`%2e%2e/`), or via a remote symlink pointing outside the root
- **THEN** the response is `404` and nothing outside the root is listed

#### Scenario: Unknown vdir or missing directory is not found

- **WHEN** the vdir id does not exist or the virtual path does not resolve to a remote directory
- **THEN** the response is `404`

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

### Requirement: Access control on the filesystem API

The system SHALL decide access before any remote operation: on
non-public vdirs every operation requires a valid `sf_session` session
of the vdir's owner; on public vdirs anonymous requests may list
(`ls`) only. Uploads and mutations require the owner's session on
every vdir — `401` for unauthenticated or invalid sessions, `403` for
authenticated non-owners — and rejected requests never dial.

#### Scenario: Owner operates on own vdir

- **WHEN** the owner calls `ls`, `mkdir`, `mv`, `rm`, or `upload` on a non-public vdir with a valid session
- **THEN** each operation executes

#### Scenario: Anonymous request to a non-public vdir is rejected

- **WHEN** a request without a valid session targets any operation on a non-public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: Authenticated non-owner is forbidden

- **WHEN** an authenticated user other than the owner targets a non-public vdir
- **THEN** the response is `403`

#### Scenario: Public vdir allows anonymous listing only

- **WHEN** an anonymous request lists a public vdir
- **THEN** the listing is served; the same anonymous request to `mkdir`, `mv`, `rm`, or `upload` on that vdir is rejected with `401`

#### Scenario: Invalid sessions are unauthenticated

- **WHEN** a request presents an expired, invalidated, or forged session to a non-public vdir
- **THEN** the response is `401`

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
