# Design — `add-sharing-and-public-access`

## Context

The authorization step this change generalizes exists twice, inline:
`fileserver.handle` step (2) and `fsapi.authorize` both do cookie →
`FindAuthRecordByToken` → `user.Id == vd.owner`, with public vdirs
bypassing auth for reads (`fsapi`) or everything (`/files`, GET-only).
Records live in PocketBase collections with API rules
(`internal/migrations`), and the codebase already has the rule-shape
precedents this change needs (`@request.body.<rel>.owner` traversal and
the `:isset` rebind guard on `vdirs.UpdateRule`). The SSH fixture
observes dials, which is how the "rejected requests never dial"
property is asserted today. Motivation: proposal.md; behavior contract:
the four spec deltas.

## Goals / Non-Goals

**Goals:**

- One shared, per-request access decision (requester → effective
  access) used identically by `/files/*` and `/api/sf/*`, replacing the
  two inlined owner checks.
- `vdir_shares` as plain PocketBase record CRUD — no custom routes for
  share management; rules carry the policy.
- Immediate revocation as a structural property (no cache to invalidate),
  not a feature.

**Non-Goals:**

- No sharing UI, share links, groups, expiry, per-path ACLs, or
  anonymous writes (see proposal Non-goals).
- No changes to the sandbox, session bridge, connection manager, or
  streaming layers; `sf_session` semantics are untouched.

## Decisions

### D1 — One shared authz seam for both remote surfaces

New small package `internal/vdirauthz`: given the app, the vdir record,
and the authenticated user (or none), resolve effective access once per
request — `None` / `Viewer` / `Editor` / `Owner` (ordered) plus the
record's `is_public` flag. `fileserver.handle` and `fsapi.authorize`
both call it and keep only their surface-specific mapping (which
operations each level permits; 401-vs-403 selection). The owner check
(`user.Id == vd.owner`) moves inside the seam.

*Rejected:* duplicating role logic in both packages — the two surfaces
must decide identically or the permission matrix diverges; one seam
makes drift structurally impossible. *Rejected:* a global router
middleware — the decision needs the vdir record the handler also uses;
passing it through middleware context adds indirection without saving
the per-handler lookup (same reasoning as fsapi D2's rejection).

### D2 — Role model: viewer < editor < owner, public orthogonal

`viewer` = `ls` + `/files` download. `editor` = viewer + `mkdir`, `mv`,
`rm`, `upload` — the full remote operation set short of record/share
management, which stays owner-only. `is_public` is orthogonal and only
ever grants read (listing + download) to anonymous requests; it never
grants write to anyone. Owner strictly outranks any share; shares
naming the vdir's owner are rejected as meaningless (rule-guarded), so
resolution is unambiguous.

*Rejected:* a single boolean "can edit" share — the vision's Drive-like
model and `docs/architecture.md` pin two roles (browse+download vs
+upload/move/delete). *Rejected:* per-path grants — whole-vdir shares
are the roadmap scope; per-path ACLs would drag the sandbox resolver
into authz and are deferred. *Rejected:* letting `editor` manage shares
— share management is ownership of the vdir record, not of its content;
editors mutating the guest list would be privilege escalation.

### D3 — Enforcement stays two-layered, exactly as architecture.md pins

- Record CRUD (shares, and the vdirs read extension) → PocketBase API
  rules in the migration: `vdir_shares` list/view = owner of the vdir
  or the grantee; create/update/delete = the vdir's owner, with the
  codebase's established guards (`@request.body.vdir.owner` traversal
  to bind the share to an own vdir, self-share rejection, `:isset`
  rebind guard on update so a share cannot be re-pointed at a foreign
  vdir); `vdirs` list/view extend via the `vdir_shares` back-relation
  (`…_via_vdir.user = @request.auth.id`), create/update/delete rules
  unchanged.
- Remote operations → the D1 seam. The mapping: read op allowed when
  `is_public` or access ≥ Viewer; write op only when access ≥ Editor;
  anonymous (`401`) only ever passes on public reads.
