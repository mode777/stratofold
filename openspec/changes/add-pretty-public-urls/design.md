# Design

## Context

See `proposal.md` — Why. Current constraints that shape the approach:

- A `vdirs` record already has owner-only create/update/delete rules
  (`internal/migrations/migrations.go`), a global `(owner, name)` unique
  index, and per-request publicness checks in every read surface.
- `GET /api/sf/vdirs/<id>/meta` is the existing session-free public
  metadata seam (`internal/vdirmeta`); it returns only `{name,
  is_public}` and 404s non-public vdirs.
- `/files/*` already streams through the vdir sandbox with Range,
  conditional requests, strong ETags, content headers, HEAD, and
  in-response reconnect (`internal/fileserver`). `StatResolved` and
  `ServeFile` are exported and shared with `/s/*`.
- `webassets.Handler` is the last-registered SPA catch-all: real files
  win, extensionless client routes fall back to `index.html`, and
  `/api`, `/files`, `/s`, `/_` are reserved. A new `/apps` server surface
  must be registered before it and reserved in that list.
- The SPA derives the vdir id from `/v/:vdirId` params and builds every
  browse/preview link from hard-coded `/v/...` helpers
  (`web/src/lib/listing.ts`). Media components build `/files` URLs,
  which are pinned by existing `web-ui` requirements.
- Public vdirs are anonymous-read-only; un-publishing is enforced on
  every request through `is_public` with no cached grants.

## Goals / Non-Goals

**Goals:**

- One owner-managed, globally unique, memorable name per public vdir.
- `/apps/<name>` as a full browse surface plus direct file paths, without
  adding a second authorization model or touching `/files`.
- Server-side alias resolution that is fail-closed, uncached, and
  indistinguishable between unknown and non-public names.
- SPA navigation that keeps the pretty URL in the address bar, for
  anonymous and signed-in visitors, without duplicating the browse view.

**Non-Goals:**

- Custom domains/TLS, per-account namespaces, multiple names per vdir,
  name transfers, moderation, or release cooldowns.
- Static-site hosting semantics (implicit `index.html`, autoindex, SPA
  rewrite rules).
- Changes to `/files`, `/v/<vdir-id>`, shares, tokens, or 24-hour links.
- A new client-library API or a public alias-list endpoint.

## Decisions

### D1 — The public name is a field on `vdirs`, not a separate collection

Add `public_slug` (text, optional) plus a **partial unique index**
(`public_slug != ''`) to `vdirs` in migration `1770000009`.

- One name per vdir falls out of the schema, and ownership/cascade reuse
  the existing vdir rules: only the owner can update the record, and
  deleting the vdir deletes the name.
- A separate `vdir_aliases` collection would need its own rules, a
  one-to-one unique index, rebind guards, and a cascade relation for no
  behavior the field cannot express.
- Empty strings do not participate in the unique index, so every
  unnamed vdir can coexist.
