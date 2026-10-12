# Spec Delta

## MODIFIED Requirements

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
