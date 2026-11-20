# Spec Delta

## Purpose

Gives public vdirs globally unique, owner-managed, human-readable URLs
under `/apps/` that render the read-only browse view and serve direct
file paths, while keeping the existing public access rules unchanged.

## ADDED Requirements

### Requirement: Public names are global owner-managed vdir attributes

The system SHALL store an optional public name (`public_slug`) on each
vdir, managed exclusively by that vdir's owner through the vdir record,
and globally unique across all users. A name SHALL be 2–63 lowercase
ASCII characters from `[a-z0-9-]`, starting and ending with a letter or
digit; an empty value SHALL mean no name. A name MAY be set before the
vdir is public.

#### Scenario: Owner claims a name

- **WHEN** a vdir's owner sets `public_slug` to a valid unused name on their vdir
- **THEN** the vdir stores the name and later reads return it

#### Scenario: Names are global across accounts

- **WHEN** a second user tries to set a name already registered by a different owner's vdir
- **THEN** the write is rejected with a validation error on the name field and the first owner's registration is unchanged

#### Scenario: Invalid names are rejected

- **WHEN** a name contains uppercase letters, underscores, dots, slashes, spaces, or Unicode, is shorter than 2 or longer than 63 characters, or starts or ends with a hyphen
- **THEN** the write is rejected and no name is registered

#### Scenario: Only the owner manages the name

- **WHEN** a viewer, an editor, or an unrelated user attempts to set, change, or clear a vdir's public name
- **THEN** the record-API write is denied and the name is unchanged

#### Scenario: An empty value releases the name

- **WHEN** the owner clears the vdir's `public_slug`
- **THEN** the vdir has no public name and the name becomes available to any owner

#### Scenario: Deleting the vdir frees the name

- **WHEN** a vdir with a registered name is deleted
- **THEN** the name is released and another vdir may register it

### Requirement: Pretty URLs serve only public vdirs

The system SHALL resolve `/apps/<name>` to the vdir whose `public_slug`
exactly equals `<name>` and SHALL serve the alias only while that vdir's
`is_public` is true. Unknown, unregistered, released, renamed-away, and
non-public names SHALL yield the same `404` with no vdir data and SHALL
be decided before any SSH dial. No cookie or bearer token SHALL be
consulted, and an alias SHALL grant nothing beyond the vdir's public
read access.

#### Scenario: A public alias serves anonymously

- **WHEN** a request without any session opens a name registered to a public vdir
- **THEN** the alias is served as the vdir's public read-only presentation

#### Scenario: A private alias is not disclosed

- **WHEN** any request opens a name registered to a vdir whose `is_public` is false
- **THEN** the response is `404` and indistinguishable from an unknown name

#### Scenario: Unknown and released names are not found

- **WHEN** a request opens a name that was never registered or was released
- **THEN** the response is `404`

#### Scenario: Un-publishing closes the alias immediately

- **WHEN** the owner turns off `is_public` and the next request opens the vdir's alias
- **THEN** the response is `404`, the registration remains stored, and turning `is_public` back on restores the alias

#### Scenario: An alias never widens access

- **WHEN** a signed-in user opens the alias of a public vdir
- **THEN** the alias serves the same read-only public content and grants no write or management access

### Requirement: Alias browse paths render the SPA shell

The system SHALL redirect `GET /apps/<name>` to `/apps/<name>/` and
SHALL serve the embedded SPA shell for every slashed path of a public
alias, without an autoindex and without resolving an implicit
`index.html`. Serving the shell SHALL NOT require an SSH dial; the SPA
browse view resolves the path and renders its not-found or unavailable
state.

#### Scenario: The bare alias redirects to the browse root

- **WHEN** a client requests `/apps/<name>` for a public alias
- **THEN** the response is a `301` to `/apps/<name>/` and the slashed form serves the SPA shell

#### Scenario: Nested directory paths serve the shell

- **WHEN** a client requests `/apps/<name>/docs/` or `/apps/<name>/docs/sub/`
- **THEN** the SPA shell is returned with `200` and the browse view resolves the directory

#### Scenario: Directories never auto-index or resolve index.html

- **WHEN** a public folder contains `index.html` and its slashed alias path is requested
- **THEN** the SPA browse view is served instead of the file; `/apps/<name>/index.html` remains the explicit way to stream that file

#### Scenario: Missing browse paths surface in the browse view

- **WHEN** a slashed alias path names a directory that does not exist
- **THEN** the shell is served and the browse view shows its not-found state

### Requirement: Alias file paths stream with file-server semantics

