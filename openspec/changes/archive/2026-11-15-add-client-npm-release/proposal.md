# Proposal

## Why

`@stratofold/client` is the project's public integration surface, but the
package is still published by hand: `client/README.md` says "Publishing
is not automated" and describes a local `npm publish`. Every release tag
already builds and publishes the server image, so the client package can
drift behind the release it belongs to, and a release depends on whoever
has an npm login on their machine. The package has also not been
published to npm yet (the registry currently returns `404` for it), so
the first release needs a documented bootstrap in addition to the
automated path.

## What Changes

- Add `.github/workflows/release-client.yaml`, triggered by the same
  `v*` version tags as `.github/workflows/release-image.yaml`, running
  independently and in parallel with the image pipeline.
- Require the release tag to equal the version in `client/package.json`
  (tag `v0.2.0` → package `0.2.0`); fail before publishing on a
  mismatch instead of rewriting the version in CI.
- Verify the package before publishing: install from the lockfile, run
  the client unit/IIFE suite, type-check the README snippets, and assert
  the packed tarball contains only `dist/`, `README.md`, and
  `package.json` with no runtime dependencies.
- Publish `@stratofold/client` with `--access public` using npm **trusted
  publishing (OIDC)**, so CI holds no long-lived npm token; provenance is
  generated automatically for this public repository.
- Treat an already-published version as a successful no-op, so a re-run
  of the release workflow cannot fail on an immutable npm version.
- Document the one-time bootstrap and trusted-publisher setup (npm
  requires the package to exist before a trusted publisher can be
  configured) and the 2-day validation window npm applies to a new
  trusted-publisher connection.
- Correct the client README's publishing instructions, including the
  broken `npm --prefix client pack --dry-run` command, which currently
  packs the repository root rather than the package.
- Record the decision as a new ADR and update the affected agent and
  roadmap docs.

## Capabilities

### New Capabilities

- `client-release`: verified, tag-driven publishing of the
  `@stratofold/client` npm package, independent of the server image
  pipeline.

### Modified Capabilities

None. The package's runtime behavior and the existing `client-library`
requirements — including "installable from npm" — do not change; this
change adds the release mechanism that delivers that artifact.

## Impact

- **New**: `.github/workflows/release-client.yaml`.
- **Docs**: `client/README.md` (publishing section), `AGENTS.md`
  (browser-client release pointer), `docs/decisions/0014-client-npm-release.md`
  and the `docs/decisions/README.md` index. ADR 0013's consequence that
  publishing is not automated becomes stale and will point to 0014.
  `docs/roadmap.md` change 11 lists "npm publishing from CI" as out of
  scope and reserves ADR numbers 0014/0015 for unscheduled follow-ons;
  both need a small consistency edit.
- **External setup**: npm scope ownership (`@stratofold`), an existing
  published package, and a trusted-publisher entry on npmjs.com naming
  this repository and `release-client.yaml`. The first publish must be
  bootstrapped manually (or with a temporary token) before OIDC can be
  configured.
- **No** Go, server, SPA, or package runtime/API changes; no new runtime
  dependency; the server image pipeline and its workflow are untouched.

## Non-goals

- Changing the client package's API, build outputs, or runtime behavior.
- Publishing the server image, changing `release-image.yaml`, or making
  the two pipelines depend on each other.
- Automatic version bumps, commit-back, or tag creation.
- npm dist-tags other than `latest`, pre-releases, staged publishing, or
  approval gates.
- Publishing releases from local machines after the one-time bootstrap,
  or from branch pushes, or to any registry other than the public npm
  registry.
- Publishing `client/test-client/`, which is private and
  verification-only.
