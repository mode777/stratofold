# Design

## Context

- `.github/workflows/release-image.yaml` already triggers on `v*` tags
  and is the project's release convention (ADR 0006). The new client
  workflow follows that trigger rather than inventing a second release
  ceremony.
- `client/package.json` declares `@stratofold/client@0.1.0`, `files:
  ["dist"]`, a `prepack` build, and no runtime dependencies. The package
  does not exist on npm yet (the registry returns `404`), and the repo is
  public.
- npm trusted publishing requires npm CLI 11.5.1+ and Node 22.14+, a
  GitHub-hosted runner, an `id-token: write` permission, and a
  trusted-publisher entry on npmjs.com naming the repository and the
  exact workflow filename. The package must already exist before that
  entry can be configured.
- `npm --prefix client pack --dry-run` (the command currently documented
  in `client/README.md`) packs the repository root, not the package;
  `npm pack` resolves the package from the working directory. Run from
  `client/`, the tarball contains only `dist/`, `README.md`, and
  `package.json`.
- `client/package.json` has `repository.directory: "client"` and a
  repository URL that matches `github.com/mode777/stratofold`, which
  trusted publishing/provenance requires.
- The existing `client-pages.yaml` already tests the package and
  type-checks the README on `main`; the release workflow re-runs the
  package checks so a tag cannot publish an unverified build.

## Goals / Non-Goals

**Goals:**

- Publish the client package on the same version tag as the server, with
  no secret to store or rotate.
- Make a re-run safe and make a tag/package-version mismatch fail loudly
  before the registry is touched.
- Keep the release pipeline and the image pipeline independent.
- Leave a documented operator path for the first publish, when OIDC
  cannot yet be configured.

**Non-Goals:**

- Changing package contents, build outputs, or the client API.
- Building or publishing the server image from the client workflow.
- Automating version bumps, changelogs, Git tags, or release notes.
- Dist-tags beyond `latest`, pre-releases, staged publishing, or an
  approval environment.

## Decisions

### Separate workflow from the image pipeline

Use a new `.github/workflows/release-client.yaml` with the same
`on: push: tags: ["v*"]` trigger (plus `workflow_dispatch` for re-runs),
rather than another job in `release-image.yaml`.

- A separate workflow gives the package its own check status, its own
  concurrency group, and failure isolation: an npm outage cannot cancel
  or block the image release, and vice versa.
- It also matches trusted publishing: npm binds a trusted publisher to
  one workflow filename, so a dedicated file is the natural unit.
- **Alternative: a second job in `release-image.yaml`** — one run and
  one status, but the two releases would share concurrency, and a
  client-only failure would mark the image release red (or vice versa).
- **Alternative: publish inside the `e2e`/`runtime` job** — couples npm
  to Docker and delays the package behind the slowest verification step
  for no benefit.

### Require the tag to equal the package version

Derive `VERSION=${GITHUB_REF_NAME#v}` and read the version from
`client/package.json`; fail if they differ. Do not run `npm version` in
CI.

- The tag then identifies exactly what is on npm, and the repo stays the
  source of truth.
- **Alternative: rewrite the version from the tag** — the tag and the
  committed package would disagree, and the next checkout would need
  another rewrite; rejected by the user's chosen policy.
- **Alternative: publish whatever version `package.json` declares,
  skipping if already published** — allows server-only releases without
  a client bump, but a `v0.2.0` tag could publish `0.1.0`; rejected
  because the tag would stop identifying the package version.
- Consequence: a server-only release still bumps the client version. If
  that is undesirable later, revisit with a dedicated client tag scheme,
  not by silently rewriting versions.

### Verify before touching the registry

Run, in `client/`: `npm ci`, `npm test` (build + unit/IIFE smoke),
`npm run typecheck:readme`, then `node scripts/check-pack.mjs`. That
script invokes `npm pack --dry-run --json`, asserts the entry list
contains only `dist/**`, `README.md`, and `package.json`, and asserts the
package declares no runtime, optional, peer, or bundled dependencies.
Publish only after all checks pass.

- A small script keeps the local command and the CI gate identical and
  avoids a fragile inline JSON assertion in YAML; the package already
  uses `scripts/check-readme.mjs` for the same reason.
- This reuses the package's own gates and pins the tarball shape, so a
  broken `files`/`prepack` change cannot leak source or omit `dist`.
- **Alternative: rely on `client-pages.yaml` on `main`** — tags can point
  at commits whose checks were never run or have since regressed; the
  release should verify the exact tagged tree.
