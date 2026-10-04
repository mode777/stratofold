# web-ui Specification

## Purpose

The browser SPA: a Drive-like, mobile-first interface over the shipped
API surfaces — login/logout, browsing virtual directories (list/grid,
virtualized), downloads and inline media via `/files`, and self-serve
management of connections, vdirs, and shares, with API error classes
surfaced as distinct UI states.

## Requirements

### Requirement: Unauthenticated users see only the login screen

The SPA SHALL require an authenticated session: an unauthenticated
visitor (or one whose token is expired, invalidated, or rejected)
SHALL see the login screen and no application content, valid
credentials SHALL enter the application, and a rejected session
encountered during use SHALL return the user to the login screen.

#### Scenario: Valid login enters the application

- **WHEN** a user submits valid credentials on the login screen
- **THEN** the application content is shown and subsequent requests (API and `/files`) are authenticated as that user

#### Scenario: Failed login stays on the login screen

- **WHEN** a user submits invalid credentials
- **THEN** an authentication error is shown, the user remains on the login screen, and no application content is rendered

#### Scenario: Rejected session during use returns to login

- **WHEN** an API request fails with `401` while the user is inside the application (expired or invalidated session)
- **THEN** the user is returned to the login screen and no stale application state remains usable

### Requirement: Logout ends the session in the application

The SPA SHALL offer a logout action that calls the logout route and
returns the user to the login screen, after which the application
SHALL NOT issue authenticated requests with the former session.

#### Scenario: Logout returns to login

- **WHEN** a logged-in user activates logout
- **THEN** the session is ended via the logout route and the login screen is shown

#### Scenario: No authenticated traffic after logout

- **WHEN** the user attempts to browse after logging out
- **THEN** requests are issued unauthenticated and rejected, and the login screen remains

### Requirement: The vdir switcher separates my vdirs from shared with me

The SPA SHALL list the signed-in user's own vdirs and the vdirs shared
with them (read via the vdirs record API) in distinguishable groups,
SHALL open a vdir's root for browsing when selected, and SHALL NOT
expose connection records to a user who does not own them.

#### Scenario: Owner sees own vdirs

- **WHEN** an owner with vdirs signs in and opens the vdir switcher
- **THEN** each owned vdir is listed under "My vdirs" and can be opened for browsing

#### Scenario: Grantee sees shared vdirs

- **WHEN** a user holding a `viewer` or `editor` share opens the vdir switcher
- **THEN** each shared vdir is listed under "Shared with me" and can be opened for browsing like an own vdir

#### Scenario: Shared users see no connection records

- **WHEN** a grantee who owns no connections uses the application
- **THEN** no connection record is visible anywhere in the UI

#### Scenario: Public vdirs are marked

- **WHEN** a vdir with `is_public` set is listed
- **THEN** it is visually marked as public in the switcher

### Requirement: Directory browsing renders entries in list and grid views

The SPA SHALL render a directory listing (`POST /api/sf/vdirs/{id}/ls`)
in both a list view (name, size, type, modification time) and a grid
view, SHALL let the user switch between them, and SHALL support sorting
entries by name, size, and modification time in both directions.

#### Scenario: List view shows entry details

- **WHEN** a directory with known entries is opened in list view
- **THEN** each entry is shown with its name, size, type (directory/file), and modification time

#### Scenario: Views are switchable

- **WHEN** the user toggles between list and grid view
- **THEN** the same entries are rendered in the chosen form without losing the current directory

#### Scenario: Sorting reorders entries

- **WHEN** the user sorts by name, size, or modification time (ascending or descending)
- **THEN** the entries reorder accordingly in both views

### Requirement: Directory navigation uses breadcrumbs

The SPA SHALL let the user enter subdirectories from the listing, SHALL
show the current path as breadcrumbs rooted at the vdir name, and SHALL
navigate back to an ancestor when its breadcrumb segment is activated;
a missing or sandbox-rejected directory (`404`) SHALL render a
not-found state and an empty directory an empty state.

#### Scenario: Entering a subdirectory

- **WHEN** the user activates a directory entry
- **THEN** the listing of that subdirectory is shown and the breadcrumbs extend by one segment

#### Scenario: Breadcrumb navigates to an ancestor

- **WHEN** the user activates a breadcrumb segment
- **THEN** the listing of that ancestor directory is shown

#### Scenario: Empty directory shows an empty state

- **WHEN** a directory contains no entries
- **THEN** an explicit empty state is shown, not an error

#### Scenario: Missing directory shows not-found

- **WHEN** a listing request returns `404` (missing or sandbox-rejected path)
- **THEN** a not-found state is shown with a way back to a valid directory

### Requirement: Large listings stay responsive through virtualization

The SPA SHALL render directory listings with windowed (virtualized)
rendering such that a listing with tens of thousands of entries renders
and scrolls smoothly with a bounded number of DOM nodes, in list and
grid view.

#### Scenario: Ten-thousand-entry directory renders

- **WHEN** a directory listing contains 10,000+ entries and is opened
- **THEN** the view renders promptly with only the visible window materialized in the DOM

#### Scenario: Scrolling reaches the last entry

- **WHEN** the user scrolls a 10,000+ entry listing to the end
- **THEN** the last entry is rendered and reachable in both views

### Requirement: Files download through /files URLs

The SPA SHALL expose every file entry's content through its plain
`/files/<vdir-id>/<virtual-path>` URL and SHALL offer a download action
per file that fetches it through that URL, so downloads work with the
session cookie alone and are resumable via HTTP Range.

#### Scenario: Download fetches the file

- **WHEN** the user activates download on a file entry
- **THEN** the browser retrieves the file's content from its `/files` URL and saves it byte-exactly

#### Scenario: Download works for a shared viewer

