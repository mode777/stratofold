# web-ui Specification

## Purpose

The browser SPA: a Drive-like, mobile-first interface over the shipped
API surfaces — login/logout, browsing virtual directories (list/grid,
virtualized), downloads and inline media via `/files`, and self-serve
management of connections, vdirs, and shares, with API error classes
surfaced as distinct UI states.

## Requirements

### Requirement: Unauthenticated users see only the login screen

The SPA SHALL require an authenticated session for every destination
except public vdir browsing: an unauthenticated visitor (or one whose
token is expired, invalidated, or rejected) SHALL see the login screen
and no application content, except that the browse and preview routes
of a public vdir (`/v/<vdir-id>/…`) SHALL render the read-only public
browse view instead; valid credentials SHALL enter the application,
and a rejected session encountered during use SHALL return the user to
the login screen.

#### Scenario: Valid login enters the application

- **WHEN** a user submits valid credentials on the login screen
- **THEN** the application content is shown and subsequent requests (API and `/files`) are authenticated as that user

#### Scenario: Failed login stays on the login screen

- **WHEN** a user submits invalid credentials
- **THEN** an authentication error is shown, the user remains on the login screen, and no application content is rendered

#### Scenario: Rejected session during use returns to login

- **WHEN** an API request fails with `401` while the user is inside the application (expired or invalidated session)
- **THEN** the user is returned to the login screen and no stale application state remains usable

#### Scenario: Anonymous public vdir link opens the browse view

- **WHEN** a visitor without a session opens `/v/<vdir-id>/…` of a vdir marked public
- **THEN** the read-only public browse view renders without a login prompt

#### Scenario: Anonymous non-public or unknown vdir shows the login screen

- **WHEN** a visitor without a session opens `/v/<vdir-id>/…` of a vdir that is not public or does not exist
- **THEN** the login screen is shown and no listing content is rendered

#### Scenario: Anonymous management destinations show the login screen

- **WHEN** a visitor without a session opens any destination other than a vdir's browse and preview routes
- **THEN** the login screen is shown

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

The SPA SHALL open video and other non-audio media entries (e.g. mp4,
mov, webm, ogv) in a new browser tab at their plain
`/files/<vdir-id>/<virtual-path>` URL — the browser's native player
serves playback through HTTP Range requests and is not replaced by a
dedicated in-app player; no auth token appears in the URL. Audio
entries are excluded from this requirement: they open the in-app audio
player.

#### Scenario: Media entry opens a new tab

- **WHEN** the user activates a video entry (tap or context-menu open)
- **THEN** a new browser tab opens at the file's `/files` URL and the browser's native player takes over

#### Scenario: Native playback is served by Range requests

- **WHEN** media plays in the opened tab
- **THEN** the network log shows Range requests (`206`) against the file's `/files` URL

#### Scenario: Seeking issues further Range requests

- **WHEN** the user seeks within playing media in the opened tab
- **THEN** a new Range request at the seek offset is issued and playback continues from there

### Requirement: Connections are manageable in the UI

The SPA SHALL let a user create, edit, and delete their own connection
records (label, host, port, username, auth method `password`/`key`, the
matching secret, an optional host-key fingerprint, and a remote
directory) through the record API; secrets SHALL be write-only in the UI
— never rendered back after saving — and editing with an empty secret
SHALL leave the stored secret unchanged. The fingerprint field SHALL be
optional and SHALL explain that an empty fingerprint is pinned on first
successful connection (trust on first use).

#### Scenario: Password connection is created

- **WHEN** a user submits the connection form with auth method `password` and a password
- **THEN** the connection record is created owned by that user and appears in their connection list

#### Scenario: Key connection is created

- **WHEN** a user submits the connection form with auth method `key` and a private key
- **THEN** the connection record is created with that key material

#### Scenario: Connection is created without a fingerprint

- **WHEN** a user submits the connection form leaving the host-key fingerprint empty
- **THEN** the connection record is created and the form explains the fingerprint will be pinned on first connection

#### Scenario: Remote directory is editable

