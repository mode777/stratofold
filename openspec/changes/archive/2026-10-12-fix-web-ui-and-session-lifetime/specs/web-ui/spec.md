# Spec Delta: web-ui

## ADDED Requirements

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