- Validation: `Min: 2`, `Max: 63`, `Pattern:
  ^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` (empty is skipped by
  PocketBase's text validator). A record-validate hook checks
  uniqueness and returns a **field error on `public_slug`** with a
  human-readable "already taken" message, so the SPA can distinguish a
  conflict from an unrelated `400`; the unique index remains the race
  backstop.

Rejected: a global map in `_params` (no ownership or cascade), a
`vdir_aliases` collection (extra rules for no gain), and a per-user
`(owner, public_slug)` index (contradicts the global namespace).

### D2 — Names are lowercase ASCII and rejected, not normalized, elsewhere

The name grammar is the URL segment itself: 2–63 characters, lowercase
ASCII letters/digits/hyphens, alphanumeric at both ends. The SPA
lowercases typing, but the record API **rejects** mixed case and other
characters instead of silently rewriting them. Normalizing (case-fold
or transliterate) would make two names collide invisibly and would put
Unicode/case rules into URL resolution.

Rejected: case-insensitive storage with a lowercase shadow column
(complexity for no user benefit), and arbitrary URL-safe characters
(dots and slashes create ambiguous paths).

### D3 — Registration may precede publishing; serving requires `is_public`

The owner may set a name on a private vdir (a reservation). Every
`/apps` request checks the current `is_public` from SQLite before any
dial. Un-publishing makes the alias 404 while keeping the reservation;
re-publishing restores it. The alias is not a second publication switch.

Rejected: auto-generating names for public vdirs (the user chose opt-in,
and auto-names collide), and letting a name publish a private vdir
(would widen access beyond the existing sharing model).

### D4 — `/apps` browse paths serve the shell; unslashed paths resolve files

Route shape (registered before the SPA catch-all):

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/sf/public-urls/{name}` | Session-free resolver; `200 {vdir, name}` for a public alias, else `404` |
| `GET` | `/apps/{name}` | Alias check; `301` to `/apps/{name}/` |
| `GET` | `/apps/{name}/{path...}` | See below |

Handler order for `/apps/{name}/{path...}`:

1. Resolve the alias and require the current `is_public`; else `404`
   (same body/status for unknown, released, and non-public). This is a
   local SQLite read, no SSH.
2. If the virtual tail is empty or ends in `/`, or the root-level
   segment is `view`, serve the embedded SPA shell (`e.FileFS` with
   `router.IndexPage`). No stat, no dial: the browse/preview view owns
   not-found and unavailable states.
3. Otherwise (an unslashed direct-file path), `StatResolved` through the
   vdir sandbox:
   - regular file → `ServeFile` (same Range/conditional/ETag/HEAD path
     as `/files`);
   - directory → `301` to the slashed browse form;
   - missing, sandbox-rejected, or stat error → `404`.

Why split on the trailing slash instead of stat-ing every browse path:
it avoids an SSH dial for ordinary SPA navigation, keeps the client's
deterministic retry/error states, and gives direct file URLs the exact
`/files` semantics. The cost is that a file addressed with a trailing
slash is treated as a browse path (the browse view reports not-found);
this is documented and never serves the wrong bytes.

Directories never resolve an implicit `index.html` and never auto-index;
`/apps/<name>/index.html` is the explicit file path. This is the
deliberate difference from `/files` and follows the chosen "browse UI +
direct file paths" behavior.

The `view` namespace at the alias root mirrors `/v/<vdir-id>/view`, so
the SPA preview route keeps the pretty URL. A remote root-level `view`
directory is shadowed on the alias; `/files/<vdir-id>/view/…` remains the
escape hatch. Nested `docs/view/...` is not reserved.

Rejected: server-side stat on every browse path (extra dial, worse
error states), all-shell responses (no direct file URLs), a redirect to
`/v/<vdir-id>` (the URL stops being pretty after the first navigation),
and a static-only `/apps` surface (loses browsing).

### D5 — Reuse the `/files` seam for alias file responses

`publicurls` calls the existing `fileserver.StatResolved` and
`fileserver.ServeFile`, binds the same `ClearStreamDeadlines` middleware,
and sets the same `Access-Control-Expose-Headers` on the `/apps` group.
This keeps Range/conditional/ETag/HEAD/reconnect behavior identical by
construction, and keeps the vdir sandbox as the only path authority.

The alias route never accepts a session or bearer credential; it only
serves public vdirs. The existing `/files` and `/v` auth paths are
untouched.

### D6 — The resolver is a minimal, uncached, session-free route

`GET /api/sf/public-urls/{name}` returns exactly
`{"vdir": "<record-id>", "name": "<display name>"}` for a name whose
vdir is public, and `404` otherwise. It is mounted under `/api/sf/`
without session middleware, matching `vdirmeta`'s fail-closed shape. It
never returns the slug of a private vdir, the owner, the connection, the
root path, or a list of names.

The SPA needs the vdir id to call `ls`/`stat` (the fsapi routes are
keyed by vdir id). Injecting the id into `index.html` was rejected as a
cache-hostile HTML rewrite; redirecting to `/v` was rejected because it
loses the pretty URL.

No caching layer: a rename/release/un-publish must apply on the next
request.

### D7 — SPA: one browse page, a route-context that carries the base path

Introduce a small browse-route context/provider around the existing
route trees:

- `/v/:vdirId/*` provides `{vdirId, basePath: "/v/<id>", publicMode:
  false, fileBase: "/files/<id>"}` (public `/v` providers set
  `publicMode: true` and `name` from the existing meta probe).
- `/apps/:alias/*` uses an `AliasGate`: it resolves the alias through
  the resolver, then provides `{vdirId, basePath: "/apps/<alias>",
  publicMode: true, fileBase: "/apps/<alias>", name}`.
- `/apps/:alias/view/*` is the preview route under the same provider.

`BrowsePage`, `Breadcrumbs`, and `PreviewPage` derive the virtual path
from the provided `basePath` instead of hard-coding `/v/<id>`, and build
folder/back/preview links from it. The existing `/v` behavior is
unchanged. Media pages receive the same base path for their
navigation-only links (skip-next, dismiss, gallery position); their
**stream and download URLs stay on `/files`**, so the pinned audio/image/
video requirements and their tests remain valid. `ContextMenu` and
`MetadataCard` gain an optional direct-file base so the alias view's
Download and Copy public link use `/apps/<alias>/…` while signed-in `/v`
views keep `/files` unless a registered name is copied.

`SessionGate`/`isAnonymousAllowed` gains `/apps/<alias>/…` as an
anonymous exception; the anonymous route tree gets the alias routes too.
Signed-in visitors use the same alias routes outside `AppShell`, so the
public page never shows the app's tab bar/sidebar. A failed resolution
renders an explicit not-available/page-not-found state, not the login
screen.

Rejected: duplicating the browse/preview pages for aliases (drift and
double maintenance), a client-side redirect to `/v` (loses the pretty
URL), and rewriting media URLs to `/apps` (would contradict the existing
media specs and force unrelated churn).

### D8 — Alias management lives in the sharing screen

The owner gets a public-name control in `web/src/pages/SharingPage.tsx`
(the screen that already owns the public link): input, save, and
release. It validates the grammar client-side, submits `public_slug`
through the existing `updateVdir` record wrapper, lowercases typing, and
maps the server's field error to "already taken". `VdirRecord` gains
`public_slug`. The public link section prefers `/apps/<slug>` when the
vdir is public, falls back to `/v/<id>` otherwise, and describes a
registered name as reserved while the vdir is private. The vdir form
keeps its `is_public` toggle; publishing remains a separate action.

Rejected: a dedicated custom management endpoint (the record API already
enforces ownership and the schema enforces uniqueness), and putting the
control only in the vdir form (the sharing screen owns public links and
is where owners look).

### D9 — Reserve `/apps` in the SPA fallback

Add `/apps` to `webassets.reservedPrefixes` so the SPA catch-all never
answers for an alias miss. The specific `/apps` routes are registered
before `webassets.RegisterRoutes`, so they win; `/api/sf/public-urls` is
inside the custom API namespace and its own route wins there too. A
route-collision test covers the namespace split (file routes under
`/apps`, resolver under `/api/sf/`).

### D10 — ADR 0018 records the durable URL contract

Write `docs/decisions/0018-global-pretty-public-urls.md`: global
namespace, vdir-field ownership, public-only serving, browse-shell vs
direct-file split, reserved `view`, and the release/reuse semantics.
Add it to the ADR index. Future URL-surface work should inherit these
rules rather than re-litigate them.

## Risks / Trade-offs

- **Global namespace squatting** → names are owner-only, one per vdir,
  and syntactically bounded. Moderation, transfers, and cooldowns are
  non-goals; a released name is immediately reclaimable, so old links can
  later point at a different owner's public vdir. Documented in the user
  guide.
- **Duplicate-name race** → the partial unique index is the source of
  truth; the validation hook supplies the friendly field error, and a
  race loser still gets a rejected write, never two owners.
- **Root `view` shadowing** → mirrors the existing `/v` preview namespace;
  `/files` is the documented escape hatch. A user who names a top-level
  folder `view` cannot browse it through the alias.
- **Alias staleness in an open tab** → the SPA resolves the alias once
  per route mount and keeps using the vdir id. If the name is released or
  re-pointed, the next full load follows the new state; every server
  request still enforces current publicness. No cached authorization is
  introduced.
- **Direct-file stat can dial** → only unslashed direct-file paths stat;
  browse paths do not. A failed stat maps to `404` exactly like `/files`.
- **Extra SQLite lookup per `/apps` request** → the slug index makes it
  cheap; not caching is intentional for immediate revocation.
- **Migration on existing databases** → the field defaults to empty and
  the partial index only covers non-empty values, so existing vdirs stay
  unnamed and need no backfill.
- **Deploy skew** → a new SPA against an old server would not understand
  `public_slug`; the project ships SPA and server in one image, so they
  are deployed together. The field is additive for old clients.

## Migration Plan

1. Add migration `1770000009_vdir_public_slug.go`: append the field to
   the existing `vdirs` collection and add the partial unique index.
   No data backfill; unnamed vdirs remain untouched.
2. Register the duplicate-name validation hook at app install (same
   lifecycle position as `connreg.Register`).
3. Deploy the single image; the SPA and server land together. Existing
   `/v`, `/files`, share, and token URLs are unaffected.
4. Rollback: remove the routes and SPA usage; the field/index can remain
   inert or be dropped in a follow-up migration. No remote files are
   modified by this change.

## Open Questions

None — the remaining choices (exact UI copy, component names) do not
change the specs, approach, or task breakdown.
