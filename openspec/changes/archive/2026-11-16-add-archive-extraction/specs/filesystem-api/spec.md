# Spec Delta

## MODIFIED Requirements

### Requirement: Listings resolve through the vdir sandbox

The system SHALL expose directory listing
(`POST /api/sf/vdirs/{vdirId}/ls` with a virtual path, the vdir root
when empty) that returns the entries of the remote directory at the
sandbox-resolved location — each entry carrying its name, size,
directory flag, modification time, and content version; sandbox
rejections and missing targets SHALL yield `404` with no content from
outside the root ever reachable. Entries that are Stratofold's own
in-flight scratch artifacts — the temporary file and directory names it
creates for upload publication and archive extraction — SHALL NOT be
listed, while legitimate dot-prefixed remote entries SHALL still be
listed.

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

#### Scenario: In-flight scratch entries are not listed

- **WHEN** a directory is listed while an upload or an extraction is writing its temporary name there
- **THEN** the temporary file or directory is absent from the listing, and it never appears under the name of the operation's final target

#### Scenario: Legitimate dot-prefixed entries still list

- **WHEN** the remote directory genuinely contains dot-prefixed entries such as `.bashrc` or a `.git` directory
- **THEN** those entries are listed normally, because only Stratofold's own scratch names are filtered

### Requirement: Access control on the filesystem API

The system SHALL decide access before any remote operation. A request
MAY authenticate with the `sf_session` cookie or with a vdir-scoped
bearer token (`Authorization: Bearer …`). `ls` requires read access: the
vdir's owner, a `viewer` or `editor` share holder, or — on the
cookie/anonymous path — a public vdir. `mkdir`, `mv`, `rm`, `upload`, and
archive extraction — starting, observing, or canceling a job — require
the owner or an `editor` share on every vdir. A bearer token
SHALL be accepted only on its own vdir and only while its user holds a
grant at least as strong as the operation requires: a `viewer` token may
read but never write, and an `editor` token may write only where the user
is still an owner or editor. Invalid, expired, or revoked tokens are
`401`; a valid token on another vdir or a user without a sufficient
grant is `403`; an anonymous request to a non-public vdir is `401`;
`is_public` never implies write. A bearer credential SHALL be
authoritative when present, even if a valid cookie is also sent, and
rejected requests never dial. A running extraction SHALL re-check write
access between member batches and SHALL stop without publishing when the
grant has been withdrawn.

#### Scenario: Owner operates on own vdir

- **WHEN** the owner calls `ls`, `mkdir`, `mv`, `rm`, `upload`, or `extract` on a non-public vdir with a valid session
- **THEN** each operation executes

#### Scenario: Viewer lists but cannot write

- **WHEN** a holder of a `viewer` share calls `ls` on the vdir with a valid session, then calls `mkdir`, `mv`, `rm`, `upload`, or `extract`
- **THEN** the listing is served and every write attempt is rejected with `403` before any remote operation

#### Scenario: Editor executes every operation

- **WHEN** a holder of an `editor` share calls `ls`, `mkdir`, `mv`, `rm`, `upload`, or `extract` on the vdir with a valid session
- **THEN** each operation executes with the same semantics as for the owner

#### Scenario: Anonymous request to a non-public vdir is rejected

- **WHEN** a request without a valid session targets any operation on a non-public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: Authenticated non-owner is forbidden

- **WHEN** an authenticated user with neither ownership nor a share targets a non-public vdir
- **THEN** the response is `403`

#### Scenario: Public vdir allows anonymous listing only

- **WHEN** an anonymous request lists a public vdir
- **THEN** the listing is served; the same anonymous request to `mkdir`, `mv`, `rm`, `upload`, or `extract` on that vdir is rejected with `401`

#### Scenario: Invalid sessions are unauthenticated

- **WHEN** a request presents an expired, invalidated, or forged session to a non-public vdir
- **THEN** the response is `401`

#### Scenario: A viewer token lists but cannot write

- **WHEN** a request carries a `viewer` token for the vdir and calls `ls`, then `mkdir`, `mv`, `rm`, `upload`, or `extract`
- **THEN** the listing is served and every write attempt is rejected with `403` before any remote operation

#### Scenario: An editor token executes every operation

- **WHEN** a request carries an `editor` token for the vdir and calls `ls`, `mkdir`, `mv`, `rm`, `upload`, or `extract`
- **THEN** each operation executes with the same semantics as for the owner

#### Scenario: An owner's viewer token cannot write

- **WHEN** the owner mints a `viewer` token and uses it for `mkdir`, `mv`, `rm`, `upload`, or `extract`
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

#### Scenario: A revoked grant stops a running extraction

- **WHEN** an `editor`'s share is removed after their extraction started and the job next re-checks access
- **THEN** the job stops, publishes nothing, and reports a forbidden terminal error

#### Scenario: Another user cannot observe or cancel my extraction

- **WHEN** a user with no write access on the vdir polls or cancels another user's job id
- **THEN** the response is `403` and the running job is unaffected

## ADDED Requirements

### Requirement: Extraction failures use the filesystem API's error classes

Starting an extraction SHALL map failures that are knowable at request
time to the same deterministic statuses as the other write operations —
`400` for a malformed request or a source that is not an archive, `401`
for a missing or invalid credential, `403` for an insufficient grant,
`404` for a sandbox rejection or missing source, and `409` for an existing
target folder — and SHALL never dial for a rejected request. Failures that
occur after a job was accepted SHALL be reported on the job with a status
code drawn from the same classes rather than as an HTTP error.

#### Scenario: Creation-time refusals are HTTP statuses

- **WHEN** extraction is requested for a missing path, a non-archive, an existing target folder, or without write access
- **THEN** the responses are `404`, `400`, `409`, and `401`/`403` respectively, and no job is created

#### Scenario: Post-acceptance failures are job errors

- **WHEN** an accepted extraction later fails a sandbox, permission, conflict, or retry check
- **THEN** the job reports `failed` with the corresponding status code and message, and nothing is published

#### Scenario: A retryable outage does not become a success

- **WHEN** the connection cannot be re-established within the retry budget during a job
- **THEN** the job fails with a retryable class status, the target folder does not exist, and its temporary output is removed
