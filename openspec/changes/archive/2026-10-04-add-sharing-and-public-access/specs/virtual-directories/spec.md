# Spec Delta

## MODIFIED Requirements

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
