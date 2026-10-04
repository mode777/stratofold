# Tasks

## 1. Streaming ranged read (`internal/sftpreadwrite`)

- [x] 1.1 Add the streaming ranged read method (design D3): `ReadRangeTo(ctx, w io.Writer, off, length int64)` reusing the `readInto` offset+limit pipeline so bytes flow to the writer with resume-at-served-offset across connection drops; existing methods unchanged; verify unit tests over the SSH fixture: byte-exact slices at nonzero offsets, injected mid-read drops resume within one call and still deliver the exact range, and short remote ranges fail with `io.ErrUnexpectedEOF`

## 2. File server core (`internal/fileserver`)

- [x] 2.1 Implement route registration, per-segment percent-decoding, and vdir resolution (design D1): `GET /files/{vdirId}/{virtualPath...}` plus the bare `/files/{vdirId}` form, decoded virtual path through `vdir.Resolver`, resolver rejections and missing targets mapped to `404`; verify with httptest + SSH fixture: requested content is byte-exact, lexical/encoded traversal and remote-symlink escapes return `404` with nothing outside the root served, unknown vdir and missing file return `404`

- [x] 2.2 Implement the authorize-before-dial access check (design D2): vdir record load → public/owner decision → resolve; non-public vdirs serve only the owner's valid `sf_session` cookie; verify with httptest: owner-with-cookie serves, anonymous and forged/expired cookies get `401` with zero SSH dials observed on the fixture, authenticated non-owner gets `403`, and a public vdir serves the same request anonymously

## 3. Range, conditional, and content headers

- [x] 3.1 Implement the Range engine (design D5): single-range parse (`start-end`, `start-`, `-suffix`), clamp end to size-1, `206` + `Content-Range`, unsatisfiable → `416` + `Content-Range: bytes */<size>`, multi-range/foreign-unit/malformed ignored as full `200`, `Accept-Ranges: bytes` on success; verify the table-driven matrix over the fixture covering every spec scenario row (status, Content-Range header, slice bytes vs source offsets)

- [x] 3.2 Implement conditional and representation headers (design D4): `ETag`/`Last-Modified` from one remote stat, `If-None-Match` (list or `*`) precedence over `If-Modified-Since`, `304` without body, `Content-Type` from the built-in extension table defaulting to `application/octet-stream`, `Content-Length` exact for both 200 and 206; verify with httptest: 304/precedence rows, table mappings, default type, and Content-Length values

## 4. Directory semantics

- [x] 4.1 Implement index.html resolution and slash canonicalization (design D6): directory target serves `<dir>/index.html` when present else `404` (never a listing), unslashed directory URL `301`-redirects to the slashed form preserving the query, bare `/files/{vdirId}` behaves as the root directory, file-with-trailing-slash is `404`; verify with httptest over seeded fixture directories

## 5. Streaming behavior under failure

- [x] 5.1 Add the deterministic mid-transfer reconnect test (roadmap R1 at the HTTP layer): the fixture's connection killer terminates the SSH connection mid-Range-response; the in-flight response resumes at the served offset and completes byte-exact, and an aborted response followed by a client `Range` retry from the received offset returns exactly the remaining bytes; verify both paths pass in the normal suite (`go test ./internal/fileserver/`)

- [x] 5.2 Add the streaming/memory gate: download a multi-GB sparse fixture file end-to-end asserting checksum equality with flat peak process memory, and a response that outlives default HTTP write timeouts completing (deadlines cleared per auth-session D5); verify with `SF_RUN_GATES=1 go test ./internal/fileserver/`

## 6. Bootstrap wiring

- [x] 6.1 Wire the file server into `internal/appserver.Install` with `ClearStreamDeadlines` on the `/files/*` routes and extend the route-collision assertions: `/files/*` serves through the new handler while `/api/sf/*` and PocketBase built-ins (including `/api/files/*`) behave unchanged; verify the existing `internal/appserver` and `internal/authbridge` suites still pass with the new assertions

## 7. Golden curl matrix script

- [x] 7.1 Write `scripts/fileserver-golden.sh` (design D8): against a running server + seeded fixture, curl-assert the whole matrix — content checksums, every Range row (status/Content-Range/slice checksum), conditional 304s, mime/index rows, auth rows — each row asserting status and headers; verify the script exits 0 end-to-end (in-proc fixture locally; `SF_TESTSSH_MODE=external` on the build server)

## 8. Docs and validation

- [x] 8.1 No ADR — 0002 (PocketBase embed + cookie bridge, streaming deadlines) and 0003 (SFTP offset streaming) already record the durable decisions this change implements (D1–D8 are mechanics within them); if apply surfaces a new durable decision, write `docs/decisions/0006-*` per TEMPLATE.md and index it in `docs/decisions/README.md` (note it in this file if so)

- [x] 8.2 Update docs: reconcile `docs/architecture.md`'s `/files/*` section with the shipped handler (route shapes, auth order, Range/conditional/index semantics) and add dev-workflow notes to `AGENTS.md` (running the golden script against a dev server); verify the docs match the shipped code

- [x] 8.3 Run the full harness: `go vet ./...`, `go test ./...` (fileserver matrix, reconnect, authz, wiring), `SF_RUN_GATES=1 go test ./...` for the risk gates, and `npx openspec validate --all --strict`; verify all pass (the change-1 throughput gate margin was retuned 0.80 → 0.65 — measured healthy envelope 0.70–0.83 across hosts with the rationale recorded in the gate file; A/B on pristine code proved no regression)
