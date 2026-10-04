# Proposal — `add-sharing-and-public-access`

## Why

Changes 1–5 shipped single-owner storage: every remote operation on a
non-public vdir requires the owner's session, and public vdirs bypass
auth for reads only. The vision promises more — vdirs "can be shared
with other users" with Drive-like semantics — and the shipped code
explicitly defers it (the authorize step in both `/files/*` and
`/api/sf/*` is marked "sharing/roles extend this step"). This is roadmap
change 6: the `vdir_shares` backbone with `viewer`/`editor` roles and
its enforcement in both the PocketBase API rules and the server
middleware, turning isolated personal roots into a shareable product.
The sharing UI itself arrives with the SPA (change 7).

## What Changes

- New `vdir_shares` collection: `(vdir, user, role)` with
  `role ∈ {viewer, editor}` and a unique `(vdir, user)` index. Share
  management (create/update/delete) is restricted to the vdir's owner
  via PocketBase API rules; a user can list and view the grants that
  target them (needed later by the SPA's "shared with me").
- **BREAKING** (rule-level, additive in effect): the `vdirs` record API
  read rules extend from owner-only to owner *or* shared user, so a
  shared user can enumerate and view vdirs shared with them. Mutations
  of vdir records (create/update/delete, including `is_public`) remain
  strictly owner-only.
- `/files/*` access generalizes: on non-public vdirs, users holding a
  `viewer` or `editor` share download like the owner; anonymous and
  unshared authenticated requests are rejected exactly as today
  (`401`/`403`). Public vdirs serve everyone read-only, unchanged.
- `/api/sf/*` access generalizes: `viewer` grants `ls`; `editor` grants
  `ls`, `mkdir`, `mv`, `rm`, `upload` — the full remote operation set
  short of record/share management. Writes still require `editor` or
  owner on every vdir; anonymous access on public vdirs stays read-only
  (`ls`), writes impossible.
- Authorization continues to be decided before any SSH dial, from
  per-request reads of `vdirs` + `vdir_shares` (no cached grants):
  removing a share or un-publishing takes effect on the next request,
  even with a still-valid `sf_session` cookie.
- Shared users never see connection records (owner-only, unchanged) and
  never see other users' shares; the vdir's remote path stays hidden
  from share responses.
- Error semantics preserved: `401` unauthenticated/invalid session,
  `403` authenticated without a sufficient grant, `404` sandbox/missing
  — shared with a viewer attempting a write, a non-shared user on a
  non-public vdir, and anonymous writes on public vdirs map exactly
  like today's non-owner cases.

## Capabilities

### New Capabilities

- `sharing-access-control`: the vdir sharing model — `vdir_shares`
  records (roles, owner-managed, unique per vdir+user), role semantics
  (`viewer` = browse + download, `editor` = + upload/move/delete), the
  permission matrix enforced identically across the record API,
  `/api/sf/*`, and `/files/*`, public-vdir read-only semantics, and
  immediate revocation.

### Modified Capabilities

- `virtual-directories`: the vdir record's list/view API rules extend
  from owner-only to owner or shared user (read-only); create, update,
  delete, and connection binding rules are unchanged.
- `file-server`: the "Access control on /files" requirement — non-public
  vdirs now serve the owner *and* users with a `viewer`/`editor` share
  on the vdir, not only the owner.
- `filesystem-api`: the "Access control on the filesystem API"
  requirement — `ls` extends to viewers, `mkdir`/`mv`/`rm`/`upload` to
  editors; public vdirs keep anonymous-listing-only semantics.

## Impact

- `internal/migrations`: one additive migration creating `vdir_shares`
  (fields, unique index, cascade on vdir/user) and updating the `vdirs`
  list/view rules; existing collections and data untouched.
- A new small authorization seam shared by `internal/fileserver` and
  `internal/fsapi` (per-request resolution of requester → effective
  access against `vdirs` + `vdir_shares`), replacing the two inlined
  owner checks; both call sites keep their authorize-before-dial order.
- `internal/authbridge`, `internal/vdir`, `internal/sshconn`,
  `internal/sftpreadwrite`, `internal/connreg`: consumed unchanged — no
  sandbox, streaming, session, or connection-manager behavior changes.
- Verification additions per the roadmap row: table-driven permission
  matrix (anonymous / other user / viewer / editor / owner × `ls`,
  download, `mkdir`, `upload`, `mv`, `rm` × API and `/files`), the
  public-vdir read-only matrix, revocation-immediacy tests (share
  removed / `is_public` flipped mid-session), and the standing
  route-collision assertion re-run. Harness: `go vet ./... && go test
  ./...`; `SF_RUN_GATES=1` gates continue to pass; `npx openspec
  validate --all --strict` (rules live in the spec deltas).
- ADRs: **No new ADR** — the sharing model (two enforcement layers:
  PB API rules for record CRUD, server middleware for remote
  operations; roles; public = anonymous read-only) is already pinned in
  `docs/architecture.md` (Data model + access-enforcement sections), and
  ADRs 0002/0003 cover the substrate this change rides on. Affected
  docs: `docs/architecture.md` (reconcile enforcement details with the
  shipped rules) and `AGENTS.md` (dev/verification notes for the new
  collection and test matrix).

## Non-goals

- No sharing UI — granting/revoking shares happens over the record API
  until the SPA lands (change 7).
- No per-path or subdirectory shares — a share covers the whole vdir.
- No share links, access tokens, passwords, or expiry dates on shares;
  no groups/teams — shares name individual users.
- No anonymous writes on public vdirs, ever (public is read-only).
- No notifications, invitations, or email on share/unshare.
- No connection-record visibility for shared users, and no exposure of
  other users' shares on a shared vdir.
- No new session/token types — `sf_session` and PB tokens are reused
  as-is; no authz-decision caching beyond per-request reads.
- No quota, audit log, or per-share download counters.
