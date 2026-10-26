# Spec Delta

## MODIFIED Requirements

### Requirement: Entries expose a long-press context menu

The SPA SHALL open a context menu on long-press of a file or directory
entry, SHALL offer Open and Download for every entry, SHALL offer media
files an open-in-new-tab action, SHALL offer Copy public link for file
entries while the browsed vdir is public, and SHALL offer Rename, Move, and
Delete only to writers (owner or `editor` share); the same actions SHALL
be reachable without a pointer.

#### Scenario: Writer sees the full menu

- **WHEN** an owner or editor long-presses an entry
- **THEN** Open, Download, Rename, Move, and Delete are offered, a media file also offers open-in-new-tab, and a file on a public vdir also offers Copy public link

#### Scenario: Viewer sees a read-only menu

- **WHEN** a viewer or public browser long-presses an entry
- **THEN** only Open, Download, and (for files on a public vdir) Copy public link are offered, with no write action

#### Scenario: Actions are keyboard reachable

- **WHEN** the user focuses an entry without a pointer
- **THEN** the entry's actions can be opened and activated by keyboard

## ADDED Requirements

### Requirement: Public vdirs offer a direct file link

While the browsed vdir is public, the SPA SHALL offer a copy action on a
file entry that places an absolute, direct `/files/<vdir-id>/<virtual-path>`
URL on the clipboard. The URL SHALL carry no token and SHALL grant nothing
beyond the vdir's anonymous read access. The action SHALL NOT be offered on
a non-public vdir or for a directory entry.

#### Scenario: Copies the file's direct URL

- **WHEN** a visitor of a public vdir chooses Copy public link on a file entry
- **THEN** the clipboard holds the absolute URL of that file's `/files` address, percent-encoded per path segment, with no token

#### Scenario: Any viewer of a public vdir may copy

- **WHEN** the owner, a share holder, or an anonymous visitor browses a public vdir
- **THEN** every file entry offers Copy public link

#### Scenario: Non-public vdirs offer no link action

- **WHEN** any user long-presses a file entry on a vdir that is not public
- **THEN** no Copy public link action is offered

#### Scenario: Directories offer no link action

- **WHEN** any user long-presses a directory entry on a public vdir
- **THEN** no Copy public link action is offered

#### Scenario: Clipboard failure is not reported as success

- **WHEN** the clipboard write rejects or the clipboard API is unavailable
- **THEN** the SPA does not claim the link was copied and the menu stays usable