- **Alternative: include the test-client unit suite** — it duplicates an
  existing Pages gate and couples the package release to an unrelated
  verification app; excluded from this workflow.

### Use npm trusted publishing (OIDC), with an early duplicate check

Set `permissions: id-token: write` and `contents: read`, use a
GitHub-hosted `ubuntu-latest` runner, Node 24 (npm 11.5.1+), and publish
with `npm publish --access public` from `client/`. Do not configure
`NODE_AUTH_TOKEN` or store an `NPM_TOKEN` secret.

- Every publish uses a short-lived, workflow-specific credential; there
  is no long-lived token to leak or rotate. Provenance is generated
  automatically for this public repository.
- The release job does not enable dependency caching, matching npm's
  trusted-publishing guidance for release builds.
- After the version check, query the registry (`npm view
  "@stratofold/client@$VERSION" version`). If it resolves, report
  success and skip the remaining steps; if it fails (including the
  package not existing yet), continue. `npm publish` remains the
  authoritative guard against a race or a stale check.
- Check **before** the install/test steps so a re-run of an
  already-published version succeeds even if the current CI is flaky;
  nothing is published on that path, so verification adds no value.
- **Alternative: an `NPM_TOKEN` repository secret** — simpler, but a
  long-lived write credential with broader access and rotation overhead;
  rejected by the user.
- **Alternative: OIDC with a token fallback** — two authentication paths
  to test and reason about, and the fallback silently defeats the
  no-secret property; rejected.
- The workflow asserts `npm --version` is at least 11.5.1 so a runner
  image regression fails with a clear message rather than an opaque
  authentication error.
- The workflow also asserts that `repository.url` in `client/package.json`
  still normalizes to `https://github.com/${GITHUB_REPOSITORY}`, because
  trusted publishing requires that match.

### Keep the first publish a documented bootstrap

The package cannot be published by OIDC until it exists and a trusted
publisher is configured. Document this sequence:

1. From a maintainer machine, `npm login`, bump/confirm the version, and
   run `npm publish --access public` in `client/` for the bootstrap
   version.
2. On npmjs.com, add a trusted publisher for `@stratofold/client`:
   organization/user `mode777`, repository `stratofold`, workflow
   filename `release-client.yaml`, and explicitly allow direct
   `npm publish` (new entries default to staged publishing only).
3. Validate the configuration with a real OIDC publish within npm's
   two-day window (a new version and `v*` tag). If the window lapses,
   delete and recreate the trusted-publisher entry.

The workflow itself never falls back to a token. The README documents
that the bootstrap is a one-time operation, not a second release path.

### Record the durable decision

Add `docs/decisions/0014-client-npm-release.md` and index it. It covers
the tag lockstep, the OIDC-only rule, the separate workflow, and the
bootstrap. Amend ADR 0013's now-stale consequence that publishing is not
automated, and update the roadmap's provisional ADR numbers for its
unscheduled follow-ons (0014/0015 become 0015/0016) so the index stays
coherent.

## Risks / Trade-offs

- **Trusted-publisher misconfiguration (wrong repo/workflow name, or
  staged-only permission) →** `npm publish` fails with an
  authentication/permission error. Mitigation: the workflow filename is
  fixed and documented, the setup checklist names the direct-publish
  permission, and the bootstrap validation is a real publish, not a dry
  run.
- **The two-day trusted-publisher validation window lapses before the
  first OIDC release →** re-create the entry. Mitigation: documented in
  the release runbook; no code change needed.
- **Server-only releases must bump the client version or fail →**
  accepted trade-off of the chosen tag lockstep. The failure happens
  before publishing and names both versions.
- **A registry read fails transiently and the workflow proceeds →**
  `npm publish` still refuses to overwrite an existing version; a
  network failure fails the workflow. No corrupted state.
- **Node/npm drift on the runner →** an explicit `npm --version` guard
  fails fast; Node 24 is pinned via `setup-node`.
- **Provenance is unavailable if the repository becomes private →**
  npm documents that limitation; the repository is public today, and
  the release still publishes without provenance in that hypothetical.
- **Publishing immutable versions means a bad release cannot be
  undone →** verification runs on the exact tag before publish; rollback
  is a deprecation and a fixed follow-up version.

## Migration Plan

1. Merge the workflow and docs; no runtime or package-content change.
2. Perform the documented bootstrap publish and configure the trusted
   publisher.
3. Push the next `v*` tag (with the client version bumped to match) and
   confirm the workflow publishes through OIDC and the package page
   shows provenance.
4. If the release path must be disabled, remove/disable the workflow and
   delete the trusted-publisher entry; published versions remain on npm.
