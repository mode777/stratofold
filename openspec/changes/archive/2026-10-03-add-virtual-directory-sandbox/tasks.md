# Tasks

## 1. Secret sealing (`internal/sealbox`)

- [x] 1.1 Implement the AES-256-GCM sealbox package (D2): random 32-byte key persisted once in PocketBase's internal params store, `v1:<base64(nonce||ciphertext)>` envelope format, seal/unseal API; verify unit tests: seal→unseal round-trips arbitrary secrets, a tampered ciphertext fails, unsealing with a different key fails, and the same key is reused across instances over the same params store

## 2. Collections and API rules (migration)

- [x] 2.1 Write the PocketBase migration creating `connections` (owner relation→users, label, host, port, username, auth_method, secret fields `password`/`private_key`/`key_passphrase` — plain, sealed at rest and stripped from responses by connreg hooks per the D2 apply correction — and `host_key_fingerprint`) and `vdirs` (owner relation→users, connection relation→connections, name, `root_path`, `is_public`) with owner-only API rules including the cross-owner connection guard on `vdirs` create/update, and the unique (`owner`,`name`) index on `vdirs` (D1/D6); verify the migration applies idempotently on a fresh app and both collections exist with the expected fields and rules

- [x] 2.2 Add the authz-matrix httptest suite over real API requests (D1): table-driven owner/non-owner/anonymous × (list, view, create, update, delete) for both collections asserting allowed/denied per cell, plus the vdir-over-foreign-connection rejection on create and on update rebinding; secret fields absent from every response including the owner's (spec "secrets never exposed" scenarios); verify the suite passes and fails when a rule is loosened (mutation check)

## 3. Manager registry (`internal/connreg`)

- [x] 3.1 Implement the connection-record → `sshconn.Manager` registry (D3): lazily build one manager per connection record from the unsealed record fields and pinned fingerprint, share it across vdirs, invalidate+close on record update/delete via record hooks, close all on terminate; verify unit tests over a seeded app: two vdirs over one record yield the same manager, a record update replaces the manager and `Config()` reflects the new fields, delete drops it, and unsealing failures surface as permanent dial-time errors

## 4. Lexical path resolution (`internal/vdirpath`)

- [x] 4.1 Implement the pure lexical resolver (D4): reject null bytes and absolute forms, collapse `.`/empty/`..` segments, reject results climbing above the root, treat backslashes as ordinary characters, accept the empty virtual path as the root itself; verify the unit traversal table: `../`-climbing, percent-encoded dots after decoding, leading-`/`, null bytes, redundant segments (`docs/./a.txt`, `docs//a.txt`, `docs/sub/../a.txt`), backslash escapes (`..\..\etc\passwd`), and interior `..` that stays inside the root — each row asserts resolved-under-root or rejected per spec

## 5. Vdir resolver and sandbox enforcement (`internal/vdir`)

- [x] 5.1 Implement the record-aware resolver (D4/D5): load vdir+connection, lexical check before any dial, then server-side containment — realpath of root as baseline, realpath of the joined path required equal-or-below it — operating on the server-resolved path and exposing the connection's client provider; verify with the in-proc SSH fixture: lexically-invalid paths are rejected with zero dials observed, containment accepts normal paths and internal symlinks, rejects a symlink pointing outside, and enforces against a symlinked root's resolved location

- [x] 5.2 Add the integration proof through the seam (spec "maps onto the actual remote subfolder"): seed `<root>/docs/a.txt` on the fixture, resolve `docs/a.txt` through the vdir and read it via `sftpreadwrite` — checksum equals the source; a file outside the root on the same host is unreachable through the vdir (every attempt rejected); verify both hold and the read is byte-exact

## 6. Bootstrap wiring

- [x] 6.1 Install the migration in the server bootstrap (`cmd/stratofold`/`appserver`) so a fresh `pb_data` gains both collections at startup, and register the connreg record hooks app-wide; verify a locally started server exposes the two collections over the PocketBase API (owner-authenticated CRUD works end-to-end) and the existing suite (`internal/appserver`, `internal/authbridge`) still passes

## 7. Docs and validation

- [x] 7.1 No ADR — 0002 (records + API rules for plain CRUD) and 0003 (SSH stack, pinned host keys) already record the durable decisions this change implements (D1–D6 are mechanics within them); if apply surfaces a new durable decision, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note it in this file if so)

- [x] 7.2 Update docs: reconcile `docs/architecture.md` data-model details with the shipped collections (field names, hidden/encrypted secrets, unique index) and add dev-workflow notes to `AGENTS.md` (creating a connection + vdir via the API for manual testing, where the sealing key lives); verify the docs match the shipped code

- [x] 7.3 Run the full harness: `go vet ./...`, `go test ./...` (sealbox, authz matrix, connreg, traversal table, resolver + fixture integration), and `npx openspec validate --all --strict`; verify all pass
