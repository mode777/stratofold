# Spec Delta

## MODIFIED Requirements

### Requirement: File-management actions are offered only where the user may write

The browse view SHALL offer create-folder, rename, move, delete, and
archive extraction for entries, gated by write permission — owner or
`editor` share on the vdir; viewers, other users, and anonymous/public
browsing SHALL NOT be offered write actions, and a rejected write (`403`)
SHALL surface the forbidden state.

#### Scenario: Owner or editor sees write actions

- **WHEN** the owner or an `editor` share holder browses a vdir
- **THEN** create-folder, rename, move, delete, and extraction of an archive file are available

#### Scenario: Viewer sees no write actions

- **WHEN** a `viewer` share holder browses the vdir
- **THEN** no create-folder, rename, move, delete, or extract action is offered

#### Scenario: Forbidden write is surfaced

- **WHEN** a write action is rejected with `403`
- **THEN** the forbidden state is shown and the action is not repeated

### Requirement: Entries expose a long-press context menu

The SPA SHALL open a context menu on long-press of a file or directory
entry, SHALL offer Open and Download for every entry, SHALL offer media
files an open-in-new-tab action, SHALL offer Copy public link for file
entries while the browsed vdir is public, SHALL offer Copy 24-hour link
for file entries on a non-public vdir to signed-in readers, SHALL offer
Extract for archive files to writers, and SHALL
offer Rename, Move, and Delete only to writers (owner or `editor` share);
the same actions SHALL be reachable without a pointer.

#### Scenario: Writer sees the full menu

- **WHEN** an owner or editor long-presses an entry
- **THEN** Open, Download, Rename, Move, and Delete are offered, an archive file also offers Extract, a media file also offers open-in-new-tab, a file on a public vdir also offers Copy public link, and a file on a non-public vdir also offers Copy 24-hour link

#### Scenario: Viewer sees a read-only menu

- **WHEN** a viewer long-presses an entry on a non-public vdir
- **THEN** only Open, Download for files, and Copy 24-hour link for files are offered, with no write action or Extract

#### Scenario: Public browser sees a read-only menu

- **WHEN** an anonymous visitor long-presses an entry on a public vdir
- **THEN** only Open, Download for files, and Copy public link for files are offered, with no write action, no Extract, and no Copy 24-hour link

#### Scenario: Actions are keyboard reachable

- **WHEN** the user focuses an entry without a pointer
- **THEN** the entry's actions can be opened and activated by keyboard

#### Scenario: Extraction is offered only for archive files

- **WHEN** a writer long-presses a non-archive file or a directory
- **THEN** no Extract action is offered

## ADDED Requirements

### Requirement: Archive extraction is confirmed, reported, and reflected in the listing

The SPA SHALL confirm an extraction before starting it, naming the
archive and the folder it will create with an editable folder name, SHALL
report a live progress state that can be canceled, SHALL offer an
alternative name when the target folder already exists, and SHALL make
the new folder appear in the listing without a manual reload when its
parent is the browsed directory. A terminal failure SHALL surface the
API error class it belongs to rather than a generic message.

#### Scenario: The confirmation names the target folder

- **WHEN** a writer chooses Extract on `docs/photos.zip`
- **THEN** a confirmation shows the archive and the proposed folder `photos`, and no request is sent until it is accepted

#### Scenario: Progress is visible and cancellable

- **WHEN** an extraction is running
- **THEN** its progress and state are visible from other destinations, and canceling it reports the canceled outcome

#### Scenario: Existing folder offers an alternative name

- **WHEN** starting the extraction returns `409` because the folder exists
- **THEN** the SPA explains the conflict, suggests another folder name, and retries with the chosen name on confirmation

#### Scenario: The new folder appears without a reload

- **WHEN** an extraction completes while the archive's directory is being browsed
- **THEN** the new folder appears in the listing without a manual reload

#### Scenario: Failures are surfaced deterministically

- **WHEN** an extraction fails because the archive was refused, the connection was unavailable, or access was withdrawn
- **THEN** the SPA shows the corresponding invalid-archive, unavailable, or forbidden state, and the listing shows no new folder

#### Scenario: Public and viewer browsing never offer extraction

- **WHEN** an anonymous visitor or a viewer browses a vdir
- **THEN** no extraction entry point exists anywhere in the browse view
