# Spec Delta

## MODIFIED Requirements

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
