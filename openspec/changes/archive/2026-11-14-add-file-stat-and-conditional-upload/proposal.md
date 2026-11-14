# Proposal

## Why

`@stratofold/client` is being adapted as the workspace provider for a
separate browser editor shell. That provider needs two primitives the
current API does not have:

1. **Single-path metadata** — kind, size, modification time, and an
   opaque version — without listing the parent directory.
2. **A conditional write** — an upload that fails instead of silently
   replacing newer content.

Today `ls` returns only `{name,size,dir,modtime}`; the file server's
ETag is `size + mtime` in whole seconds; and `upload` always replaces
the target. A same-length save inside one second is therefore invisible
to a client, and two editors can overwrite each other between a
pre-check and the upload's atomic publish. A parent `ls` can stand in
for the missing metadata, but neither a client-side workaround nor a
pre-upload comparison can produce an authoritative version or an atomic
precondition — that has to be server-side.

## What Changes

- Add `POST /api/sf/vdirs/{vdirId}/stat` with `{"path": "..."}`
  (an empty path or empty body means the vdir root). It returns
  `{path, name, kind, size, mtime, version}` with `kind` one of
  `"file"` or `"directory"`, directories reporting `size: 0`, and the
  root statable.
- Add `version` to every `ls` entry. `version` is an opaque strong
  validator that:
  - changes whenever Stratofold publishes new content at the path,
    including a same-size upload inside the same whole second;
  - is stable for repeated observations while the remote signature and
    the server-side publication generation are unchanged;
  - is the same value used by `ls`, `stat`, the file server's `ETag`,
    and conditional upload for the same resolved file or directory.
- Derive the file server's `ETag` from that version (the quoted strong
  form) while keeping `If-None-Match`, `If-Modified-Since`, Range, and
  `HEAD` behavior unchanged. ETag values may change once on upgrade;
  conditional GET semantics do not.
- Extend `POST /api/sf/vdirs/{vdirId}/upload?path=...` with
  `If-Match: "<version>"` (strong comparison; `*` means the target must
  exist). A stale precondition returns `412 Precondition Failed`,
  publishes nothing, removes the temp file, and returns the current
  version in the body when one exists. The authoritative check runs at
  publish time, not only when the request starts.
- Keep uploads without `If-Match` exactly as they are today
  (create-or-replace).
- Add a per-target in-process publication lock so two concurrent
  conditional uploads cannot both pass the same precondition. The
  residual external-editor stat→rename window is documented in the
  design rather than closed with distributed locking.
- Add `If-Match` to the upload route's CORS preflight allowance and pin
  it with a cross-origin test.
- Extend `@stratofold/client`:
  - `stat(path, {signal})`;
  - `version` on `LsEntry`;
  - `upload(path, body, {ifVersion, signal, onProgress})`;
  - a new `conflict` failure kind for `412` (existing kinds unchanged),
    carrying the server's current version when supplied;
  - still no retries of uploads or mutations.
- Record the durable version/validator and conditional-write decision in
  a new ADR, and update the architecture, agent, and client docs.

All wire/API changes are additive. A client that omits `If-Match` and
ignores `version` sees no behavior change. The TypeScript `LsEntry`
type gains a required `version` field, which is a compile-time change
only for code that manufactures listing entries; response handling is
additive. `mkdir`/`rm`/`mv` request semantics and their
idempotency/retry rules are unchanged; `mv` only updates the new
version bookkeeping for its target. No new runtime dependency is
introduced, and this change does not publish the npm package.

Assumptions recorded, not blocking: `stat` echoes the requested virtual
path; its `name` is the final virtual path segment, or the vdir record's
name for the root; `version` is returned unquoted and `ETag` is its
quoted form; `If-Match` accepts the strong entity-tag list grammar (weak
tags never match) or `*`; an empty `If-Match` or malformed value is
`400`; a missing target with `If-Match` is `412`; a missing parent stays
`404`; only the owner or an `editor` share may upload, exactly as today.

## Capabilities

### New Capabilities

None. The behavior belongs to existing capabilities.

### Modified Capabilities

- `filesystem-api`: adds the `stat` operation and `version` on listing
  entries; adds the conditional-upload precondition, `412` semantics,
  and the publication-time check. Access control and error mapping
  extend to `stat` without changing their rules.
- `file-server`: changes the ETag source to the shared content version
  and requires the version to agree with `stat`/`ls`; conditional GET,
  Range, and `HEAD` semantics stay unchanged.
- `client-library`: adds `stat`, `LsEntry.version`, conditional upload,
  and the `conflict` error kind.

`file-links` is **not** modified as a capability: `/s` links reuse the
file server's serving path and therefore inherit the new ETag, but no
requirement in the `file-links` spec changes. `web-ui`, `upload-queue`,
`sharing-access-control`, `vdir-access-tokens`, and `virtual-directories`
are not modified — there is no SPA work and no authorization change.

## Impact

- **Server code**:
  - new `internal/fileversion` (version derivation, generation store,
    batch lookup for listings);
  - `internal/migrations/1770000008_file_versions.go` (internal
    metadata collection, no record-API rules);
  - `internal/fsapi` (`stat` handler, `ls` versions, `If-Match` parse
    and publish-time check, per-target publication lock, `412` mapping);
  - `internal/fileserver` (`StatResolved`/`ServeFile` carry the version;
    ETag derives from it);
  - `internal/appserver` (route collision inventory and the upload CORS
    preflight test).
- **Client code**: `client/src/types.ts`, `client/src/errors.ts`,
  `client/src/client.ts`, `client/src/index.ts`, unit tests, and the
  README snippets.
- **Tests**: `internal/fsapi` (stat/version/conditional-upload and
  concurrency matrices), `internal/fileserver` (ETag/304 agreement and
  unchanged conditional semantics), `internal/appserver` (CORS
  `If-Match`), `client` (stat, version, `ifVersion`, `conflict`, no
  retry, README typecheck), plus the existing `SF_RUN_GATES=1` upload
  gates.
- **Docs**: **new ADR
  `docs/decisions/0015-content-version-and-conditional-writes.md`**
  and a row in `docs/decisions/README.md`. ADR 0015 is the next number
  in `docs/decisions/`; because the roadmap had reserved 0015/0016 for
  the unwritten conditional follow-ons (changes 12–13), those
  reservations move to 0016/0017 in `docs/roadmap.md` as a docs-only
  renumbering. `docs/architecture.md` gains the stat route, the
  version invariant, the ETag source, and the conditional publish;
  `AGENTS.md` gains the filesystem-api/client/verification pointers;
  `client/README.md` documents stat, version, `ifVersion`, and
  `conflict`. `README.md`, `docs/hosting.md`, and
  `docs/using-stratofold.md` need no change: there is no user-facing UI
  or hosting behavior change.
- **Dependencies / release**: none. The npm release workflow is already
  tag-driven and is not part of this change.

## Non-goals

- No Exo or Exo-adapter code in this repository.
- No changes to `rm`, `mv`, or `mkdir` semantics; no recursive `ls`; no
  abort-signal overhaul beyond the new `stat` and the existing upload;
  no general error-code overhaul.
- No content hashing of remote files on read, no server-side file or
  content cache, and no remote sidecar/metadata files.
- No distributed or cross-process locking, and no attempt to serialize
  external SFTP clients.
- No change to the vdir sandbox, the authorization model, bearer role
  rules, or the upload streaming/resume mechanics; atomic publication
  gains a precondition and version bookkeeping, not a different
  transfer or buffering behavior.
- No SPA work, no new dependency, and no npm publish as part of this
  change.
