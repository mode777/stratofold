# Proposal

## Why

Stratofold's read and write API already accepts vdir-scoped bearer tokens
(change `add-vdir-access-tokens`), so an integration no longer needs a
session cookie or a server proxy. What is missing is the client: today
every consumer would re-implement the endpoint shapes, the upload
transport, the URL rules, and the error classes. A small, typed,
zero-dependency browser package is the reusable seam the third-party
integration story rides on.

The GitHub Pages test client makes that seam demonstrable and verifiable
from a real foreign origin without shipping the library inside the
Stratofold server. The roadmap originally planned an instance-hosted
`/embed` mirror; that is deliberately dropped — the package will be
published to npm, and a static test client is enough to prove
cross-origin behavior.

## What Changes

- Add `client/`, a new npm package `@stratofold/client`: zero runtime
  dependencies, TypeScript sources, ESM + IIFE builds plus bundled
  declarations.
- Public surface: `list`, `read`, `upload` (progress + abort), `mkdir`,
  `move`, `remove`, `temporaryUrl`, `fileUrl`, `tokenInfo`, plus the
  deterministic error classes (`StratofoldError` with
  `unauthorized`/`forbidden`/`notfound`/`retryable`/`rejected`/`server`,
  and `UploadCanceled`).
- Header-only bearer authentication: the token never appears in a URL.
  Private media uses `temporaryUrl` (minted `/s/<token>` links); public
  mode (no token) reads plain `/files` URLs.
- Add `client/test-client/`, a private frontend-only Vite app that
  exercises every operation against a server supplied at runtime
  (base URL + token in the UI, remembered locally) and exposes public
  mode. It contains no checked-in instance URL or token.
- Add a GitHub Actions Pages workflow that builds and deploys the test
  client to GitHub Pages on `main`; the deployed bundle carries no
  secrets or default instance.
- Document the package and the deployment flow (`client/README.md`, root
  `README.md`), record the distribution decision (ADR 0013), and update
  `AGENTS.md` and the roadmap entry that still describes an
  instance-hosted embed.

No server behavior changes: the bearer surfaces, `/files` CORS
exposure, `/s` links, and `/api/sf/tokens/me` scope discovery already
exist. Any CORS gap surfaced by the cross-origin E2E is fixed inside
this change.

## Capabilities

### New Capabilities

- `client-library`: the typed browser package contract — transport,
  authentication rules, operation mapping, error classes, public mode,
  cross-origin behavior, and the static test client's guarantees.

### Modified Capabilities

None. The server-side bearer, file-server, and file-link requirements
this change consumes are already pinned by `vdir-access-tokens`,
`file-server`, and `file-links`.

## Impact

- New: `client/` package (source, build config, unit tests),
  `client/test-client/` (Vite app + Playwright spec + Pages build),
  `.github/workflows/client-pages.yaml`,
  `docs/decisions/0013-client-distribution.md`.
- Updated: root `README.md` and `package.json` script shims,
  `AGENTS.md`, `docs/roadmap.md` (change 11 no longer instance-hosts),
  `docs/decisions/README.md` index.
- Dependencies: TypeScript, esbuild, Vitest, Vite, and Playwright as
  dev dependencies of the new package/app only; the published package
  has no runtime dependencies.
- Not touched: `internal/*`, the server image, `/embed`, and the
  release-image workflow. `web/` keeps its own private API wrappers.

## Non-goals

- Publishing to npm from CI. The package is made publish-ready
  (`package.json`, exports, `npm pack` check); the actual release is a
  later, explicit step.
- An instance-hosted `/embed/v<major>/stratofold.js` route or any
  server-embedded client bundle.
- React/Vue wrappers, Node-specific upload progress, offline support,
  OAuth/consent flows, and multi-vdir or subpath token scopes.
- Auto-discovering the server URL: the base URL is always explicit.
- Reworking the SPA onto the package (`web/src/lib/filesApi.ts` stays).
