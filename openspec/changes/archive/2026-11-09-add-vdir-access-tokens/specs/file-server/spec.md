# Spec Delta

## MODIFIED Requirements

### Requirement: Access control on /files

The system SHALL serve non-public vdirs to requests carrying a valid
`sf_session` cookie of the vdir's owner or of a user holding a `viewer`
or `editor` share on the vdir, or a valid vdir-scoped bearer token whose
user currently holds at least a `viewer` grant on that vdir; public
vdirs are served to any request. A bearer token SHALL be accepted only
on its own vdir. Other requests are rejected before any remote operation
— `401` when unauthenticated or carrying an invalid, expired, or revoked
credential, `403` when authenticated but on the wrong vdir or without a
sufficient grant. A bearer credential SHALL be authoritative when
present, even if a valid session cookie is also sent. Public vdirs
remain anonymous reads and do not require a token.

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

#### Scenario: A vdir-scoped bearer token downloads

- **WHEN** a request carries a valid `viewer` or `editor` token for a non-public vdir and requests a file on that vdir
- **THEN** the file is served

#### Scenario: A token on another vdir is forbidden

- **WHEN** a token scoped to vdir A requests a file on non-public vdir B
- **THEN** the response is `403` and no remote operation is performed

#### Scenario: An expired or revoked token is unauthenticated

- **WHEN** a request carries an expired or revoked token to a non-public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: A token does not outlive the user's grant

- **WHEN** a token's user loses their ownership or share on a non-public vdir and the token requests a file
- **THEN** the response is `403`

#### Scenario: A bad bearer is not rescued by a cookie

- **WHEN** a request carries an invalid bearer token and a valid `sf_session` cookie
- **THEN** the response is `401`

#### Scenario: Public access is unchanged

- **WHEN** an anonymous request targets a public vdir, whether or not a token is present
- **THEN** the file is served
