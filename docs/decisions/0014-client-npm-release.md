# 0014 — Client releases publish to npm from CI on `v*` tags

Status: Accepted (2026-11, change `add-client-npm-release`)

## Context

ADR 0013 made npm the distribution channel for `@stratofold/client` but
deliberately left publishing as a manual step. In practice that means a
release tag can ship a server image whose client package was never
published, and cutting a release depends on an npm login on one
maintainer's machine. The package is public and not yet on the registry,
and npm's trusted publishing requires the package to exist and a
trusted-publisher entry to name this repository and workflow.

## Decision

- **Release on the existing tag trigger.** A new
  `.github/workflows/release-client.yaml` runs on tags matching `v*`,
  independently of `release-image.yaml`. Branch pushes never publish,
  and neither pipeline can cancel or block the other.
- **The tag and package version are locked together.** The workflow
  derives the version from the tag, requires it to equal
  `client/package.json`'s `version`, and fails before publishing on a
  mismatch. CI never rewrites the committed version.
- **The package is verified before the registry is touched.** The
  workflow installs from the lockfile, runs the package build and unit
  suite, type-checks the README snippets, and runs
  `client/scripts/check-pack.mjs` to assert the tarball contains only
  `dist/`, `README.md`, and `package.json` with no runtime, optional,
  peer, or bundled dependencies.
- **Publishing uses npm trusted publishing (OIDC).** The workflow grants
  `id-token: write` and runs `npm publish --access public` with no
  long-lived npm token. Provenance is generated automatically because
  the repository and package are public.
- **An already-published version is a successful no-op.** The workflow
  checks the registry first and skips the remaining steps when the
  version exists, so a re-run cannot fail on npm's immutable versions.
- **The first publish is a documented bootstrap.** A maintainer
  publishes the first version manually, configures the npm trusted
  publisher for `mode777/stratofold` and `release-client.yaml` with
  direct `npm publish` permission, then validates the configuration
  with a real OIDC publish inside npm's two-day window.

## Consequences

- Every release tag must bump the client version to match, including a
  release that only changes the server. A mismatch fails fast and names
  both versions.
- The image and the package share a release tag but publish
  independently; one pipeline can fail without hiding or blocking the
  other.
- npm scope ownership and the trusted-publisher entry are external,
  durable prerequisites. Losing either blocks releases until it is
  repaired; there is no token-based fallback by design.
- Published versions are immutable. A bad release is fixed with a new
  version and npm deprecation, not by overwriting or deleting history.
- `client/scripts/check-pack.mjs` and the package gates are the release
  contract; changing the package's `files` or dependency metadata means
  updating that check and the release workflow together.
- Manual publishing remains only as the one-time bootstrap. It is not a
  second routine release path.

## Rejected alternatives

- **A long-lived `NPM_TOKEN` repository secret** — simpler first publish,
  but it is a broad write credential to store, rotate, and leak; OIDC
  gives per-run credentials instead.
- **OIDC with a token fallback** — two authentication paths to maintain,
  and the fallback silently removes the no-secret property.
- **A second job in `release-image.yaml`** — couples npm to Docker,
  shares the image pipeline's concurrency and status, and makes a
  client-only failure mark the image release red.
- **Rewrite the package version from the tag in CI** — the tag and the
  committed package would disagree, and every checkout would need the
  same rewrite.
- **Publish whatever version `package.json` declares, independent of the
  tag** — allows server-only releases without a client bump, but a
  `v0.2.0` tag could publish `0.1.0`, so the tag stops identifying the
  package.
- **Publish on branch pushes to `main`** — produces packages for
  unreleased commits and blurs what a release tag means.