- **WHEN** a user submits the connection form with a remote directory such as `/home/`
- **THEN** the connection record stores it and the connection list shows it

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
record API, offering only the user's own connections for binding; when
creating a vdir the root path SHALL default from the selected
connection's remote directory while remaining editable.

#### Scenario: Vdir is created on an own connection

- **WHEN** a user submits the vdir form with a name, root path, and one of their own connections
- **THEN** the vdir record is created and appears under "My vdirs"

#### Scenario: Root path defaults from the connection

- **WHEN** a user selects a connection with a remote directory while creating a new vdir
- **THEN** the root-path field is prefilled with that remote directory and can still be edited before saving

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

### Requirement: Anonymous public browsing is read-only and self-contained

The SPA SHALL render the anonymous public browse view with the same
listing, navigation, breadcrumb, preview, download, and media behavior
as the signed-in browse view, but without any write action, upload
entry point, or navigation to the application's management
destinations; once the vdir stops being public, the visitor's next
action SHALL surface an explicit not-available state.

#### Scenario: Anonymous visitor browses and downloads

- **WHEN** an anonymous visitor navigates a public vdir's directories and activates preview or download on a file entry
- **THEN** the listing, navigation, preview, and download work exactly as for a signed-in viewer, with no login prompt

#### Scenario: No write or management affordances

- **WHEN** the anonymous public browse view is rendered
- **THEN** no create-folder, rename, move, delete, or upload control is offered and no navigation to Uploads or Settings is shown

#### Scenario: Un-publishing surfaces not-available

- **WHEN** a public vdir is un-published while an anonymous visitor is browsing it
- **THEN** the visitor's next action shows an explicit not-available state rather than a silent failure or an unexplained error

### Requirement: The sharing UI offers the public link

The SPA SHALL offer a vdir's owner the vdir's public browse link (the
absolute `/v/<vdir-id>` URL) with a copy action in the sharing UI while
the vdir is public, and SHALL state that no public link exists when it
is not public; the link SHALL contain no token and SHALL carry no
access beyond the vdir's public read access.

#### Scenario: Public vdir shows a copyable link

- **WHEN** the owner opens the sharing UI of a vdir marked public
- **THEN** the absolute browse link is shown and the copy action places that URL on the clipboard

#### Scenario: Non-public vdir states no public link

- **WHEN** the owner opens the sharing UI of a vdir that is not public
- **THEN** the sharing UI states that no public link exists (publishing remains on the vdir form's `is_public` toggle)

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

### Requirement: The preview screen offers back navigation

The SPA's preview screen (`/v/:vdirId/view/*`) SHALL offer a back
control that returns the user to the listing of the file's containing
directory, so a preview is never a navigation dead end.

#### Scenario: Back returns to the containing directory

- **WHEN** the user activates the back control on a preview of a file inside directory `d`
- **THEN** the browse listing of `d` is shown

#### Scenario: Back works at any depth

- **WHEN** the user previews a file nested several directories below the vdir root and activates back
- **THEN** the listing of that file's immediate parent directory is shown (not the vdir root)

#### Scenario: Back control is keyboard operable

- **WHEN** the user tabs to the back control and activates it with the keyboard
- **THEN** navigation to the containing directory happens exactly as with pointer input

### Requirement: Write actions are offered in the folder header

The browse view SHALL offer new-folder and upload in the folder header
(the area carrying the back control, folder title, and breadcrumbs) for
users who may write on the vdir, and SHALL keep the compact toolbar
limited to view controls (sort key, sort direction, list/grid toggle),
so all controls remain visible and usable at mobile viewport widths.

#### Scenario: Writer sees header actions

- **WHEN** the owner or an `editor` share holder browses a vdir
- **THEN** new-folder and upload are offered in the folder header, above the breadcrumbs

#### Scenario: Toolbar holds only view controls

- **WHEN** any user browses a vdir
- **THEN** the compact toolbar contains only the sort key, sort direction, and list/grid controls

#### Scenario: Mobile viewport has no cut-off controls

- **WHEN** the browse view (header and toolbar) is rendered at a mobile viewport width
- **THEN** every offered control is fully visible and operable without horizontal scrolling

#### Scenario: Non-writers see no header write actions

- **WHEN** a `viewer` share holder or an anonymous visitor of a public vdir browses
- **THEN** no new-folder or upload action appears in the folder header

### Requirement: The browse listing spans the full viewport height

The browse view's listing area SHALL extend to the bottom edge of the
viewport. On mobile viewports the listing SHALL scroll beneath the
translucent tab bar without leaving an inactive gap between the last
visible row and the bar, while keeping the final entries reachable
fully above the bar.

#### Scenario: No dead strip above the mobile tab bar

- **WHEN** a directory listing is open at a mobile viewport width
- **THEN** the listing area reaches the bottom edge of the viewport behind the translucent tab bar, with no inactive background strip between them

#### Scenario: Last entries clear the tab bar

- **WHEN** the user scrolls a listing to its end on a mobile viewport
- **THEN** the last entry can be positioned fully above the tab bar

#### Scenario: Desktop content height is unchanged in spirit

- **WHEN** a directory listing is open at `md` or wider (sidebar layout)
- **THEN** the listing area fills the content height to the bottom of the viewport

### Requirement: Audio entries open the in-app audio player

The SPA SHALL open an audio entry (classified by file extension) in an
in-app audio player instead of a new tab. The player SHALL stream the
file's plain `/files/<vdir-id>/<virtual-path>` URL through the
browser's audio element (cookie-authenticated, no auth token in the
URL), SHALL expose play/pause, a position scrubber with elapsed and
remaining time, ±15s skip controls, and a dismiss action returning to
the listing, and SHALL start playback only on an explicit user action.
Tap and the context menu's open action both lead to the player, and
the context menu's Download action remains available.

