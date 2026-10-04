# Design — `add-virtual-directory-sandbox`

## Context

Change 1 delivered the SSH/SFTP core as standalone packages
(`internal/sshconn`, `internal/sftpreadwrite`, `internal/ssherr`) with
connection configs supplied by the caller; change 2 embedded PocketBase
with the auth bridge but wired no records to the SSH layer ("wiring to
PocketBase records is change 3"). This change adds the persistence and
the sandbox seam between them: `connections`/`vdirs` records, a manager
registry feeding `sshconn.ClientProvider`, and path resolution that
pins every virtual path under its vdir root. Motivation and scope:
proposal.md; behavior contract: the `virtual-directories` spec delta.

## Goals / Non-Goals

**Goals:**

- Owner-only `connections`/`vdirs` CRUD via PocketBase API rules, no
  custom CRUD code.
- Secrets encrypted at rest, never returned by any API response.
- One `sshconn.Manager` per connection record, lazily built and
  invalidated on record change.
- A resolution layer that is the only route to a vdir's remote
  filesystem, failing closed (no dial) on any rejection.

**Non-Goals:**

- No HTTP routes (`/files/*`, `/api/sf/vdirs/*`) — changes 4–5 consume
  the seam.
- No sharing/roles/public enforcement (`is_public` is stored, inert
  until change 6).
- No new remote operations (mkdir/mv/rm/upload are change 5); proving
  containment uses stat/realpath-class calls only.

## Decisions

### D1 — Collections + API rules, registered by a migration

`connections` (owner relation→users, label, host, port, username,
auth_method [`password`|`key`], password, private_key, key_passphrase,
host_key_fingerprint) and `vdirs` (owner relation→users, connection
relation→connections, name, root_path, is_public bool) are created by a
PocketBase migration with these rules:

- `connections`: list/view/update/delete `@request.auth.id != "" &&
  owner = @request.auth.id`; create additionally
  `@request.body.owner = @request.auth.id`.
- `vdirs`: same owner predicates, plus a cross-owner connection guard
  on create (`@request.body.connection.owner = @request.auth.id`) and
  on update (`@request.body.connection:isset = false ||
  @request.body.connection.owner = @request.auth.id`).
  *Apply correction:* PocketBase evaluates update rules against the
  **stored** record, so a plain `connection.owner = ...` update rule
  never sees the rebinding payload — the update guard inspects
  `@request.body` instead (denied rebinds surface as 404, PB's
  standard update-denial shape).

A unique index on (`owner`, `name`) keeps vdir names unambiguous per
user (URLs still key on vdir id per `docs/architecture.md`).

*Rejected:* custom `/api/sf/*` CRUD endpoints — `docs/architecture.md`
and ADR 0002 pin plain record CRUD to PocketBase collections with API
rules, no custom code; an endpoint would also need its own authz tests
for what rules give for free.
*Rejected:* enforcing ownership only in Go middleware — rules are the
enforcement point PocketBase already tests; middleware would be a
second, drift-prone copy.

### D2 — Secret fields: never exposed, AES-256-GCM at rest

The three secret fields are plain (writable) `text` fields whose
exposure is controlled in two hooks registered by the connection-record
bridge (`internal/connreg`, D3): an `OnRecordEnrich` hook applies
`Record.Hide(...)` so the fields are absent from every API response
(list/view/create/update), including the owner's, and model-level
create/update hooks seal any incoming plaintext into
`v1:<base64(nonce||ciphertext)>` before the record hits SQLite
(idempotent: already-sealed `v1:` values pass through untouched).

*Apply correction:* the original D2 marked the fields PocketBase
`Hidden`, but PocketBase also rejects **writes** to hidden fields from
non-superusers over the record API, which would stop owners from ever
supplying credentials; enrich-hook hiding keeps the exact same
read-side guarantee while leaving the write path to the owner. Sealing
is AES-256-GCM with a random 32-byte key generated on first use and
persisted in PocketBase's internal params store (domain-separated, not
derived from token secrets so token rotation cannot orphan stored
secrets). Sealing/unsealing happens in a small `internal/sealbox`
package; server code only ever sees plaintext in memory when building
the `sshconn.Config`.

*Rejected:* plaintext + API rules alone — the spec requires encrypted
at rest; the SQLite file must not carry credentials.
*Rejected:* field-level crypto inside PocketBase — no such core feature;
a custom field type couples us to internals for no gain over a 50-line
package.
*Rejected:* PocketBase `Hidden` fields — blocks owner writes over the
record API (see apply correction above).
*Accepted trade-off:* losing the params key (deleted DB metadata)
orphans secrets; rotation of the params key is out of scope until a
real need appears.

### D3 — Manager registry: one `sshconn.Manager` per connection record

