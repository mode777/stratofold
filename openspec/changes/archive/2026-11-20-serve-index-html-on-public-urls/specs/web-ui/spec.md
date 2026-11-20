# Spec Delta

## MODIFIED Requirements

### Requirement: Pretty public URLs render the read-only browse view

The SPA SHALL serve `/apps/<public-name>` and its folder paths with the
same read-only public browse view as `/v/<vdir-id>` when the folder has
no index document, for anonymous and signed-in visitors alike. When the
server serves a folder's `index.html`, that document takes precedence
over the browse view. The SPA SHALL keep folder, breadcrumb, preview
(`/apps/<public-name>/view/…`), and back navigation under the alias so
the pretty URL remains the address in the bar, and SHALL show an
explicit not-available state for an unknown, released, or un-published
name.

#### Scenario: Alias browse renders the public view

- **WHEN** a visitor opens `/apps/<public-name>/` or a folder path under it that has no index document
- **THEN** the read-only public browse view renders that vdir's listing with no write or management controls

#### Scenario: A signed-in visitor gets the same read-only view

- **WHEN** the vdir's owner or a share holder opens a folder alias URL with no index document
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

#### Scenario: An index document takes precedence

- **WHEN** a visitor opens `/apps/<public-name>/` or a folder path whose `index.html` the server serves
- **THEN** the index document is shown instead of the SPA browse view
