# Spec Delta

## MODIFIED Requirements

### Requirement: The vdir switcher separates my vdirs from shared with me

The SPA SHALL list the signed-in user's own vdirs and the vdirs shared
with them (read via the vdirs record API) in distinguishable groups
("My vdirs" and "Shared with me") at the Files tab's root, SHALL open a
vdir's root in the browse view when selected, and SHALL NOT expose
connection records to a user who does not own them.

#### Scenario: Owner sees own vdirs

- **WHEN** an owner with vdirs signs in and opens the Files tab
- **THEN** each owned vdir is listed under "My vdirs" and can be opened for browsing

#### Scenario: Grantee sees shared vdirs

- **WHEN** a user holding a `viewer` or `editor` share opens the Files tab
- **THEN** each shared vdir is listed under "Shared with me" and can be opened for browsing like an own vdir

#### Scenario: Shared users see no connection records

- **WHEN** a grantee who owns no connections uses the application
- **THEN** no connection record is visible anywhere in the UI

#### Scenario: Public vdirs are marked

- **WHEN** a vdir with `is_public` set is listed
- **THEN** it is visually marked as public in the list

### Requirement: Directory navigation uses breadcrumbs

The SPA SHALL let the user enter subdirectories from the listing, SHALL
show the current path as breadcrumbs rooted at the vdir name, SHALL
navigate back to an ancestor when its breadcrumb segment is activated,
and SHALL offer a back control that navigates to the parent directory
(or to the Files tab when already at the vdir root); a missing or
sandbox-rejected directory (`404`) SHALL render a not-found state and an
empty directory an empty state.

#### Scenario: Entering a subdirectory

- **WHEN** the user activates a directory entry
- **THEN** the listing of that subdirectory is shown and the breadcrumbs extend by one segment

#### Scenario: Breadcrumb navigates to an ancestor

- **WHEN** the user activates a breadcrumb segment
- **THEN** the listing of that ancestor directory is shown

#### Scenario: Back control navigates to the parent

- **WHEN** the user activates the back control from a subdirectory
- **THEN** the parent directory is shown, and at the vdir root the Files tab is shown

#### Scenario: Empty directory shows an empty state

- **WHEN** a directory contains no entries
- **THEN** an explicit empty state is shown, not an error

#### Scenario: Missing directory shows not-found

- **WHEN** a listing request returns `404` (missing or sandbox-rejected path)
- **THEN** a not-found state is shown with a way back to a valid directory

## ADDED Requirements

### Requirement: Primary navigation uses a bottom tab bar

The SPA SHALL provide primary navigation through a persistent bottom
tab bar with Files, Uploads, and Settings destinations, SHALL indicate
the active destination, and SHALL keep the Uploads destination
reachable from every authenticated screen.

#### Scenario: Switching destinations

- **WHEN** the user selects a tab
- **THEN** that destination's screen is shown and its tab is marked active

#### Scenario: Uploads stays reachable

- **WHEN** the user is on the Files or Settings destination
- **THEN** the Uploads destination remains reachable and reflects the current upload activity

### Requirement: Entries expose a long-press context menu

The SPA SHALL open a context menu on long-press of a file or directory
entry, SHALL offer Open and Download for every entry, SHALL offer media
files an open-in-new-tab action, and SHALL offer Rename, Move, and
Delete only to writers (owner or `editor` share); the same actions SHALL
be reachable without a pointer.

#### Scenario: Writer sees the full menu

- **WHEN** an owner or editor long-presses an entry
- **THEN** Open, Download, Rename, Move, and Delete are offered, and a media file also offers open-in-new-tab

#### Scenario: Viewer sees a read-only menu

- **WHEN** a viewer or public browser long-presses an entry
- **THEN** only Open and Download are offered (open-in-new-tab for media), with no write action

#### Scenario: Actions are keyboard reachable

- **WHEN** the user focuses an entry without a pointer
- **THEN** the entry's actions can be opened and activated by keyboard

### Requirement: Non-media files open a preview screen

The SPA SHALL open a preview screen for a non-media file entry showing
its name, size, and modification time derived from the directory
listing, and SHALL offer a download action; media files SHALL continue
to open in a new tab at their `/files` URL rather than in the preview
screen.

#### Scenario: Preview shows listed metadata

- **WHEN** the user activates a non-media file entry
- **THEN** a preview screen shows the file's name, size, and modification time and offers download

#### Scenario: Media still opens in a new tab

- **WHEN** the user activates a media file entry
- **THEN** a new browser tab opens at the file's `/files` URL and no preview screen replaces it

### Requirement: Unknown routes show a page-not-found screen

The SPA SHALL render a page-not-found screen for an unrecognized in-app
route, offering a control that returns the user to the Files tab.

#### Scenario: Unknown route

- **WHEN** the user navigates to a route the SPA does not recognize
- **THEN** a page-not-found screen is shown with a control that returns to the Files tab
