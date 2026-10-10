# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
