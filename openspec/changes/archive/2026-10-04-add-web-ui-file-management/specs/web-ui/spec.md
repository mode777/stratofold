# Spec Delta

## ADDED Requirements

### Requirement: File-management actions are offered only where the user may write

The browse view SHALL offer create-folder, rename, move, and delete for
entries, gated by write permission — owner or `editor` share on the
vdir; viewers, other users, and anonymous/public browsing SHALL NOT be
offered write actions, and a rejected write (`403`) SHALL surface the
forbidden state.

#### Scenario: Owner or editor sees write actions

- **WHEN** the owner or an `editor` share holder browses a vdir
- **THEN** create-folder, rename, move, and delete are available for entries

#### Scenario: Viewer sees no write actions

- **WHEN** a `viewer` share holder browses the vdir
- **THEN** no create-folder, rename, move, or delete action is offered

#### Scenario: Forbidden write is surfaced

- **WHEN** a write action is rejected with `403`
- **THEN** the forbidden state is shown and the action is not repeated

### Requirement: File-management actions update the listing

The SPA SHALL perform create-folder, rename, move, and delete through
the filesystem API, require confirmation before a destructive delete,
and reflect a successful action in the current listing without a manual
reload; a not-found target (`404`) SHALL surface the not-found state.

#### Scenario: Create folder adds it to the listing

- **WHEN** the user creates a folder in the current directory
- **THEN** the new folder appears in the listing

#### Scenario: Rename or move updates the entry

- **WHEN** the user renames or moves an entry
- **THEN** the listing reflects the new name or location

#### Scenario: Delete requires confirmation and removes the entry

- **WHEN** the user deletes an entry and confirms
- **THEN** the entry disappears from the listing; declining the confirmation leaves it unchanged

#### Scenario: Missing target shows not-found

- **WHEN** a rename, move, or delete targets a path that no longer exists (`404`)
- **THEN** the not-found state is shown

### Requirement: Uploads start from the directory being browsed

The SPA SHALL let a user select one or more files and upload them into
the directory currently being browsed, handing them to the upload
manager without blocking the current view.

#### Scenario: Upload targets the current directory

- **WHEN** the user selects files while browsing a directory
- **THEN** the files are enqueued with that directory's virtual path as the upload target

#### Scenario: Upload does not block navigation

- **WHEN** the user starts an upload
- **THEN** the view stays interactive and the user can continue browsing or navigate away
