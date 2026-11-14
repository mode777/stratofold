# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
