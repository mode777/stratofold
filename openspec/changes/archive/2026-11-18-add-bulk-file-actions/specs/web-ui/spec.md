# Spec Delta

## MODIFIED Requirements

### Requirement: File-management actions are offered only where the user may write

The browse view SHALL offer create-folder, rename, move, delete, and
archive extraction for entries, gated by write permission — owner or
`editor` share on the vdir; viewers, other users, and anonymous/public
browsing SHALL NOT be offered write actions, and a rejected single-entry
write (`403`) SHALL surface the forbidden state. A rejected item in a bulk
move or delete SHALL be reported in the bulk result notice instead.

#### Scenario: Owner or editor sees write actions

- **WHEN** the owner or an `editor` share holder browses a vdir
- **THEN** create-folder, rename, move, delete, extraction of an archive file, and selection for bulk move/delete are available

#### Scenario: Viewer sees no write actions

- **WHEN** a `viewer` share holder browses the vdir
- **THEN** no create-folder, rename, move, delete, extract, or selection action is offered

#### Scenario: Forbidden write is surfaced

- **WHEN** a single-entry write action is rejected with `403`
- **THEN** the forbidden state is shown and the action is not repeated

### Requirement: File-management actions update the listing

The SPA SHALL perform create-folder, rename, move, and delete through
the filesystem API, require confirmation before a destructive delete,
and reflect a successful action in the current listing without a manual
reload; a not-found target (`404`) SHALL surface the not-found state for a
single-entry action and SHALL be reported in the bulk result notice for a
bulk move or delete.

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

- **WHEN** a single-entry rename, move, or delete targets a path that no longer exists (`404`)
- **THEN** the not-found state is shown

### Requirement: Write actions are offered in the folder header

The browse view SHALL offer new-folder, upload, and select in the folder
header (the area carrying the back control, folder title, and breadcrumbs)
for users who may write on the vdir, and SHALL keep the compact toolbar
limited to view controls (sort key, sort direction, list/grid toggle), so
all controls remain visible and usable at mobile viewport widths.

#### Scenario: Writer sees header actions

- **WHEN** the owner or an `editor` share holder browses a vdir
- **THEN** new-folder, upload, and select are offered in the folder header, above the breadcrumbs

#### Scenario: Toolbar holds only view controls

- **WHEN** any user browses a vdir
- **THEN** the compact toolbar contains only the sort key, sort direction, and list/grid controls

#### Scenario: Mobile viewport has no cut-off controls

- **WHEN** the browse view (header and toolbar) is rendered at a mobile viewport width
- **THEN** every offered control is fully visible and operable without horizontal scrolling

#### Scenario: Non-writers see no header write actions

- **WHEN** a `viewer` share holder or an anonymous visitor of a public vdir browses
- **THEN** no new-folder, upload, or select action appears in the folder header

## ADDED Requirements

### Requirement: Selection mode is available only to writers

The browse view SHALL let a user who may write enter and leave a selection
mode for the currently listed directory. The mode SHALL start with an empty
selection, SHALL end without any file change when the user leaves it, and
SHALL end when the browsed directory changes. Viewers and anonymous public
visitors SHALL NOT be offered selection mode, because this change exposes
no read-only bulk action.

#### Scenario: Writer enters and leaves selection mode

- **WHEN** the owner or an `editor` share holder activates Select and later activates Done
- **THEN** the listing first shows selection affordances with nothing selected and then returns to normal browsing with the selection cleared and no file changed

#### Scenario: Navigating to another directory ends selection

- **WHEN** selection mode is active and the user navigates to another directory
- **THEN** the new directory is shown in normal browsing mode with no entries selected

#### Scenario: Viewers cannot start selection

- **WHEN** a `viewer` share holder or an anonymous visitor of a public vdir browses
- **THEN** no Select action is offered and no selection affordance can be activated

### Requirement: Selection toggles listed entries without opening them

While selection mode is active, the browse view SHALL show a selection
affordance on every listed file and directory in both list and grid views,
and activating an entry SHALL toggle its selection instead of opening a
directory, previewing a file, or opening the entry context menu. Each
selection affordance SHALL be named for the entry it controls and SHALL be
operable by keyboard. Switching views or changing the sort order SHALL keep
the current selection.

#### Scenario: Tapping an entry toggles selection

- **WHEN** a writer taps a file or directory while selection mode is active
- **THEN** that entry becomes selected, or deselected when it was already selected, and it is not opened

#### Scenario: Folders toggle instead of navigating

- **WHEN** a writer taps a directory entry while selection mode is active
- **THEN** the directory's selection state toggles and the browse view stays in the current directory

#### Scenario: Entry menus are suspended during selection

- **WHEN** a writer long-presses an entry or activates its ellipsis while selection mode is active
- **THEN** no single-entry context menu opens and the entry's selection is toggled instead

#### Scenario: Selection survives view and sort changes

- **WHEN** a writer switches between list and grid view or changes the sort order with entries selected
- **THEN** the same entries remain selected and the selected count is unchanged

#### Scenario: Selection is keyboard operable

- **WHEN** a keyboard user focuses an entry's selection affordance and activates it
- **THEN** the entry toggles selection and the action is not treated as opening the entry

### Requirement: The selection bar reflects and manages the selection

