# 0018 — Global pretty public URLs for vdirs

Status: Superseded by [0019](0019-index-documents-on-public-urls.md)
(2026-11, change `add-pretty-public-urls`)

## Context

Public vdirs were shared only through `/v/<vdir-id>` and
`/files/<vdir-id>/…`, where the path is an opaque record id. A public
folder that is meant to be quoted, printed, or linked from outside the
app needs a stable human-readable address. Public access itself is
already a per-request decision on `vdirs.is_public`; a nice URL must not
create a second authorization model. The full behavior is pinned by
`openspec/specs/public-urls/spec.md`.

## Decision

A vdir may carry one optional **global public name** (`public_slug`) and
is additionally served under `/apps/<name>`:

- The name is a field on `vdirs`, owner-managed through the existing
  record-API rules and unique across the whole instance with a partial
  unique index. The grammar is 2–63 lowercase ASCII letters/digits/
  hyphens, alphanumeric at both ends. Names are rejected, not silently
  normalized.
- Registering a name does not publish the vdir. `/apps/<name>` resolves
  only while `is_public` is true; unknown, released, and non-public
  names are the same `404`, decided from SQLite before any SSH dial. No
  cookie or bearer credential is consulted.
- The bare alias redirects to its slashed form. Slashed paths serve the
  embedded SPA shell (the read-only browse view) without an SSH dial and
  without an implicit `index.html`. An unslashed path that resolves to a
  regular file streams through the existing vdir sandbox and
  `fileserver.ServeFile` path (Range, conditionals, ETag, HEAD,
  reconnect); an unslashed directory redirects to its slashed form and
  a missing path is `404`.
- `view` is the reserved preview namespace at the alias root, mirroring
  `/v/<vdir-id>/view`. A remote root-level `view` directory is reachable
  only through `/files/<vdir-id>/view/…`; nested `…/view/…` is normal.
- A session-free `GET /api/sf/public-urls/<name>` returns only the
  public vdir's id and display name, so the SPA can render an alias
  route without redirecting to the ugly URL.
- Names are resolved per request with no cache. Rename, release,
  un-publish, re-publish, and deletion apply to the next request;
  deleting a vdir frees its name, and a released name is immediately
  registrable by any owner.

## Consequences

- Public links can be stable, memorable, and shareable outside the app
  while the authorization source stays exactly `is_public` plus the
  existing public read rules.
- The global namespace is deliberately first-come, first-served. There
  is no per-account namespace, transfer flow, moderation, reservation
  marketplace, or release cooldown; a released name can later point at a
  different owner's public content.
- Browse routes stay shell-only, so ordinary SPA navigation needs no
  extra SSH dial and keeps the client's retry/not-found states. Direct
  file routes pay one resolution/stat, exactly like `/files`.
- Alias file responses must keep using the `fileserver` seam; a second
  file-serving implementation would drift on Range/conditional/reconnect
  behavior.
- `/apps` is reserved in the SPA fallback and must stay registered before
  the catch-all. The root-level `view` shadowing is an accepted
  limitation inherited from the existing preview route shape.

## Rejected alternatives

- **Redirect the alias to `/v/<vdir-id>`** — the address bar stops being
  pretty after the first navigation and deep links leak the opaque id.
- **Per-account namespace (`/apps/<user>/<name>`)** — the requirement is
  a global, memorable name; per-user prefixes add a second identity to
  quote and still collide inside an account.
- **Auto-generated names** — owners asked for opt-in control, and
  generated names collide and read poorly.
- **The name as a second publication switch** — it would widen public
  access beyond the existing `is_public` model.
- **A separate `vdir_aliases` collection** — one-to-one uniqueness,
  cascade, and ownership already fall out of a vdir field; the extra
  collection adds rules and rebind guards for no behavior.
- **Stat every alias path to choose browse vs file** — an extra SSH dial
  on every SPA navigation and worse client error states; the trailing
  slash plus the reserved `view` segment is the cheaper contract.
- **Serve `index.html` for directory URLs / autoindex** — this is a
  browse product, not a static-site host; explicit file paths still
  serve HTML.
- **Mixed-case or Unicode names with case folding** — two spellings
  would collide invisibly and put normalization rules into URL
  resolution.