#### Scenario: Audio entry opens the player

- **WHEN** the user activates an audio entry via tap or context menu
- **THEN** the in-app audio player opens for that file without leaving the SPA and no new tab is opened

#### Scenario: Playback starts only on user action

- **WHEN** the player opens
- **THEN** playback is paused until the user activates play

#### Scenario: Controls drive the audio element

- **WHEN** the user toggles play/pause or activates a ±15s skip control
- **THEN** playback state and position follow the control and the scrubber and elapsed/remaining times track playback

#### Scenario: Scrubbing seeks by Range requests

- **WHEN** the user moves the scrubber to an unbuffered position
- **THEN** the audio element issues a Range request at that offset against the file's `/files` URL and playback continues from there

#### Scenario: Player exposes download

- **WHEN** the user activates the download action inside the player
- **THEN** the browser retrieves the file byte-exactly through the same `/files` URL

#### Scenario: Stream failure shows an explicit failure state

- **WHEN** the audio stream fails (connection dropped, file removed, or undecodable)
- **THEN** a failure state with a retry action is shown and playback does not silently hang

#### Scenario: Anonymous visitor plays audio on a public vdir

- **WHEN** a visitor without a session opens a public vdir's audio entry
- **THEN** the player renders and streams through the public `/files` URL without a login prompt

### Requirement: Image entries open the in-app image viewer

The SPA SHALL open an image entry (classified by file extension) in an
in-app fullscreen image viewer that renders the image itself from the
file's plain `/files/<vdir-id>/<virtual-path>` URL (cookie-authenticated,
no auth token in the URL) as an immersive, edge-to-edge view, with
overlay chrome carrying the client-derived name, the file's size and
modified time, and a download action using that URL. An image the
browser cannot decode SHALL fall back to the metadata card for that
slide instead of a broken image frame. Tap and the context menu's open
action both lead to the viewer.

#### Scenario: Image entry opens the fullscreen viewer

- **WHEN** the user activates a browser-renderable image entry via tap or context menu
- **THEN** the fullscreen viewer shows that image edge-to-edge with its name and download action, and the former contained card layout is no longer shown

#### Scenario: Viewer exposes download

- **WHEN** the user activates the download action inside the viewer
- **THEN** the browser retrieves the file byte-exactly through the same `/files` URL

#### Scenario: Undecodable image falls back to metadata

- **WHEN** an image slide's bytes cannot be decoded by the browser (e.g. HEIC, DNG)
- **THEN** the metadata card with the download action is shown for that slide instead of a broken image

