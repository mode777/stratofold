# Spec Delta

## MODIFIED Requirements

### Requirement: Access control on the filesystem API

The system SHALL decide access before any remote operation: `ls`
requires a valid `sf_session` of the vdir's owner or of a holder of a
`viewer` or `editor` share (on public vdirs anonymous requests may list
only); `mkdir`, `mv`, `rm`, and `upload` require the owner or an
`editor` share on every vdir. `401` for unauthenticated or invalid
sessions, `403` for authenticated requests with neither ownership nor a
sufficient role — and rejected requests never dial.

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