- **WHEN** a user holding a `viewer` share downloads a file from the shared vdir
- **THEN** the download succeeds through the same `/files` URL without any owner-only step

### Requirement: Media files open in a new tab through /files URLs

The SPA SHALL open media entries (e.g. video, audio) in a new browser
tab at their plain `/files/<vdir-id>/<virtual-path>` URL — the
browser's native player serves playback through HTTP Range requests
and SHALL NOT be replaced by a dedicated player embedded in the SPA;
no auth token appears in the URL.

#### Scenario: Media entry opens a new tab

- **WHEN** the user activates a media entry
- **THEN** a new browser tab opens at the file's `/files` URL and the browser's native player takes over

#### Scenario: Native playback is served by Range requests

- **WHEN** media plays in the opened tab
- **THEN** the network log shows Range requests (`206`) against the file's `/files` URL

#### Scenario: Seeking issues further Range requests

- **WHEN** the user seeks within playing media
- **THEN** a new Range request at the seek offset is issued and playback continues from there

### Requirement: Connections are manageable in the UI

The SPA SHALL let a user create, edit, and delete their own connection
records (label, host, port, username, auth method `password`/`key`, the
matching secret, host-key fingerprint) through the record API; secrets
SHALL be write-only in the UI — never rendered back after saving — and
editing with an empty secret SHALL leave the stored secret unchanged.

#### Scenario: Password connection is created

- **WHEN** a user submits the connection form with auth method `password` and a password
- **THEN** the connection record is created owned by that user and appears in their connection list

#### Scenario: Key connection is created

- **WHEN** a user submits the connection form with auth method `key` and a private key
- **THEN** the connection record is created with that key material

#### Scenario: Secrets are never rendered back

- **WHEN** an existing connection is opened for editing
- **THEN** no secret field shows the stored value (placeholders only), and the response that populated the form contained no secrets

#### Scenario: Empty secret on edit preserves the stored secret

- **WHEN** a connection is saved with a secret field left empty
- **THEN** the previously stored secret remains in effect

#### Scenario: Connection is deleted

- **WHEN** the owner deletes a connection
- **THEN** the record is removed and the UI no longer offers it (vdirs bound to it are removed by the server's cascade)

### Requirement: Vdirs are manageable in the UI

The SPA SHALL let a user create, edit, and delete their own vdir
records (name, root path, `is_public`, bound connection) through the
record API, offering only the user's own connections for binding.

#### Scenario: Vdir is created on an own connection

- **WHEN** a user submits the vdir form with a name, root path, and one of their own connections
- **THEN** the vdir record is created and appears under "My vdirs"

#### Scenario: Foreign connections are not offered

- **WHEN** the vdir form is opened
- **THEN** only the user's own connections are selectable for binding

#### Scenario: is_public is toggled

- **WHEN** the owner flips a vdir's `is_public` and saves
- **THEN** the vdir's public marking updates accordingly in the UI

#### Scenario: Vdir is deleted

- **WHEN** the owner deletes a vdir
- **THEN** the record is removed and it disappears from the switcher

### Requirement: Shares are manageable in the UI on own vdirs

The SPA SHALL let a vdir's owner grant a `viewer` or `editor` share to
another user by email (resolved through the lookup route), change a
share's role, and revoke it; the UI SHALL prevent granting a share to
the owner themselves and SHALL surface the server's rejection of
duplicates.

#### Scenario: Share is granted by email

- **WHEN** the owner grants `viewer` on their vdir to a registered email address
- **THEN** the share is created and listed for that vdir, and the grantee sees the vdir under "Shared with me"

#### Scenario: Role is changed

- **WHEN** the owner changes an existing share's role from `viewer` to `editor`
- **THEN** the update applies and the UI reflects the new role

#### Scenario: Share is revoked

- **WHEN** the owner deletes a share
- **THEN** the share disappears from the list and the grantee loses access on their next request

#### Scenario: Self-share is prevented

- **WHEN** the owner enters their own email in the share dialog
- **THEN** the UI rejects the grant before submission (owner cannot be shared with themselves)

#### Scenario: Duplicate share surfaces the server rejection

- **WHEN** the owner grants a second share for a vdir and user that already have one
- **THEN** the server's rejection is surfaced as an error and no duplicate appears

### Requirement: API error classes map to distinct UI states

The SPA SHALL map the API's deterministic error classes to distinct
user-visible states: `404` as not-found/empty, `403` as a forbidden
notice (with write actions not offered to viewers), `503` as a
retryable failure with an explicit retry action, and `400`/`500` as an
error message; no failure SHALL be silently swallowed.

#### Scenario: Forbidden operation is noticed

- **WHEN** a request the user is not allowed fails with `403`
- **THEN** a forbidden notice is shown and the UI offers no repeating write attempt for that action

#### Scenario: Retryable failure offers retry

- **WHEN** a request fails with `503`
- **THEN** a retryable-failure state with a retry action is shown and activating it re-issues the request

#### Scenario: Not-found shows the not-found state

- **WHEN** a browse or mutation targets a missing path and fails with `404`
- **THEN** the not-found state is shown rather than a generic error

### Requirement: The UI is mobile-first responsive and keyboard navigable

The SPA SHALL be usable at mobile viewport widths (login, browsing,
download, and the management dialogs) and SHALL make primary navigation
and list actions reachable and operable by keyboard alone.

#### Scenario: Mobile viewport browse works

- **WHEN** the browse view is opened at a mobile viewport width
- **THEN** the listing, vdir switcher, and entry actions are usable without horizontal scrolling or cut-off controls

#### Scenario: Keyboard opens and activates entries

- **WHEN** the user tabs through the listing and activates an entry with the keyboard
- **THEN** directories open and file actions trigger exactly as with pointer input

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
