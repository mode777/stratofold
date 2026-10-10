# Design

## Context

The server already serves public vdirs to anonymous callers: the
filesystem API lists for anyone on a public vdir and `/files/*` skips
auth when `is_public` is set (`internal/fileserver/fileserver.go`). The
SPA is the gap — `SessionGate` (`web/src/App.tsx`) renders only the
login screen for `state === "anonymous"`, and the browse view reads the
vdir record (name, role) through the authenticated record API, which an
anonymous visitor cannot call. The sharing UI has no link affordance
today. See proposal.md — Why.

Constraints that shape the design:

- The record API's `vdirs` rules expose own/shared vdirs only; an
  anonymous client has no way to learn even the vdir's name today.
- The `401` interceptor (`web/src/lib/filesApi.ts`) globally clears the
  session; it must not destabilize an anonymous visitor.
- `/files/*` behavior is frozen by the file-server spec — no server-side
  regression budget beyond the existing suites.
- The e2e harness already seeds a public vdir (`e2eharness.PubID`).

## Goals / Non-Goals

**Goals:**

- Let an anonymous visitor resolve "is this vdir public, and what is it
  called" in one cheap request, with fail-closed semantics.
- Reuse the existing browse/preview UI for anonymous visitors instead of
  building a parallel public viewer.
- Keep signed-in flows byte-for-byte identical in behavior.

**Non-Goals:** (see proposal — Non-goals; design-level additions)

- No caching layer for the meta route or for publicness checks —
  un-publishing must cut access on the next request, matching the
  sharing spec's revocation semantics.
- No changes to `useVdirRole`'s derivation rules; anonymous mode simply
  feeds it no record, so it reports no write permission.

## Decisions

### D1: Gate anonymous entry with a meta probe, not a client-side list

`SessionGate` keeps its "anonymous → login screen" rule for every route
except `/v/:vdirId` (browse) and `/v/:vdirId/view/*` (preview). On those
two route shapes an anonymous visitor is let through to the browse UI,
which resolves publicness by calling the meta route: `200` → render the
read-only view; `404` (non-public or unknown id) → render the login
screen. The same probe supplies the vdir name the record API would
normally provide.

- *Rejected — ship anonymous clients an allowlist of public vdir ids*:
  requires a new list surface and leaks the set of public vdirs; the
  proposal excludes public discovery.
- *Rejected — probe with `ls` and fall back on `401`*: conflates
  "not public" with "session expired", loses the vdir name (breadcrumbs,
  title), and makes the not-available state ambiguous after
  un-publishing. One dedicated metadata request is cheaper than a
  directory listing and unambiguous.

### D2: Meta route as its own single-route package

`GET /api/sf/vdirs/<vdir-id>/meta` lives in a new `internal/vdirmeta`
package (mirroring the `internal/userlookup` precedent for one-route
custom surfaces), registered in `internal/appserver` before the SPA
catch-all. It loads the `vdirs` record through the PocketBase core API,
answers `{"name": …, "is_public": true}` for public vdirs, and `404`
for everything else. GET only; no session middleware; no streaming
deadline handling needed.

- *Rejected — fold it into `internal/fsapi`*: fsapi's surface is the
  session-gated operation set with stream-deadline wiring; the meta
  route is deliberately session-free and would muddy that package's
  authz posture.
- *Rejected — a public-friendly record-API rule (e.g. a `vdirs` view
  rule on `is_public`)*: API rules cannot cleanly expose exactly two
  fields of a single record without also opening list-shaped access;
  rule surgery on a live capability is riskier than an additive custom
  route under `/api/sf/`.

### D3: One browse UI, a public mode — not a parallel viewer

`BrowsePage` and `PreviewPage` gain a public mode provided by a small
context (vdir id + name + mode) set during anonymous entry:

- the record-API `listVdirs()` call is skipped (it would `401`); the
  name comes from the meta probe;
- `useVdirRole` receives no record and yields no write permission — the
  existing "write actions only where permitted" gating already hides
  New/Upload and the context-menu write entries;
- downloads, previews, and media keep using plain `/files` URLs, which
  already work anonymously;
- a `401` or `404` on any request in public mode renders the explicit
  not-available state (with a sign-in affordance) instead of the generic
  unauthorized failure — this is the un-publish path.

`AppShell` hides the Files/Uploads/Settings destinations when the
session is anonymous, so the public view is self-contained. Routes other
than browse/preview remain unreachable anonymously (D1).

- *Rejected — a dedicated public share page*: duplicated navigation,
  breadcrumbs, sort, and preview logic for no product gain; the spec
  pins "same behavior, fewer affordances".

### D4: The public link is the plain absolute app URL

The sharing page shows `window.location.origin + "/v/" + <vdir-id>`
while the vdir is public, with a clipboard copy action and a visible
selectable-link fallback for non-secure contexts (clipboard API needs a
secure context). No token, no expiry: revocation is the `is_public`
toggle, and the link's meaning is defined entirely by server-side
publicness.

- *Rejected — tokenized/secret links*: a different capability with its
  own threat model (unguessability, rotation, expiry); deferred, not
  silently dropped.
- *Rejected — surfacing the link only on the vdir form*: sharing
  affordances belong on the sharing screen (also the explicit user
  request).

### D5: `/files/*` web hosting is protected by omission plus gates

No file-server code changes. The non-regression gates are the existing
`go test ./internal/fileserver/` matrix and golden script, plus one e2e
assertion that an anonymous visitor's `index.html` fetch on the seeded
public vdir still serves. Any accidental coupling shows up in CI, not in
production.

## Risks / Trade-offs

- [Meta route discloses public vdirs' names to anyone holding the id] →
  acceptable: the vdir's content is already public; only the name is
  added, non-public/unknown ids stay `404`, and no other field is
  returned.
- [Anonymous traffic increases SSH-host load] → public reads use the
  same per-request authz-before-dial path and the same per-connection
  manager as signed-in reads; no new caching or connection fan-out.
- [Clipboard API unavailable (plain HTTP)] → the sharing UI always
  renders the link as selectable text next to the copy button, so the
  link is obtainable without the async clipboard.
- [SessionGate change regresses signed-in flows] → the exception is
  scoped to the two `/v/` route shapes and only when
  `state === "anonymous"`; the component gate matrix covers signed-in,
  expired, and anonymous cases.
- [Stale open tab keeps working after un-publish until the next
  request] → by design (per-request authz, matching the sharing spec);
  the next action lands in the not-available state.

## Migration Plan

Additive: one new route, SPA changes behind the existing build. No
schema migration, no config. Rollback = revert; the meta route's
removal degrades anonymous entry back to the login screen (the pre-
change behavior) without touching stored data.

## Open Questions

None.
