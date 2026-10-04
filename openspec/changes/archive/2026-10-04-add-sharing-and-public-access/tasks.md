# Tasks

## 1. Collection and record-API rules

- [x] 1.1 Add the additive migration (design D5): create `vdir_shares` (`vdir` relation → vdirs, required, CascadeDelete; `user` relation → users, required, CascadeDelete; `role` select `viewer`/`editor`, required; unique index on `(vdir, user)`; owner/grantee list-view rules; owner-only create/update/delete with the `@request.body.vdir.owner` traversal, self-share rejection, and `:isset` rebind guard) and re-save `vdirs` with list/view extended via the `vdir_shares` back-relation, mutation rules unchanged; verify migration applies idempotently on Bootstrap/serve and a test asserts the collections, fields, indexes, and rules exist as specified

- [x] 1.2 Add the record-API rules matrix (design D6) as an httptest suite against the embedded PocketBase: owner grants `viewer`/`editor` on own vdir; duplicate `(vdir, user)` rejected; self-share rejected; grantee lists/views the shared vdir record and their own shares; non-shared user's view/list of the vdir denied; viewer and editor cannot update/delete the vdir record or change `is_public`/connection binding; viewer and editor cannot create, update, or delete shares on the vdir; third parties denied share access with contents unrevealed; deleting the vdir removes its shares; verify with `go test` on the migrations/appserver suite

## 2. Shared authorization seam

- [x] 2.1 Create `internal/vdirauthz` (design D1): resolve effective access (`None`/`Viewer`/`Editor`/`Owner`, plus the record's `is_public`) per request from the vdir record and a current indexed `vdir_shares` lookup, owner via `vdir.owner`; verify with unit tests over the fixture-backed app: each level resolves for its grant, no share resolves to `None`, a deleted share resolves to `None` on the next call, owner outranks nothing-but-itself, and resolution performs no SSH dial

## 3. `/files/*` enforcement

- [x] 3.1 Generalize the access decision in `internal/fileserver.handle` through the seam (design D3): non-public vdirs serve the owner or a `viewer`/`editor` holder, public vdirs serve any request, `401` for anonymous/invalid sessions on non-public, `403` for authenticated users with neither ownership nor a share; verify by extending the file-server auth matrix: owner, viewer, and editor downloads succeed (plain and Range), anonymous on non-public gets `401`, expired/forged cookie `401`, authenticated non-holder `403`, public vdir serves anonymous — and every rejected cell observes zero SSH dials on the fixture (`go test ./internal/fileserver/`)

## 4. `/api/sf/*` enforcement

- [x] 4.1 Generalize `fsapi.authorize` through the seam (design D3): `ls` for owner/viewer/editor (plus anonymous on public), `mkdir`/`mv`/`rm`/`upload` for owner/editor only; verify by extending the fsapi authz matrix: owner executes every operation, viewer's `ls` is served and every write attempt is `403`, editor executes every operation, anonymous on non-public `401`, invalid session `401`, authenticated non-holder `403`, public vdir serves anonymous `ls` only and rejects anonymous writes with `401` — every rejected cell observes zero SSH dials (`go test ./internal/fsapi/`)

## 5. Revocation and public semantics over time

- [x] 5.1 Add the immediate-revocation sequence tests (sharing-access-control spec): viewer downloads, owner deletes the share, the same still-valid `sf_session` gets `403` on the next request (both `/files` and API `ls`); viewer's share changed to `editor` and the next `upload` is accepted without re-login; owner un-publishes a public vdir and the next anonymous request is `401` on both surfaces; verify with `go test ./internal/fileserver/ ./internal/fsapi/`

## 6. Docs and validation

- [x] 6.1 No ADR — the sharing model (two enforcement layers, viewer/editor roles, public = anonymous read-only) is pre-pinned in `docs/architecture.md` and ADRs 0002/0003 cover the substrate; if apply surfaces a new durable decision, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note it here if so). Apply note: the back-relation `?=` rule shape is a PocketBase mechanics constraint, recorded in design D3 — not a durable stack decision

- [x] 6.2 Update docs: reconcile `docs/architecture.md`'s access-enforcement and data-model sections with the shipped rules (vdir_shares shape, vdirs read extension, role mapping) and add dev/verification notes to `AGENTS.md` (new collection, matrix suites, how to run them); verify the docs match the shipped code

- [x] 6.3 Run the full harness: `go vet ./...`, `go test ./...` (record-rules matrix, seam units, both surface matrices, revocation sequences, route-collision assertions re-run), `SF_RUN_GATES=1 go test ./...` (existing gates still pass), and `npx openspec validate --all --strict`; verify all pass
