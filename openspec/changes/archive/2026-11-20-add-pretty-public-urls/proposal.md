# Proposal

## Why

A public vdir is currently shared through a `/v/<vdir-id>` link built from
an opaque record id. That is hard to say, type, print, or remember, and it
does not look like a real public folder address. Stratofold already exposes
public directories as a read-only file server; adding a stable,
human-readable name gives each public folder a memorable global URL such as
`/apps/my-public-folder` without changing how public access is authorized.

## What Changes

- Every vdir gains an optional **public name** (`public_slug`) that its
  owner can claim, rename, or release. Names are global across the whole
  instance (not scoped to an account), lowercase, and unique, so only one
  vdir can own `/apps/<name>` at a time.
- A vdir's pretty URL works **only while the vdir is public**. Registering a
  name while the vdir is private is allowed (it reserves the name), but
  every `/apps/<name>` request for a non-public vdir is an indistinguishable
  `404`. Un-publishing keeps the name reserved; re-publishing restores the
  URL immediately.
- New public route surface `/apps/<name>`:
  - The bare alias and every trailing-slash path render the read-only SPA
    browse view, so folder navigation stays under the pretty URL.
  - An unslashed path that resolves to a file **streams the file directly**
    with the existing `/files` read semantics: Range, conditionals, strong
    ETag, content headers, reconnect, and `HEAD`.
  - An unslashed directory redirects to its slashed form; a missing
    unslashed path is `404`. Directories never auto-index and never resolve
    an implicit `index.html` — `/apps/<name>/` is the browse view, while
    `/apps/<name>/index.html` streams the HTML file when linked explicitly.
  - `view` remains the preview namespace at the vdir root (mirroring
    `/v/<id>/view`); a remote root-level `view` directory is shadowed on the
    pretty URL and remains reachable through `/files`.
- A session-free resolver route
  (`GET /api/sf/public-urls/<name>`) returns the public vdir's id and display
  name so the SPA can render an alias route without a session or a redirect
  that would reveal the ugly URL.
- The SPA gains `/apps/:alias/*` browse and preview routes that render the
  same read-only public view as `/v/<vdir-id>`, keep folder, breadcrumb,
  preview, and back navigation under the alias, and show an explicit
  not-available state for unknown, released, or un-published names. Signed-in
  visitors get the same read-only presentation; management stays in the
  signed-in views.
- The sharing UI gains a **public name** control for the vdir's owner
  (claim, change, release) with client-side format checking and a clear
  duplicate-name error. The public link and per-file **Copy public link**
  action prefer the pretty URL when a name is registered, and fall back to
  `/v/<vdir-id>` and `/files/<vdir-id>/…` otherwise.
- No change to existing public access rules: anonymous requests still get
  exactly the read-only public access they have today, and `/files`,
  `/v/<vid>`, tokens, shares, and 24-hour links are untouched.

## Capabilities

### New Capabilities

- `public-urls`: globally unique owner-managed public names on vdirs, the
  public-only `/apps/<name>` browse and direct-file surface, the session-free
  alias resolver, and the release/rename/un-publish lifecycle.

### Modified Capabilities

- `web-ui`: anonymous alias routes are added to the login exception, the
  alias browse/preview routes keep pretty navigation and a not-available
  state, the sharing UI manages the public name, and the public browse/file
  links prefer the registered alias.

## Impact

- Code: a new vdirs migration (the `public_slug` field and a partial unique
  index), a vdir validation hook for duplicate-name field errors, a new
  `internal/publicurls` route package (alias resolution, `/apps` browse/file
  routing, the `/api/sf/public-urls/<name>` resolver), appserver route
  wiring, the `webassets` reserved-prefix list, and SPA routing/context
  changes in `web/src/App.tsx`, `BrowsePage`, `PreviewPage`, `Breadcrumbs`,
  the media pages, and `SharingPage`.
- Tests: migration/record-rule matrices, alias resolution and direct-file
  HTTP matrix (browse shell, redirects, Range/conditional/HEAD, traversal,
  private/un-published 404s, lifecycle), route-collision tests, SPA
  component tests, and a Playwright public-URL suite on the verification
  server.
- Docs: **new ADR
  `docs/decisions/0018-global-pretty-public-urls.md`** plus the
  `docs/decisions/README.md` index; `docs/using-stratofold.md` (claiming and
  sharing a public name), `docs/hosting.md` (the `/apps/*` surface and
  publicName logging/privacy notes), `docs/architecture.md` (route, data
  model, and SPA route map), `README.md`, and the `AGENTS.md` file-server and
  web-UI guidance.
- No breaking change: aliases are additive. Existing links continue to work
  unchanged, and no session, token, share, or `/files` behavior changes.

## Non-goals

- No custom domains, DNS, or per-vdir TLS; pretty URLs live on the
  Stratofold instance's own origin.
- No per-account namespace (`/apps/<user>/<name>`), no multiple names per
  vdir, and no name transfers between users.
- No reserved-name marketplace, moderation, verification, or release
  cooldown: a released name is immediately available to any owner.
- No general static-site hosting behavior: directory URLs do not resolve an
  implicit `index.html`, never generate an autoindex, and do not rewrite
  SPA routes. Query the explicit file path to serve HTML.
- No change to private access, shares, vdir access tokens, 24-hour file
  links, `/files`, or `/v/<vdir-id>`.
- No SEO/SSR work, no per-alias redirects beyond the trailing-slash
  canonical form, and no client-library/API-surface changes.

## Assumptions

- Registering a name is allowed while the vdir is not public (reservation);
  the URL only serves while `is_public` is true.
- Names are lowercase ASCII only; the UI lowercases typing, and the record
  API rejects mixed-case or invalid names rather than silently rewriting
  them.
- Signed-in visitors opening an alias URL get the read-only public
  presentation; management continues through the signed-in vdir routes.
- Alias changes are effective on the next HTTP request, but an already-open
  SPA tab may keep rendering its resolved vdir until navigation/reload; the
  server still enforces publicness on every request that matters.
- The `/apps` prefix is reserved server-side; `/apps` itself is not a
  user-facing destination.
