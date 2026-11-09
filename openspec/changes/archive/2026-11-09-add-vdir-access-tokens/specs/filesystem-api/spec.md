# Spec Delta

## MODIFIED Requirements

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