`internal/connreg` maps connection record id → `*sshconn.Manager`,
building one on demand from the decrypted record (host, port, user,
auth material, pinned fingerprint) and handing out its
`ClientProvider`. Record update/delete hooks invalidate (and close) the
cached manager, so the next use rebuilds from current fields — the
"updated record takes effect" behavior. App terminate closes all.

*Rejected:* a manager per vdir — N vdirs over one connection would dial
N times, breaking "one managed connection per record" and wasting the
idle-TTL/reconnect machinery.
*Rejected:* manager per request — kills connection reuse entirely;
backoff/TTL semantics (change 1) assume a stable owner per config.

### D4 — Resolution: lexical first, then server-side containment, operate on the resolved path

`internal/vdirpath` is a pure lexer over `/`-separated virtual paths:
reject null bytes and absolute forms; collapse `.`, empty and `..`
segments; reject if the result climbs above the root; backslashes are
ordinary characters (POSIX SFTP), so `..\..\etc` stays a name inside
the root. `internal/vdir` then combines vdir record + resolved virtual
path: it obtains the connection's client, resolves the root's real
location (baseline) and the joined path's real location on the server,
and requires the latter to equal the baseline or sit below it
(`<root>/…`). Operations then target the *server-resolved* path, not
the lexical one.

*Apply correction:* SFTP `RealPath` (as served by pkg/sftp, and in
general not guaranteed to follow links) proved purely lexical — it
never sees symlink escapes. The resolver therefore walks the path
component-by-component server-side (`Lstat` each, follow symlinks with
a bounded hop count, fold `.`/`..`), producing a canonical, symlink-
free path for both root and target; containment is checked between
those. This is what actually implements the "remote symlink escape"
requirement.

*Rejected:* lexical check only — remote symlinks defeat it (the R4
escape the roadmap names); the server-side walk is the only way to see
them.
*Rejected:* SFTP `RealPath` for the containment step — lexical on the
served implementation, so symlinks pass undetected (see apply
correction).
*Rejected:* realpath check on the lexical path, then open the lexical
path — leaves a TOCTOU window where the link is swapped between check
and use; operating on the resolved path closes it.
*Rejected:* rejecting every `..` segment even when containment holds —
the spec allows redundant segments that stay inside the root, and
normalization is trivial to do correctly before any network I/O.
*Rejected:* URL-decoding inside the resolver — decoding belongs to the
HTTP layer (changes 4–5 must pass decoded paths); resolving raw encoded
input would double-decode and blur which layer rejects what. The
spec's encoded-dot scenario is satisfied by handlers decoding before
resolution; the resolver's own tests feed decoded traversal.

### D5 — Fail closed, and lexically before dialing

Resolution rejects before any remote I/O in this order: vdir/connection
record load → lexical check → client acquisition → server containment
check. Any earlier rejection therefore never dials (observable:
rejected paths leave no SSH connection behind), and a rejection is
never distinguishable from "outside access allowed".

*Rejected:* dial-then-validate — wakes connections for garbage or
malicious requests and turns a cheap CPU check into a network wait.

### D6 — `is_public` stored, deliberately inert

The column exists now so changes 4–6 do not need a migration riding on
a security change, but nothing reads it yet; public semantics
(anonymous read, bypass rules) are change 6 per the roadmap.

*Rejected:* omitting the field until change 6 — forces a schema
migration into a security-focused change later; the inert column costs
nothing now. *Rejected:* enforcing a owner-only default value logic —
the owner may set it freely; enforcement is a reader concern.

## Risks / Trade-offs

- [PocketBase API-rule semantics differ subtly from expectations (update
  rules evaluating the proposed record)] → the authz matrix test
  exercises every rule over real httptest requests, including the
  cross-owner connection rebinding attempt, so a wrong rule fails a
  test rather than shipping.
- [Symlink walk adds O(components) round-trips per resolution] →
  bounded and stat-class only, once per logical operation (not per
  streamed chunk); deep paths can shortcut later if profiling demands
  it without changing the contract.
- [TOCTOU between containment check and use on a hostile server] →
  operations target the server-resolved path (D4); residual risk
  (server-side path mutation mid-operation) is inherent to SFTP and out
  of scope.
- [Params-store key loss orphans secrets] → accepted (D2); failure mode
  is a permanent error at dial time, never silent misauthentication.
- [Migration drift between environments] → collections ship as
  idempotent PB migrations run at bootstrap; no manual admin steps.

## Migration Plan

New collections only — no existing data format changes, nothing to
migrate back. Rollback is reverting; leftover collections in a dev
SQLite file are inert. Secrets sealed under the params key remain
readable across reboots (key persists in the same data dir).

## Open Questions

None — collection field details follow `docs/architecture.md`'s data
model sketch, and remaining mechanics are settled above.
