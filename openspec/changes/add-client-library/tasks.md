# Tasks

## 1. Package scaffold and build

- [x] 1.1 Create `client/` with `package.json` (name `@stratofold/client`, `"files": ["dist"]`, `exports`, `types`, no runtime `dependencies`), a TypeScript config, and scripts for the ESM/type build (`tsc`) and IIFE bundle (esbuild, global `Stratofold`); verify `npm --prefix client run build` emits `dist/index.js`, `dist/stratofold.min.js`, and `dist/index.d.ts`.
- [x] 1.2 Verify the published shape: `npm --prefix client pack --dry-run` lists only the dist files, README, and license metadata; `npm --prefix client ls --omit=dev` is empty; an ESM import and a script-tag smoke test both reach the public API.
- [x] 1.3 Add build artifacts and local env files to `.gitignore` (`client/dist/`, `client/node_modules/`, `client/test-client/node_modules/`, `client/test-client/dist/`, `.env*.local`) and verify `git status` stays clean after a full build.

## 2. Client transport and operations

- [x] 2.1 Implement the client core: required absolute `baseUrl` and `vdir` validation, trailing-slash normalization, URL and JSON-body construction, bearer header injection, and `StratofoldError`/`UploadCanceled`; verify unit tests cover the 401/403/404/400/503/500 and status-0 mapping, that no request retries, and that the token never appears in a URL or body.
- [x] 2.2 Implement `list`, `read`, and `tokenInfo` against the existing endpoints; verify unit tests cover root and nested listing, range/conditional header forwarding on `read`, scope discovery, and not-found mapping.
- [x] 2.3 Implement `mkdir`, `move`, and `remove` with the filesystem-API request shapes; verify unit tests assert the exact URL/body per call, success resolution, and that a rejected mutation produces exactly one request.
- [x] 2.4 Implement `upload` on `XMLHttpRequest` with progress, abort, success result, and error mapping; verify unit tests cover progress reporting, `UploadCanceled` on abort, target/size on success, and no retry on failure.
- [x] 2.5 Implement `temporaryUrl` (absolute `/s` URL plus expiry, local `unauthorized` without a token) and `fileUrl` (pure `/files` builder), and make public mode work by omitting the `Authorization` header; verify unit tests cover the absolute/relative resolution, no token in the minted URL, the local rejection, and a token-free request.
- [x] 2.6 Write the API reference in `client/README.md` (construction, operations, error classes, public mode, upload resume caveat, token-audience warning) and verify every documented snippet type-checks against the package.
- [x] 2.7 Add a Go regression test asserting that a foreign-origin preflight for the routes this client uses (`ls`, `upload`, `links`, `tokens/me`) allows `Authorization` and `Content-Type`, and expose the representation headers the client reads; if the preflight is rejected, add the explicit CORS handling in `internal/appserver`/`internal/fsapi` and re-run `go test ./internal/appserver/ ./internal/fsapi/`.

## 3. Static test client

- [x] 3.1 Scaffold `client/test-client/` as a private Vite app that consumes the built package (resolved to `../dist`), with a connection form for base URL, token, and an optional vdir id for public mode; verify `npm --prefix client/test-client run build` succeeds and the page serves locally.
- [x] 3.2 Add the operation panel covering list, read/download, upload (with progress/abort), mkdir, move, remove, scope discovery, and temporary URL, plus a result/error log; verify unit tests cover the config store (token in `sessionStorage`, base URL/vdir in `localStorage`) and the operation dispatch, and a manual pass exercises each action.
- [x] 3.3 Add the dev-only `.env.local` prefill behind `import.meta.env.DEV` and a production-build guard that fails when any `VITE_SF_*` value is set; verify `VITE_SF_TOKEN=x npm --prefix client/test-client run build` fails and a clean build contains no `sf_v1_` string.
- [x] 3.4 Make the app deploy under the Pages repository subpath with Vite `base=/stratofold/`; verify the built page loads with `vite preview` at that base path and all assets resolve.

## 4. Pages deployment and root scripts

- [x] 4.1 Add `.github/workflows/client-pages.yaml` (push to `main` on `client/**`, `workflow_dispatch`; build package then test client; secret scan for `sf_v1_`; `upload-pages-artifact` + `deploy-pages`; `pages: write`, `id-token: write`) and verify the YAML parses and the local build commands in it run as written.
- [x] 4.2 Add root `package.json` shims (`client:build`, `client:test`, `client:e2e`, `client:pages:build`) and verify each runs the expected workspace command.

## 5. ADR and documentation

- [x] 5.1 Write `docs/decisions/0013-client-distribution.md` (npm as source of truth, no instance-hosted `/embed`, static Pages test client is verification-only) per `TEMPLATE.md`, add it to the `docs/decisions/README.md` index, and verify `npx openspec validate --all --strict` passes.
- [x] 5.2 Extend `client/README.md` with installation, the test-client URL, the Pages deployment flow, the not-yet-automated npm publish steps, and the token-audience rule; verify the commands and links are accurate against the committed files.
- [x] 5.3 Update `AGENTS.md` with the `client/` package, the test client, and the local verification commands (`npm --prefix client run test`, the verification-server E2E), and update `docs/roadmap.md` change 11 and its sequencing notes to drop the instance-hosted embed; verify no remaining roadmap text promises `/embed`.
- [x] 5.4 Add the root `README.md` pointer to the client docs and verify the links resolve.

## 6. Verification

- [x] 6.1 Add `client/test-client/e2e/client.spec.ts` and a Playwright config: start `cmd/stratofold-e2e` and the test-client dev server on a second origin, mint an `editor` token through the API (the suite uploads and mutates), and assert list, upload, range read, temporary-link redemption without cookies, public mode, and that no request URL carries the token.
- [x] 6.2 Run the suites: `npm --prefix client run test`, `npm --prefix client/test-client run test`, `go test ./...`, and the E2E on the build/verification server (`npm --prefix client/test-client run e2e` with `SF_E2E_EXECUTABLE`), recording the results.
- [x] 6.3 Run `npx openspec validate --all --strict` and confirm this change validates.

## Verification results (2026-11-09)

- `npm --prefix client run test`: 32 tests passed (operation/error/upload/URL
  suites, ESM import, IIFE `Stratofold` global).
- `npm --prefix client run typecheck:readme`: 8 README snippets type-check.
- `npm --prefix client/test-client run test`: 14 tests passed (config store,
  operation dispatch, error formatting).
- `go test ./...`: all packages passed, including the new
  `internal/appserver` cross-origin preflight and `/files` expose-header
  regression tests.
- Verification server (`~/sf-client-e2e`, chrome-headless-shell 131):
  `npm --prefix client/test-client run e2e` — 1 passed; list, upload, range
  read, cookieless temporary-link redemption, mkdir/move/remove, public
  mode, and no token in any request URL, all from the 5174 origin against
  the 8090 stack.
- `npx openspec validate --all --strict`: 16 items passed, 0 failed.
