# 0006 — Release images build in CI on `v*` tags and publish to Harbor

Status: Accepted (2026-10)

## Context

ADR 0004 fixes the artifact as a single Docker image with the SPA embedded
via `go:embed`, but the image must be built somewhere and the build/run
environment has no usable Docker daemon (the dev container and the
verification server have the CLI only). The release process therefore has
to live in CI, and the published image needs a registry and a predictable
version. Process record: change `add-docker-packaging`.

## Decision

Docker builds happen **only** in GitHub Actions. The image is built,
verified, and published by `.github/workflows/release-image.yaml`, which
runs only on a push of a version tag matching `v*`; ordinary branch pushes
never build or publish. The image tag is the release tag without its
leading `v` (release `v0.2.0` → image `0.2.0`). The pipeline builds the
`e2e` target, runs the browser E2E suite against the running container,
smoke-tests the `runtime` image, enforces an image-size budget, and only
then pushes the `runtime` image to
`harbor.alexklingenbeck.de/my/stratofold` (`:<version>` and `:latest`),
authenticating with the `HARBOR_ROBOT` / `HARBOR_TOKEN` repository
secrets. There is no local build or publish script.

## Consequences

- Releases are a tag push; no one needs a Docker daemon to cut one.
- The verified image and the published image share the same build layers;
  a failed E2E or an over-budget image never reaches the registry.
- The registry path, tag derivation, and secret names become the stable
  interface for the cluster rollout, which lives in the separate
  `cloud.alexklingenbeck.de` GitOps repository (not documented here).
- Accepted cost: frontend changes always produce a backend release, and
  every release pays the CI container-build cost.

## Rejected alternatives

- **Build on push to `main`** (as some sibling repos do): produces an
  image for every commit and blurs what "released" means; the request
  was a release-tag trigger.
- **`on: release: published`**: a GitHub Release is a heavier ceremony
  than the bare `v*` tag the request described; a tag is enough.
- **Multi-arch builds**: the cluster is `linux/amd64`; extra platforms
  add CI time with no consumer.
- **A local `publish.sh` fallback**: the environment cannot run Docker,
  and a second, untested build path invites drift from the CI image.
