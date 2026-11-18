# Spec Delta

## ADDED Requirements

### Requirement: The browse listing is a drop zone for writers

The browse view's listing area — including the empty-directory state —
SHALL accept OS file drags for users who may write on the vdir (owner
or `editor`): dropping one or more files SHALL enqueue them into the
directory being browsed through the upload manager exactly as the
picker path does, a drag hovering the listing SHALL visibly mark it as
an active drop target (and stop marking it when the drag leaves), and
viewers and anonymous public visitors SHALL get no drop behavior. A
dragged payload containing no files SHALL do nothing.

#### Scenario: Dropped files upload into the browsed directory

- **WHEN** a writer drops one or more files onto the listing of directory `docs`
- **THEN** each file is enqueued with `docs` as its target directory and uploads without blocking the view

#### Scenario: A hovering drag marks the drop target

- **WHEN** a file drag hovers the listing and the user can write there
- **THEN** the listing is visibly marked as an active drop target, and the marking disappears when the drag leaves or is dropped

#### Scenario: The empty state invites dropping

- **WHEN** a writer browses an empty directory
- **THEN** the empty state states that files and folders can be dropped there

#### Scenario: Viewers get no drop behavior

- **WHEN** a viewer share holder or an anonymous public visitor drags files over or onto the listing
- **THEN** the SPA offers no drop targeting and starts no upload

#### Scenario: Non-file drags do nothing

- **WHEN** a drag carrying no files (for example selected text) is dropped onto the listing
- **THEN** the SPA starts no upload and shows no error

### Requirement: Dropped folders upload with their structure

Dropping one or more folders onto the listing SHALL enqueue the
dropped folder as a subfolder of the browsed directory (its name
preserved), every file inside it — at any depth — with its relative
path beneath that folder, a folder item for each directory so parents
exist before their files, and empty folders created; files and folders
dropped together SHALL all upload. Where the SPA cannot read a drag's
folder structure, it SHALL fall back to uploading the readable files
of that drag.

#### Scenario: A folder drop preserves the tree

- **WHEN** a writer drops a folder `photos` containing `sub/a.jpg` and `b.jpg` onto directory `docs`
- **THEN** the files are enqueued with targets `docs/photos/sub/a.jpg` and `docs/photos/b.jpg`, and `docs/photos` and `docs/photos/sub` are created before them

#### Scenario: An empty dropped folder is created

- **WHEN** a writer drops a folder that contains nothing
- **THEN** that folder appears in the browsed directory and no file upload is enqueued for it

#### Scenario: Files and folders drop together

- **WHEN** a writer drops a file and a folder in one drag
- **THEN** the file uploads into the browsed directory and the folder uploads as a subfolder with its contents

#### Scenario: Folders degrade to readable files

- **WHEN** a drag exposes plain files but no readable folder structure (the entries API is unavailable)
- **THEN** those files upload flat into the browsed directory and no folder structure is claimed

### Requirement: An unreadable drop payload surfaces a visible notice

A dropped folder the SPA cannot enumerate SHALL surface a visible,
dismissible notice naming the failed item, SHALL not prevent the other
dropped items from uploading, and SHALL never leave the drop as a
silent no-op.

#### Scenario: One unreadable sibling does not block the rest

- **WHEN** a drag contains a folder whose entries cannot be read and a folder that reads fine
- **THEN** the unreadable one is named in a visible notice and the readable one uploads

#### Scenario: The notice is dismissible

- **WHEN** the user dismisses the unreadable-drop notice
- **THEN** it is no longer shown and the queue is unaffected

### Requirement: Completed uploads appear in the browsed listing

The browse view SHALL refresh its listing when an upload completes
whose target directory is the directory being browsed, so dropped or
picked files appear without a manual reload or re-navigation.

#### Scenario: A dropped file appears in the listing

- **WHEN** a writer drops a file onto the listing of `docs` and stays there until it completes
- **THEN** the file appears in the listing without a manual reload

#### Scenario: An upload into another directory does not disturb the listing

- **WHEN** an upload completes whose target directory is not the browsed one
- **THEN** the listing is not refreshed
