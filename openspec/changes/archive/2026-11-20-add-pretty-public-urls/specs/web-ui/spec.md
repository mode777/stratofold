# Spec Delta

## MODIFIED Requirements

### Requirement: Unauthenticated users see only the login screen

The SPA SHALL require an authenticated session for every destination
except public vdir browsing: an unauthenticated visitor (or one whose
token is expired, invalidated, or rejected) SHALL see the login screen
and no application content, except that the browse and preview routes
of a public vdir (`/v/<vdir-id>/…` and `/apps/<public-name>/…`) SHALL
render the read-only public browse view instead; valid credentials SHALL
enter the application, and a rejected session encountered during use
SHALL return the user to the login screen.

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

#### Scenario: Anonymous pretty public URL opens the browse view

- **WHEN** a visitor without a session opens `/apps/<public-name>/…` of a public alias
- **THEN** the read-only public browse view renders without a login prompt

#### Scenario: Anonymous non-public or unknown vdir shows the login screen

- **WHEN** a visitor without a session opens `/v/<vdir-id>/…` of a vdir that is not public or does not exist
- **THEN** the login screen is shown and no listing content is rendered

#### Scenario: Unknown or un-published alias shows not-available

- **WHEN** a visitor without a session opens `/apps/<public-name>/…` for a name that is unknown, released, or registered to a non-public vdir
- **THEN** an explicit not-available or page-not-found state is shown, not the login screen

#### Scenario: Anonymous management destinations show the login screen

- **WHEN** a visitor without a session opens any destination other than a vdir's browse and preview routes, including a pretty public URL
- **THEN** the login screen is shown

### Requirement: The sharing UI offers the public link

The SPA SHALL offer a vdir's owner the vdir's public browse link in the
sharing UI while the vdir is public: the absolute `/apps/<public-name>`
URL when a public name is registered, and the absolute `/v/<vdir-id>`
URL otherwise. It SHALL state that no public link exists when the vdir is
not public, and when a name is registered on a non-public vdir it SHALL
state that the name is reserved and becomes active when the vdir is
published. The link SHALL contain no token and SHALL carry no access
beyond the vdir's public read access.

#### Scenario: Public vdir shows a copyable link

- **WHEN** the owner opens the sharing UI of a vdir marked public
- **THEN** the absolute public browse link — the pretty alias when a name is registered, otherwise `/v/<vdir-id>` — is shown and the copy action places that URL on the clipboard

#### Scenario: A named public vdir shows the pretty link

- **WHEN** the owner opens the sharing UI of a public vdir with a registered public name
- **THEN** the absolute `/apps/<public-name>` link is shown and the copy action places that URL on the clipboard

#### Scenario: An unnamed public vdir shows the vdir link

- **WHEN** the owner opens the sharing UI of a public vdir without a public name
- **THEN** the absolute `/v/<vdir-id>` link is shown and copyable

#### Scenario: Non-public vdir states no public link

- **WHEN** the owner opens the sharing UI of a vdir that is not public
- **THEN** the sharing UI states that no public link exists (publishing remains on the vdir form's `is_public` toggle), and a registered name is described as reserved rather than active

### Requirement: Public vdirs offer a direct file link

While the browsed vdir is public, the SPA SHALL offer a copy action on a
file entry that places an absolute direct URL on the clipboard: the
`/apps/<public-name>/<virtual-path>` URL when a public name is
registered, otherwise the `/files/<vdir-id>/<virtual-path>` URL. The URL
SHALL carry no token and SHALL grant nothing beyond the vdir's anonymous
read access. The action SHALL NOT be offered on a non-public vdir or for
a directory entry.

#### Scenario: Copies the file's direct URL

- **WHEN** a visitor of a public vdir chooses Copy public link on a file entry
- **THEN** the clipboard holds the absolute URL of that file's direct address — the alias path when a public name is registered, otherwise the `/files` address — percent-encoded per path segment and with no token

#### Scenario: A registered name is preferred

- **WHEN** the vdir has a registered public name and a visitor copies a file's public link
- **THEN** the copied URL is the `/apps/<public-name>/<virtual-path>` form

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

## ADDED Requirements

### Requirement: Pretty public URLs render the read-only browse view

The SPA SHALL serve `/apps/<public-name>` and its folder paths with the
same read-only public browse view as `/v/<vdir-id>`, for anonymous and
signed-in visitors alike, and SHALL keep folder, breadcrumb, preview
(`/apps/<public-name>/view/…`), and back navigation under the alias so
the pretty URL remains the address in the bar. It SHALL resolve the
alias through the session-free resolver and SHALL show an explicit
not-available state for an unknown, released, or un-published name.

#### Scenario: Alias browse renders the public view

- **WHEN** a visitor opens `/apps/<public-name>/` or a folder path under it
- **THEN** the read-only public browse view renders that vdir's listing with no write or management controls

#### Scenario: A signed-in visitor gets the same read-only view

- **WHEN** the vdir's owner or a share holder opens the public alias URL
- **THEN** the read-only public presentation renders, and management remains available only through the signed-in vdir routes

#### Scenario: Navigation stays under the alias

- **WHEN** a visitor opens a folder, uses a breadcrumb or back control, or opens a preview from an alias browse view
- **THEN** the resulting URL stays under `/apps/<public-name>` and the listing or preview renders there

#### Scenario: Alias previews use the reserved view namespace

- **WHEN** a visitor activates a previewable file from an alias browse view
- **THEN** the preview route renders under `/apps/<public-name>/view/<virtual-path>` and back returns to the alias listing

#### Scenario: An unavailable alias is explicit

- **WHEN** the alias resolver returns `404` for an unknown, released, or un-published name
- **THEN** the SPA shows an explicit not-available or page-not-found state without revealing whether the vdir exists

### Requirement: The sharing UI manages the public name

The SPA SHALL offer a vdir's owner a control in the sharing UI to claim,
change, or release the vdir's public name, SHALL validate the documented
name format before submitting, SHALL surface the server's duplicate-name
rejection without claiming success, and SHALL show the resulting pretty
URL with a copy action once a name is registered. The control SHALL NOT
be offered to a viewer, an editor, or an unrelated user.

#### Scenario: The owner claims a name

- **WHEN** the owner submits a valid unused public name in the sharing UI
- **THEN** the vdir record stores it and the pretty URL is shown as the public link

#### Scenario: The owner changes or releases the name

- **WHEN** the owner submits a different valid name or clears the current one
- **THEN** the old name stops being shown and, on release, the pretty link is removed

#### Scenario: Invalid input is refused before submission

- **WHEN** the owner types uppercase letters, spaces, punctuation, or a name outside the length limits
- **THEN** the UI explains the format and sends no update

#### Scenario: A duplicate name is surfaced

- **WHEN** the server rejects the update because the name belongs to another vdir
- **THEN** the UI reports that the name is already taken and the current name and link are unchanged

#### Scenario: A reserved name is clearly inactive

- **WHEN** the owner has registered a name while the vdir is not public
- **THEN** the sharing UI shows the name as reserved and states that the pretty URL becomes active when the vdir is published
