# Spec Delta

## ADDED Requirements

### Requirement: Public vdirs expose minimal anonymous metadata

The system SHALL expose a session-free route
(`GET /api/sf/vdirs/<vdir-id>/meta`) that, for a vdir marked public,
returns the vdir's name and public marker to any caller,
authenticated or not; a non-public or unknown vdir id SHALL yield
`404` with no disclosure of the record's existence or any of its
fields. The route SHALL mount under the custom `/api/sf/` namespace
and SHALL NOT require, create, or inspect a session.

#### Scenario: Anonymous metadata for a public vdir

- **WHEN** a request without any session cookie calls the meta route of a vdir marked public
- **THEN** the response contains that vdir's name and public marker and nothing else

#### Scenario: Non-public vdirs are not disclosed

- **WHEN** any request calls the meta route of a vdir that is not marked public
- **THEN** the response is `404` and no field of the vdir record is revealed

#### Scenario: Unknown vdirs are not found

- **WHEN** the meta route is called with a vdir id that does not exist
- **THEN** the response is `404`

#### Scenario: Metadata carries no sensitive fields

- **WHEN** the meta route answers for a public vdir
- **THEN** the response contains no owner, connection binding, root path, or secret material

#### Scenario: Signed-in flows are unaffected

- **WHEN** an authenticated user browses their own or a shared vdir as before
- **THEN** every existing record-API and filesystem-API behavior is unchanged; the meta route adds no new access for non-public vdirs
