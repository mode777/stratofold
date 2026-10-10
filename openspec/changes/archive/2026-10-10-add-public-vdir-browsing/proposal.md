# Proposal

## Why

A public vdir is already anonymously readable over HTTP — `/files/…`
serves anyone and the filesystem API lists for anyone — but the SPA
shows every unauthenticated visitor the login screen, so the only link
an owner can share today is a bare file or `index.html` URL. There is no
login-free way to hand someone a *browsable* view of a public vdir, and
the sharing UI offers no link to copy.

## What Changes

- **Login-free public browsing in the SPA**: an unauthenticated visitor
  opening `/v/<vdir-id>/…` gets a read-only browse view of that vdir —
  listing, subdirectory navigation, breadcrumbs, preview, download, and
  media playback all work with no account and no session. No write
  affordance (new-folder/rename/move/delete/upload), no upload queue
  surface, and no management destination (vdir switcher, Uploads,
  Settings) is reachable anonymously; every other route still lands on
  the login screen.
- **Public vdir metadata route**: a new session-free
  `GET /api/sf/vdirs/<vdir-id>/meta` returns the minimal metadata the
  anonymous browse view needs (name, public marker) for public vdirs;
  non-public and unknown ids yield `404` — no existence disclosure, no
  other fields.
- **Public link in the sharing UI**: for a public vdir the owner sees
  the absolute browse link with a copy action; for a non-public vdir the
  section states that no public link exists (publishing stays with the
  vdir form's existing `is_public` toggle).
- **Un-publishing cuts access on the next request**: an open anonymous
  browse view surfaces an explicit not-available state once requests are
  rejected, and the shared link stops resolving into the app.
- **`/files/*` web hosting is untouched**: public dirs keep serving
  `index.html`, redirects, Range, and conditionals exactly as specified;
  the existing file-server suites gate the non-regression.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sharing-access-control`: adds the anonymous, session-free public-vdir
  metadata route (name + public marker for public vdirs only, `404`
  otherwise) — the server half of login-free browsing.
- `web-ui`: carves the public-vdir exception into the login-gate
  requirement, pins the anonymous read-only browse behavior, and adds
  the public-link affordance to the sharing UI.

## Impact

- **Server**: one new route mounted in `internal/appserver` beside the
  existing single-route packages (userlookup precedent); no migration,
  no record-rule change; the filesystem API and `/files/*` are untouched.
- **SPA**: routing/session gate (`web/src/App.tsx`), browse and preview
  pages, sharing page, and a small public-meta client wrapper; anonymous
  mode gains no write or management affordances.
- **Tests**: Go route tests (public serve / non-public + unknown `404` /
  signed-in flows unaffected), component tests (anonymous browse matrix,
  login-gate exception, public-link section), E2E on the verification
  server (the harness already seeds a public vdir).
- **Docs**: AGENTS.md web-UI section gains the public-browse/link
  summary; no ADR and no decisions-doc change.

## Non-goals

- No tokenized, secret, or expiring links — the public link is the plain
  `/v/<vdir-id>` URL, valid exactly while the vdir is public.
- No anonymous write path — `is_public` never implies write (unchanged).
- No change to `/files/*` requirements or to the `vdir_shares` model.
- No public discovery — anonymous visitors reach only a vdir whose link
  they already hold; there is no public index of vdirs.
- No offline/service-worker behavior for anonymous visitors.
