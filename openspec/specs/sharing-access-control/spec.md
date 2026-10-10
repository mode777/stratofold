# sharing-access-control Specification

## Purpose

Defines who may browse, download, and mutate a virtual directory:
owner-managed per-user shares with `viewer`/`editor` roles, public
read-only vdirs, identical enforcement across the record API, the
filesystem API, and `/files`, and revocation that takes effect on the
next request.

## Requirements

### Requirement: Shares are owner-managed records with roles

The system SHALL store vdir shares as records binding a virtual
directory to a user with a role (`viewer` or `editor`), unique per
vdir and user. Only the vdir's owner SHALL create, update, or delete
its shares; a user SHALL be able to list and view the shares that
target them; every other access to a share SHALL be denied.

#### Scenario: Owner grants a role

- **WHEN** the vdir's owner creates a share on their vdir for another user with role `viewer` or `editor`
- **THEN** the share record is created

#### Scenario: Duplicate share for the same vdir and user is rejected

- **WHEN** a share already exists for a vdir and user and another share for the same pair is created (in either role)
- **THEN** the creation is rejected

#### Scenario: Owner cannot be shared with themselves

- **WHEN** the vdir's owner creates a share on their own vdir naming themselves as the user
- **THEN** the creation is rejected

#### Scenario: Grantee sees exactly their own shares

- **WHEN** an authenticated user lists the shares collection
- **THEN** the response contains exactly the shares that target them, and no other user's shares

#### Scenario: Third parties are denied share access

- **WHEN** a user who is neither the vdir's owner nor the share's grantee attempts to view, update, or delete a share
- **THEN** every attempt is denied and the record's contents are not revealed

#### Scenario: Deleting the vdir removes its shares

- **WHEN** a vdir record is deleted
- **THEN** its shares cease to exist and grant no access afterwards

### Requirement: Viewer role grants browse and download

The system SHALL grant the holder of a `viewer` share on a vdir the
vdir's read operations — directory listing through the filesystem API
and file download through `/files` — and nothing more; every write
operation SHALL be denied to a viewer with `403` before any remote
operation is performed.

#### Scenario: Viewer lists and downloads

- **WHEN** a viewer lists a directory on the shared vdir and requests a file through `/files`
- **THEN** the listing is served and the download is served as if the requester were the owner

#### Scenario: Viewer writes are forbidden

- **WHEN** a viewer calls `mkdir`, `mv`, `rm`, or `upload` on the shared vdir
- **THEN** the response is `403` and no remote operation is performed

### Requirement: Editor role grants the full remote operation set

The system SHALL grant the holder of an `editor` share on a vdir every
remote operation — `ls`, `mkdir`, `mv`, `rm`, `upload`, and downloads
through `/files` — while vdir record management (update, delete,
`is_public`, connection binding) and share management remain denied to
an editor.

#### Scenario: Editor operates fully

- **WHEN** an editor calls `ls`, `mkdir`, `mv`, `rm`, or `upload` on the shared vdir
- **THEN** each operation executes with the same semantics as for the owner

#### Scenario: Editor downloads through /files

- **WHEN** an editor requests a file on the shared vdir through `/files`
- **THEN** the file is served

#### Scenario: Editor cannot manage records or shares

- **WHEN** an editor attempts to update or delete the vdir record, change `is_public` or the connection binding, or create, update, or delete a share on the vdir
- **THEN** every attempt through the record API is denied

### Requirement: Public vdirs are anonymously readable only

On a vdir marked public, the system SHALL serve anonymous directory
listing and anonymous file download; anonymous requests SHALL never be
able to write — `mkdir`, `mv`, `rm`, and `upload` require an
authenticated owner or editor regardless of `is_public` and are
rejected with `401` when the request is anonymous.

#### Scenario: Anonymous browse and download work

- **WHEN** a request without any session cookie lists a directory on a public vdir and requests a file through `/files`
- **THEN** the listing is served and the file is served

#### Scenario: Anonymous write is impossible

- **WHEN** an anonymous request calls `mkdir`, `mv`, `rm`, or `upload` on a public vdir
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: Un-publishing closes anonymous access

- **WHEN** the owner sets a public vdir's `is_public` to false and an anonymous request follows
- **THEN** the next anonymous request is rejected as unauthenticated (`401` on `/files`, `401` on the filesystem API)

### Requirement: Access is decided before any remote operation

The system SHALL resolve every request's effective access — anonymous,
no share, viewer, editor, or owner — from the vdir record and its
current shares before dialing SSH, such that a rejected request
(`401`/`403`) never establishes or uses an SSH connection.

#### Scenario: Rejected requests never dial

- **WHEN** each denied request of the permission matrix is issued against the test fixture
- **THEN** zero SSH dials are observed for that request

### Requirement: Revocation takes effect on the next request

The system SHALL evaluate access per request against the current
`vdirs` and `vdir_shares` state without cached grants, so removing a
share, changing a role, or un-publishing takes effect on the next
request even when the requester's `sf_session` cookie is still valid.

#### Scenario: Removed share cuts access immediately

- **WHEN** a viewer downloads a file, the owner deletes the share, and the same viewer's still-valid session requests the file again
- **THEN** the first download succeeds and the next is rejected with `403`

#### Scenario: Role change applies immediately

- **WHEN** a viewer's share is changed to `editor` and the same user's still-valid session next calls `upload`
- **THEN** the upload is accepted without any re-login

### Requirement: Share grantees are resolved by exact email lookup

The system SHALL expose an authenticated route
(`GET /api/sf/users/lookup?email=…`) under the custom `/api/sf/`
namespace that resolves an exact email address to the matching user's
id and email, for the sole purpose of naming share grantees; it SHALL
return at most one record, SHALL accept no listing, prefix, or search
form, and SHALL reject unauthenticated requests.

#### Scenario: Exact match resolves the grantee

- **WHEN** an authenticated user requests the lookup with the exact email of a registered user
- **THEN** the response contains that user's id and email and nothing else

#### Scenario: No match is not found

- **WHEN** an authenticated user requests the lookup with an email that is not registered
- **THEN** the response is `404` and no user information is returned

#### Scenario: Unauthenticated requests are rejected

- **WHEN** a request without a valid session calls the lookup route
- **THEN** the response is `401`

#### Scenario: Non-exact queries are rejected

- **WHEN** the lookup is called without the `email` parameter, with an empty value, or with any listing/pagination parameter
- **THEN** the response is `400` and no user data is returned

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