#### Scenario: Image load failure shows an explicit failure state

- **WHEN** an image slide's request fails (connection dropped or file removed)
- **THEN** a failure state with a retry action is shown for that slide rather than a silent blank view

#### Scenario: Anonymous visitor views an image on a public vdir

- **WHEN** a visitor without a session opens a public vdir's image entry
- **THEN** the fullscreen viewer renders the image through the public `/files` URL without a login prompt

### Requirement: The fullscreen viewer zooms and pans

The fullscreen viewer SHALL support pinch-to-zoom and a double-tap
zoom step, SHALL pan the image with a drag while it is zoomed (clamped
to the image bounds), and SHALL return the image to its
fit-to-screen state when the user moves to another image or leaves
the zoomed state.

#### Scenario: Pinch zooms the image

- **WHEN** the user pinches outward on the displayed image
- **THEN** the image zooms in following the pinch and can be panned while zoomed

#### Scenario: Double-tap toggles a zoom step

- **WHEN** the user double-taps the image
- **THEN** the image zooms to the next zoom step centered on the tap point, and a further double-tap returns it to fit-to-screen

#### Scenario: Pan is clamped while zoomed

- **WHEN** the user drags a zoomed image beyond its edge
- **THEN** the image stops at its bounds instead of dragging the interface away

#### Scenario: Zoom resets on image change

- **WHEN** the user moves to another image while the current one is zoomed
- **THEN** the newly shown image starts at fit-to-screen, not at the previous zoom state

### Requirement: The fullscreen viewer cycles through the folder's images

The viewer SHALL let the user swipe horizontally to move to the
previous or next image of the containing directory in the directory's
listing order, considering only image-kind entries; navigation SHALL
stop at the first and last image; the viewer's URL
(`/v/<vdir-id>/view/<path>`) SHALL track the image on screen so deep
links stay exact and back returns to the browse listing; and the
keyboard's arrow keys SHALL page through the images on pointer-capable
devices.

#### Scenario: Swipe moves to the neighboring image

- **WHEN** the user swipes left (or right) on an image that has a next (or previous) image in the directory
- **THEN** the adjacent image slides in and becomes the displayed image

#### Scenario: Navigation stops at the ends

- **WHEN** the user swipes past the first or last image of the directory
- **THEN** the view stays on that image and does not wrap around

#### Scenario: Non-image entries are skipped

- **WHEN** the containing directory holds files of other kinds or subdirectories between image entries
- **THEN** swiping moves directly between the image entries only

#### Scenario: Single-image directory cannot swipe

- **WHEN** the directory contains exactly one image entry
- **THEN** horizontal swipes do not navigate and the viewer stays on that image

#### Scenario: URL follows the gallery position

- **WHEN** the user swipes to another image
- **THEN** the viewer's URL names the newly displayed image, activating it opens the gallery at that image, and browser back returns to the browse listing

#### Scenario: A broken slide does not block the gallery

- **WHEN** the displayed slide shows its failure or metadata fallback and the user swipes
- **THEN** the adjacent image is shown as usual

#### Scenario: Arrow keys page through images

- **WHEN** the user presses the left or right arrow key while viewing an image on a pointer-capable device
- **THEN** the previous or next image is displayed as with a swipe

### Requirement: The fullscreen viewer uses dismissible overlay chrome

The viewer SHALL overlay minimal chrome above the image — back to the
browse listing, the file name, the image's position in the gallery,
and download — SHALL hide the chrome when the user taps the image and
re-show it on the next tap, and SHALL keep the image view itself
immersive (full-screen, dark) regardless of chrome visibility.

#### Scenario: Chrome toggles on image tap

- **WHEN** the user taps the displayed image
- **THEN** the overlay chrome hides if shown and reappears on the next tap, with the image remaining fullscreen

#### Scenario: Back returns to the listing

- **WHEN** the user activates the chrome's back control
- **THEN** the browse listing of the containing directory is shown again

#### Scenario: Position indicator tracks the gallery

- **WHEN** the user swipes to another image
- **THEN** the chrome's position indicator reflects the new image's place among the directory's images