The browse view SHALL show a selection bar while selection mode is active
that reports the number of selected entries, offers Select all and Deselect
all for the current listing, offers Move and Delete, and offers Done. Move
and Delete SHALL be unavailable while no entry is selected. The count SHALL
update as entries are selected or deselected.

#### Scenario: Count follows the selection

- **WHEN** a writer selects two entries and then deselects one
- **THEN** the selection bar reports one selected entry

#### Scenario: Actions need a selection

- **WHEN** selection mode is active with no entries selected
- **THEN** Move and Delete are unavailable

#### Scenario: Select all and Deselect all cover the listing

- **WHEN** a writer activates Select all and then Deselect all
- **THEN** first every entry in the current listing is selected and the count equals the listing size, then no entry is selected and the count is zero

### Requirement: Bulk move sends the selection to one destination

The selection bar's Move action SHALL open the existing move destination
picker for the selected entries, identify how many entries are being moved,
and move every selected entry into the confirmed destination folder. The
picker SHALL refuse a destination that is the directory the entries are
currently in or that is one of the selected directories or lies inside one
of them. Canceling the picker SHALL move nothing.

#### Scenario: Moving several entries

- **WHEN** a writer selects two files and one directory, chooses another folder, and confirms the move
- **THEN** all three entries are moved into that folder and no longer appear in the source listing

#### Scenario: Moving into a selected folder is refused

- **WHEN** the chosen destination is a selected directory or lies inside one
- **THEN** the move cannot be confirmed and nothing is moved

#### Scenario: Moving within the source directory is refused

- **WHEN** the chosen destination is the directory currently being browsed
- **THEN** the move cannot be confirmed

#### Scenario: Canceling the move picker changes nothing

- **WHEN** a writer opens the picker and leaves without confirming
- **THEN** every selected entry remains in its original place and nothing is moved

### Requirement: Bulk delete confirms the whole selection first

The selection bar's Delete action SHALL ask for confirmation before deleting
anything, SHALL name how many entries will be deleted, and SHALL warn that
selected folders are deleted with their contents. Canceling SHALL delete
nothing; confirming SHALL delete every selected entry recursively.

#### Scenario: Confirmation names the selection

- **WHEN** a writer activates Delete with three entries selected, including a directory
- **THEN** the confirmation names three entries and states that the directory's contents are deleted too

#### Scenario: Cancel leaves everything in place

- **WHEN** the writer declines the delete confirmation
- **THEN** every selected entry still exists and the selection is unchanged

#### Scenario: Confirm deletes files and folders

- **WHEN** the writer confirms a selection containing files and a non-empty directory
- **THEN** the files and the directory with its contents are deleted and no longer appear in the listing

### Requirement: Bulk operations continue past item failures and report them

A bulk move or delete SHALL apply the selected entries independently: a
failure on one entry SHALL NOT prevent the remaining entries from being
attempted or applied, except that a lost session (`401`) SHALL stop
scheduling further entries while the SPA returns to sign-in. After the
operation the listing SHALL reflect every successful entry, and a
dismissible result notice SHALL report the number of failed entries and
name them with their error class (not found, permission denied, temporarily
unavailable, rejected, or server error), using a bounded sample plus the
remaining count when many entries fail. Failed entries SHALL remain in the
listing. The SPA SHALL NOT automatically retry a failed entry.

#### Scenario: One missing entry does not stop the rest

- **WHEN** three entries are selected and the middle one no longer exists
- **THEN** the other two are moved or deleted, the missing entry remains, and the notice names it as not found

#### Scenario: Every item fails

- **WHEN** every selected entry fails
- **THEN** no listed entry is removed or moved and the notice reports that every selected entry failed

#### Scenario: Permission failures are reported without a retry storm

- **WHEN** the server rejects selected entries with `403`
- **THEN** the notice reports permission denied for those entries and the SPA does not repeat the rejected writes

#### Scenario: A lost session stops the batch

- **WHEN** an entry is rejected with `401`
- **THEN** no further entries are scheduled, already-applied entries remain applied, and the SPA returns to the sign-in screen

#### Scenario: Long failure lists stay summarized

- **WHEN** many selected entries fail
- **THEN** the notice reports the total failure count and shows a bounded sample of failed names rather than an unbounded list

#### Scenario: Dismissing the notice keeps the result

- **WHEN** the writer dismisses the result notice
- **THEN** successfully applied entries stay applied and failed entries stay in the listing

### Requirement: Bulk operations show progress and prevent duplicate runs

While a bulk move or delete is running, the view performing it SHALL disable
every control that could start another batch or leave the operation, and
SHALL report how many selected entries have been processed out of the
selection. The operation SHALL attempt each selected entry once even if the
initiating action is activated repeatedly, and on completion SHALL show the
source listing with its contents refreshed, end selection mode, and show the
result notice when any entry failed.

#### Scenario: Progress is visible

- **WHEN** a bulk operation is running over several entries
- **THEN** the view performing it reports how many entries have been processed so far

#### Scenario: Actions cannot be started twice

- **WHEN** the writer activates Move or Delete again while the same operation is still running
- **THEN** no second batch is started and each selected entry is attempted once

#### Scenario: Completion refreshes and exits selection

- **WHEN** a bulk operation finishes successfully
- **THEN** the source listing reflects the change, selection mode ends, and no failure notice is shown
