# Spec Delta

## MODIFIED Requirements

### Requirement: Entries expose a long-press context menu

The SPA SHALL open a context menu on long-press of a file or directory
entry, SHALL offer Open and Download for every entry, SHALL offer media
files an open-in-new-tab action, SHALL offer Copy public link for file
entries while the browsed vdir is public, SHALL offer Copy 24-hour link
for file entries on a non-public vdir to signed-in readers, and SHALL
offer Rename, Move, and Delete only to writers (owner or `editor` share);
the same actions SHALL be reachable without a pointer.

#### Scenario: Writer sees the full menu

- **WHEN** an owner or editor long-presses an entry
- **THEN** Open, Download, Rename, Move, and Delete are offered, a media file also offers open-in-new-tab, a file on a public vdir also offers Copy public link, and a file on a non-public vdir also offers Copy 24-hour link

#### Scenario: Viewer sees a read-only menu

- **WHEN** a viewer long-presses an entry on a non-public vdir
- **THEN** only Open, Download for files, and Copy 24-hour link for files are offered, with no write action

#### Scenario: Public browser sees a read-only menu

- **WHEN** an anonymous visitor long-presses an entry on a public vdir
- **THEN** only Open, Download for files, and Copy public link for files are offered, with no write action and no Copy 24-hour link

#### Scenario: Actions are keyboard reachable

- **WHEN** the user focuses an entry without a pointer
- **THEN** the entry's actions can be opened and activated by keyboard

## ADDED Requirements

### Requirement: Signed-in readers can copy a 24-hour file link

On a non-public vdir, the SPA SHALL offer a copy action on file entries to
signed-in readers that mints a temporary link and places its absolute
`/s/<token>` URL on the clipboard, and SHALL state that the link expires
after 24 hours. It SHALL NOT offer the action on a public vdir, to an
anonymous visitor, or for a directory entry. It SHALL claim success only
after the mint and clipboard write succeed.

#### Scenario: A reader copies a temporary link

- **WHEN** the owner, an editor, or a viewer copies the 24-hour link of a file on a non-public vdir
- **THEN** the clipboard holds the absolute `/s/<token>` URL and the menu states the 24-hour validity

#### Scenario: Public vdirs keep the permanent link

- **WHEN** a user opens the menu of a file on a public vdir
- **THEN** Copy public link is offered and Copy 24-hour link is not

#### Scenario: Anonymous visitors cannot mint links

- **WHEN** an anonymous visitor opens the menu of a file on a public vdir
- **THEN** no Copy 24-hour link action is offered

#### Scenario: Directories offer no temporary link

- **WHEN** any user opens the menu of a directory entry
- **THEN** no Copy 24-hour link action is offered

#### Scenario: Mint failure is not reported as success

- **WHEN** the mint request fails or is rejected
- **THEN** the menu does not claim the link was copied and stays usable

#### Scenario: Clipboard failure is not reported as success

- **WHEN** the clipboard write rejects or is unavailable
- **THEN** the menu does not claim the link was copied and stays usable
