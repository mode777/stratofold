# virtual-directories Specification

## Purpose

Gives every Stratofold user an isolated, owner-managed window onto a
remote host: SSH connections and virtual directories are stored as
records, and every path accessed through a virtual directory is pinned
inside that directory's root — traversal, encoding tricks, and remote
symlinks cannot escape it.

## Requirements

### Requirement: Connections are owner-managed records

The system SHALL store SSH connection definitions (host, port, username,
auth method, an optional pinned host-key fingerprint, and a default
remote directory) as records that only their owner can list, view,
create, update, or delete. A connection MAY be created without a pinned
fingerprint, in which case the fingerprint is captured on first
successful use; the remote directory defaults to the location a vdir on
that connection starts from.

#### Scenario: Owner manages own connection

- **WHEN** an authenticated user creates, views, updates, or deletes a connection record they own
- **THEN** each operation succeeds

#### Scenario: Non-owner is denied connection access

- **WHEN** a user attempts to view, update, or delete a connection record owned by a different user
- **THEN** every attempt is denied and the record's contents are not revealed

#### Scenario: Anonymous access is denied

- **WHEN** an unauthenticated request targets the connections collection
- **THEN** the request is denied

#### Scenario: Connection without a fingerprint is accepted

- **WHEN** an authenticated user creates a connection record omitting the host-key fingerprint
- **THEN** the record is created and the owner can use it

#### Scenario: Remote directory is stored and returned

- **WHEN** an authenticated user creates or updates a connection record with a remote directory
- **THEN** the record stores the directory and returns it to the owner on subsequent reads

### Requirement: Virtual directories are owner-managed and bound to own connections

The system SHALL store virtual directories as records whose create,
update, and delete operations are restricted to their owner, and SHALL
reject the creation of a virtual directory that references a connection
the owner does not own; listing and viewing SHALL additionally be
permitted for authenticated users holding a share on the vdir.

#### Scenario: Owner creates a vdir over own connection

- **WHEN** an authenticated user creates a virtual directory referencing a connection record they own, with a name and a remote root path
- **THEN** the record is created

#### Scenario: Vdir over another user's connection is rejected

- **WHEN** a user attempts to create a virtual directory referencing a connection record owned by a different user
- **THEN** the creation is rejected

#### Scenario: Shared user views a shared vdir

- **WHEN** an authenticated user holding a share on a vdir lists the vdirs collection or views that vdir record
- **THEN** the operation succeeds

#### Scenario: Non-owner is denied vdir access

- **WHEN** an authenticated user holding no share on a virtual directory attempts to view, update, or delete a vdir owned by a different user
- **THEN** every attempt is denied and the record's contents are not revealed

#### Scenario: Shared users cannot modify the vdir record

- **WHEN** a user holding a viewer or editor share attempts to update or delete the shared vdir record, or to change its `is_public` flag or connection binding
- **THEN** every attempt is denied — record management stays owner-only

### Requirement: Connection secrets are encrypted at rest and never exposed

The system SHALL store connection secrets (password, private key,
passphrase) encrypted at rest, SHALL NOT include them in any API
response (including responses to the owner), and SHALL use them only
server-side when establishing the SSH connection.

#### Scenario: Secret fields are absent from API responses

- **WHEN** any client, including the owner, fetches a connection record
- **THEN** the response contains no password, private key, or passphrase material

#### Scenario: Stored record does not contain the plaintext secret

- **WHEN** a connection record with a secret has been persisted
- **THEN** the stored record data contains no plaintext form of that secret

#### Scenario: Secret is still used for dialing

- **WHEN** an operation needs the connection and the stored (encrypted) secret decrypts to valid credentials for the remote host
- **THEN** the SSH connection is established with those credentials

### Requirement: One managed connection per connection record

The system SHALL dial and manage at most one SSH connection per
connection record, on demand when a virtual directory over it is first
used, and SHALL apply the record's pinned host-key fingerprint and
credentials to every such connection.

#### Scenario: Vdirs sharing a connection share the managed connection

- **WHEN** multiple virtual directories reference the same connection record and are used concurrently
- **THEN** all operations run through a single managed connection for that record

#### Scenario: Updated record takes effect

- **WHEN** a connection record's target or credentials are changed and a subsequent operation uses a virtual directory over it
- **THEN** the operation connects according to the updated record, not the previous one

### Requirement: Virtual paths resolve only inside the vdir root

The system SHALL resolve every virtual path against its virtual
directory's root such that the resulting remote path is always inside
that root, and SHALL reject — without performing any remote operation —
any virtual path that cannot be so resolved, including traversal
sequences, encoded dot segments, absolute path forms, null bytes, and
backslash-based escape attempts.

#### Scenario: Parent traversal is rejected

- **WHEN** a virtual path containing `..` segments that would climb above the root is resolved (e.g. `../../etc/passwd`)
- **THEN** the resolution is rejected and no remote operation occurs

#### Scenario: Encoded dot segments are rejected after decoding

- **WHEN** a virtual path whose dot segments are percent-encoded (e.g. `%2e%2e/`) decodes to a traversal form
- **THEN** the resolution is rejected exactly as for the decoded traversal path

#### Scenario: Absolute path form is rejected

- **WHEN** a virtual path is supplied in absolute form (leading `/`, e.g. `/etc/passwd`)
- **THEN** the resolution is rejected

#### Scenario: Null bytes are rejected

- **WHEN** a virtual path contains a null byte
- **THEN** the resolution is rejected

#### Scenario: Redundant segments resolve to the canonical path inside the root

- **WHEN** a virtual path contains redundant segments (e.g. `docs/./a.txt`, `docs//a.txt`, `docs/sub/../a.txt`) that remain inside the root
- **THEN** the path resolves to the canonical path under the root

#### Scenario: Backslash segments cannot escape

- **WHEN** a virtual path contains backslash-based segments (e.g. `..\..\etc\passwd`)
- **THEN** the path never resolves outside the root (backslashes are ordinary filename characters, not separators)

### Requirement: Remote symlink escapes are detected and rejected

After lexical resolution, the system SHALL resolve the remote path on
the server and SHALL reject the operation if the server-resolved
location falls outside the server-resolved vdir root, so that remote
symlinks cannot make the sandbox leak.

#### Scenario: Symlink pointing outside the root is rejected

- **WHEN** a virtual path resolves lexically inside the root but the remote target is a symlink pointing outside the root
- **THEN** the operation is rejected

#### Scenario: Paths within the root, including via internal symlinks, are accepted

- **WHEN** a virtual path's server-resolved location remains inside the server-resolved root, including when it passes through a symlink that stays inside the root
- **THEN** the operation proceeds

#### Scenario: Symlinked vdir root is the baseline

- **WHEN** the vdir's root path itself is a symlink on the remote host
- **THEN** containment is enforced against the root's server-resolved location, and paths inside it are accepted

### Requirement: Resolution maps the vdir onto the actual remote subfolder

The system SHALL resolve virtual paths onto the real remote filesystem:
content read through a resolved virtual path is byte-identical to the
content at the corresponding location under the vdir's root path on the
remote host, and nothing outside that root is reachable through the
vdir.

#### Scenario: Virtual path addresses the remote subfolder

- **WHEN** a file exists at `<root>/docs/a.txt` on the remote host and it is read through the virtual path `docs/a.txt`
- **THEN** the returned bytes equal the remote file's bytes exactly

#### Scenario: Remote content outside the root is unreachable

- **WHEN** a file exists on the same remote host but outside the vdir root and is addressed through the vdir
- **THEN** every attempt to reach it through the vdir is rejected