For an unslashed `/apps/<name>/<virtual-path>` of a public alias, the
system SHALL stream a resolved regular file through the vdir sandbox
with the same `GET`/`HEAD`, Range, conditional, strong `ETag`, content
header, and reconnect behavior as `/files`; SHALL redirect an unslashed
directory to its slashed browse form (`301`); and SHALL answer `404` for
missing or sandbox-rejected targets, never serving content from outside
the vdir root.

#### Scenario: File content is byte-exact

- **WHEN** an existing file is requested through its alias path
- **THEN** the response body equals the remote file's bytes exactly

#### Scenario: Range requests work

- **WHEN** a `Range: bytes=2-5` request targets a 10-byte file through an alias
- **THEN** the response is `206` with `Content-Range: bytes 2-5/10` and exactly that slice

#### Scenario: Validators and HEAD work

- **WHEN** a file is requested through an alias with a matching `If-None-Match`, or with `HEAD`
- **THEN** the conditional GET returns `304`, and the HEAD returns the same validators and `Content-Length` with no body

#### Scenario: An unslashed directory redirects

- **WHEN** an unslashed alias path resolves to a directory
- **THEN** the response is `301` with a `Location` pointing at the slashed browse path

#### Scenario: Missing files are not found

- **WHEN** an unslashed alias path does not exist on the remote
- **THEN** the response is `404`

#### Scenario: Sandbox escapes are rejected

- **WHEN** an alias file path attempts traversal, encoded dot segments, or a remote symlink escape
- **THEN** the response is `404` and no bytes outside the vdir root are served

### Requirement: The alias resolver is session-free and minimal

The system SHALL expose `GET /api/sf/public-urls/<name>` under the
custom `/api/sf/` namespace without session middleware. For a public
vdir's registered name it SHALL return only the vdir's id and display
name; for any other name it SHALL return `404`. It SHALL NOT disclose
non-public records, the owner, the connection binding, the root path, a
list of registered names, or secret material.

#### Scenario: A public alias resolves to its vdir

- **WHEN** an anonymous request resolves a name registered to a public vdir
- **THEN** the response is `200` with that vdir's id and display name and no other fields

#### Scenario: Private and unknown names are not disclosed

- **WHEN** a request resolves a name registered to a non-public vdir or a name that does not exist
- **THEN** the response is `404` and no vdir data is returned

#### Scenario: The resolver requires no session

- **WHEN** the resolver is called without a cookie or bearer token
- **THEN** it answers successfully for a public alias and never creates a session

### Requirement: The preview namespace is reserved at the alias root

The system SHALL serve the SPA shell for `/apps/<name>/view` and
`/apps/<name>/view/…`, mirroring the `/v/<vdir-id>/view/…` preview
namespace, and SHALL NOT stream a remote root-level `view` entry
through those paths. Only the root-level `view` segment is reserved;
a nested path such as `/apps/<name>/docs/view/photo.jpg` remains a
normal file path, and `/files/<vdir-id>/view/…` remains available for
direct access to a root-level `view` directory.

#### Scenario: Preview paths serve the shell

- **WHEN** a client requests `/apps/<name>/view/photo.jpg`
- **THEN** the SPA shell is served for the preview route, not the file bytes

#### Scenario: A root-level view directory is shadowed

- **WHEN** the remote vdir root contains a directory named `view`
- **THEN** `/apps/<name>/view/…` renders the preview route and the directory is reachable only through `/files/<vdir-id>/view/…`

#### Scenario: Nested view names are not reserved

- **WHEN** a file lives at `docs/view/photo.jpg`
- **THEN** `/apps/<name>/docs/view/photo.jpg` streams it normally

### Requirement: Alias lifecycle changes apply on the next request

The system SHALL resolve the current name, vdir, and `is_public` state
from the database on every request without cached aliases, so a
rename, release, deletion, or publicness change applies to the next
request. A rename SHALL free the previous name immediately, and a
released or deleted name SHALL be immediately registrable by any owner.

#### Scenario: A rename moves the URL

- **WHEN** the owner changes a public vdir's name from `old` to `new`
- **THEN** the next request to `/apps/old` is `404` and `/apps/new` serves the vdir

#### Scenario: A released name can be reclaimed

- **WHEN** an owner releases a name and another owner registers it on their public vdir
- **THEN** the next request to that name serves the second owner's vdir

#### Scenario: Deletion releases the name

- **WHEN** a vdir with a registered name is deleted and another vdir registers the name
- **THEN** the name resolves to the new vdir on the next request
