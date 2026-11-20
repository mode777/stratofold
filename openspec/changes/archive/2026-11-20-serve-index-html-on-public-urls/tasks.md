# Tasks

## 1. Server index resolution

- [x] 1.1 Update `internal/publicurls` directory handling: for a public public alias, check `<virtual-path>/index.html` through `fileserver.StatResolved`; stream a regular index through `fileserver.ServeFile`, otherwise serve the SPA shell. Keep the bare-alias `301`, the `view` namespace, unslashed file/directory handling, and public-only checks unchanged; verify with `go test ./internal/publicurls/`.
- [x] 1.2 Update the HTTP matrix: root `index.html` is served at `/apps/<name>/`, nested `docs/index.html` is served at `/apps/<name>/docs/`, a folder without an index still serves the shell, missing directories still fall back to the browse shell, explicit `/index.html` streams the file, and `/view/…` remains the preview shell even with a root-level `view/index.html`; verify `go test ./internal/publicurls/`.
- [x] 1.3 Adjust the existing comments/assertions that claimed slashed paths never dial; the index probe is a sandboxed stat and may dial, while private/unknown aliases still never dial. Verify `go test ./internal/appserver/ ./internal/publicurls/ ./internal/migrations/`.

## 2. SPA and E2E behavior

- [x] 2.1 Update the public-URL E2E: the seeded root `index.html` is served at `/apps/<slug>` (static site), a subfolder without an index still renders the read-only browse view, previews/downloads remain under the alias, and un-publish/re-publish/release still behave as before. Verify `web/e2e/public-urls.spec.ts` on the build/verification server against the production-built server.
- [x] 2.2 Confirm the SPA component suites still pass, including the alias-gate and unavailable-state tests, with `npm --prefix web run test`.

## 3. Documentation and decisions

- [x] 3.1 Write `docs/decisions/0019-index-documents-on-public-urls.md` (index precedence, one stat per directory URL, reserved `view`, unchanged direct-file/browse fallback), mark ADR 0018 superseded in `docs/decisions/README.md`, and update the ADR body; verify `npx openspec validate --all --strict`.
- [x] 3.2 Update `docs/using-stratofold.md`, `docs/hosting.md`, `docs/architecture.md`, `README.md`, and `AGENTS.md`: directory URLs serve `index.html` when present and fall back to the browse view only without one; remove the old "directories never resolve index.html" statements.

## 4. Verification

- [x] 4.1 Run `go vet ./... && go test ./...` and confirm the full Go suite passes.
- [x] 4.2 Run `npm --prefix web run build && npm --prefix web run test` and confirm the SPA builds and all component suites pass.
- [x] 4.3 Run the full E2E suite against the production-built server (or the release image) on the build/verification server and confirm all tests pass.
- [x] 4.4 Run `npx openspec validate --all --strict`.

## Verification record

- 2026-11-20: `go vet ./...` and `go test ./...` pass, including the
  updated `internal/publicurls` index matrix and the appserver route
  collision tests.
- 2026-11-20: `npm --prefix web run build` passes; `npm --prefix web run
  test` passes 38 files / 455 tests.
- 2026-11-20: full E2E suite (40 tests) passes against a production-built
  `stratofold-e2e` server on the build/verification server, with the
  seeded root `index.html` served at the alias and a subfolder without an
  index rendering the browse view.
- 2026-11-20: `npx openspec validate --all --strict` passes (19 items).