- Back-relation rule shape (apply note): the `vdirs` read rule must use
  the multi-match operator (`vdir_shares_via_vdir.user ?=
  @request.auth.id`), not `=` — with a single-relation back-reference
  PB's join fans out per share row, and a plain `=` silently stops
  matching as soon as a vdir holds more than one share. Verified against
  the embedded PB request pipeline (grantees pass, outsiders and
  anonymous are denied, with multiple shares per vdir).

*Rejected:* enforcing remote ops in PB rules — rules cannot see remote
filesystem operations; the middleware is the seam architecture.md
fixes. *Rejected:* enforcing record CRUD in the seam — that would
re-implement what API rules already do (ADR 0002's "no custom code for
record CRUD").

### D4 — Revocation immediacy by construction: per-request lookup

The seam resolves shares from SQLite on every request (unique-indexed
`(vdir, user)` lookup); nothing caches grants, so delete/role-change/
un-publish apply to the next request even for a still-valid
`sf_session` — the property the spec pins. The cost is one indexed
query per request on shared vdirs, negligible next to any SSH dial.

*Rejected:* caching grants with a TTL — a stale-access window directly
violates the revocation requirement and buys nothing at Stratofold's
scale (requests are dominated by remote I/O).

### D5 — `vdir_shares` collection shape

Fields: `vdir` (relation → vdirs, required, single, CascadeDelete),
`user` (relation → users, required, single, CascadeDelete), `role`
(select `viewer`/`editor`, required, single). Unique index on
`(vdir, user)`; cascade on both relations so deleting a vdir or user
leaves no orphan grants (a spec scenario). One additive migration file
next to `1770000001_connections_vdirs.go`, which also re-saves the
`vdirs` collection with the extended list/view rules; both apply
idempotently on serve, as today.

*Rejected:* an `owner` field on shares — derivable via `vdir.owner`;
duplicating it invites disagreement. *Rejected:* blocking (non-cascade)
user relation — deleting a user would strand shares that still grant
access.

### D6 — Verification: one table-driven matrix, two surfaces

A shared fixture-driven matrix (anonymous / other user / viewer /
editor / owner × `ls`, download, `mkdir`, `upload`, `mv`, `rm` × API,
`/files`) asserts status codes per cell, reusing the in-proc testssh
fixture's dial counter for the zero-dial assertion (the change-5
pattern). Public-vdir and revocation rows ride the same table plus
dedicated sequence tests (grant → use → revoke → next request). Record
API rules get their own httptest matrix against the embedded PB
(grant, duplicate, self-share, grantee visibility, third-party denial,
cascade). `SF_RUN_GATES=1` gates are untouched and must keep passing.

*Rejected:* per-surface hand-written tests — the matrix table is the
roadmap's named validation strategy and makes a missed cell visible as
a hole in the table, not a missing test file.

## Risks / Trade-offs

- [Shared users can read the vdir record's `root_path` and connection
  id through the record API] → Accepted: no secrets live in `vdirs`
  (connection secrets stay owner-only in `connections`); the
  alternative — hiding the record and inventing a projection endpoint —
  adds a custom surface ADR 0002 exists to avoid. Noted in the proposal.
- [PB rule strings are easy to get subtly wrong (back-relations,
  `:isset` guards)] → The record-API matrix runs against the real
  embedded PocketBase, not mocked rules; a wrong rule fails a named
  scenario.
- [Two enforcement layers can drift over time] → Remote-surface logic
  is one seam (D1); record rules are pinned by spec scenarios; the
  matrix covers both surfaces from one table (D6).
- [Per-request share lookup on hot `/files` paths] → Indexed single-row
  query; if it ever matters, an invalidation-keyed cache is a local
  optimization that preserves the immediacy contract (not needed now).

## Migration Plan

Additive migration only: new collection + two changed rule fields on
`vdirs`. Applies on serve / Bootstrap like every migration; rollback is
removing the migration file (no data shape changes to existing
collections, nothing to un-seal or backfill).

## Open Questions

None — the remaining choices (exact rule strings, seam function
signature) are mechanics within D1/D3/D5.
