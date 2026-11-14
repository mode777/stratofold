# 0013 — Client distribution: npm package, no instance-hosted embed

Status: Accepted (2026-11, change `add-client-library`)

## Context

The vdir-scoped bearer tokens from ADR 0012 give third-party code a
credential, but not a client: every integration would re-implement the
endpoint shapes, upload transport, URL rules, and error classes. The
roadmap originally paired the client library with an instance-hosted
`/embed/v<major>/stratofold.js` route, mirroring the npm package on every
Stratofold deployment.

The product is early-stage and the package will be released to npm. An
instance-hosted mirror adds a second delivery channel that must be kept
in version lockstep with the binary, and it tests a bundling path
consumers do not use. What the cross-origin integration path actually
needs is a real foreign-origin consumer for verification, not a product
feature shipped by the server.

## Decision

- **npm is the source of truth.** `@stratofold/client` lives in
  `client/`, publishes an ESM build, an IIFE build exposing the
  `Stratofold` global, and type declarations, and has no runtime
  dependencies. Consumers install it from npm or a CDN that mirrors npm.
- **No instance-hosted client.** The server binary does not embed the
  package and serves no `/embed` route. Adding one later requires a new
  decision, not an implementation detail.
- **The test client is verification-only.** `client/test-client/` is a
  frontend-only static app deployed to GitHub Pages by
  `.github/workflows/client-pages.yaml`. It takes the server URL and
  token at runtime, contains no default instance or secret, and exists
  to exercise the package from a second origin and to serve as a manual
  test harness. It is not a supported end-user product surface.
- **The server API stays unchanged.** The package consumes the existing
  bearer, `/files`, `/s`, and `/api/sf/tokens/me` surfaces. Cross-origin
  access relies on PocketBase's global CORS plus the `/files` exposure
  header; a regression test pins it.

## Consequences

- There is one place to fix the client: `client/src/`. Server releases
  and package releases are decoupled.
- The package API is public once published: breaking changes need a
  major version. The SPA keeps its own cookie-oriented wrappers in
  `web/src/lib/filesApi.ts`; migrating them onto the package is a
  separate decision.
- Distribution needs npm-scope ownership (`@stratofold`) and a publish
  step. Publishing is automated on `v*` tags by
  `.github/workflows/release-client.yaml`; see ADR 0014.
- The Pages site is public, so it can never carry a token or a default
  instance URL. Builds refuse to run when `VITE_SF_*` values are set,
  and CI scans the bundle.
- A future instance-hosted mirror would be a second, additive decision;
  nothing in the current package layout blocks it.

## Rejected alternatives

- **Instance-hosted `/embed` mirror (the original roadmap plan)** — two
  delivery channels to version and verify, and it exercises a bundling
  path the npm consumer does not use.
- **A central `cdn.stratofold.app`** — an extra service to run and a
  permanent compatibility commitment for a project that can use npm's
  own CDN mirrors.
- **Migrating the SPA onto the package in the same change** — the SPA is
  cookie- and relative-URL-oriented; coupling that migration to the
  first package release doubles the risk and hides cross-origin
  regressions.
- **Shipping a demo token in the Pages build** — any token in a public
  static bundle is public; the only available token is a real one.
