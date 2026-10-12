# Proposal

## Why

The SPA is built and run separately from the server: `web/dist` is only
served in development (Vite dev server) and nothing produces a shippable
artifact. ADR 0004 already committed Stratofold to a single Docker image
with the SPA embedded via `go:embed`, but the packaging step was
deferred. Completing it now turns the working API + SPA into one
deployable artifact and retires the last roadmap item.

## What Changes

- Embed the Vite production build (`web/dist`) into the server binary
  with `go:embed` and serve it from the same HTTP port as `/api` and
  `/files` (static assets, `index.html` for the SPA shell, and an SPA
  fallback for client-side routes) without shadowing PocketBase or the
  custom `/api/sf/*` and `/files/*` routes.
- Add a multi-stage `Dockerfile` (Node build stage → Go `CGO_ENABLED=0`
  build stage → minimal runtime) producing one image with one port and
  SQLite on a mounted volume.
- Add a GitHub Actions workflow that runs **only** when a release tag
  matching `v*` is pushed. It builds `linux/amd64`, runs the container
  E2E suite against the built image, and pushes the tagged image to
  `harbor.alexklingenbeck.de/my/stratofold`. Docker builds happen
  exclusively in CI; no local build script is added.
- Document the release flow: GitHub repo secrets `HARBOR_ROBOT` /
  `HARBOR_TOKEN` hold the Harbor robot credentials (the robot account in
  `cloud.alexklingenbeck.de`'s `robot$docker.json`); the pushed image
  tag is derived from the release tag.
- **After the first image is published to Harbor**, add Flux GitOps
  configuration in the `cloud.alexklingenbeck.de` repository — a
  `stratofold/` app directory (namespace, Harbor pull secret, Longhorn
  PVC for SQLite, Deployment, Service, Ingress for
  `stratofold.alexklingenbeck.de`) plus a `flux-stratofold` Kustomization
  — so the deployed instance can be tested directly.
- Enroll `harbor.alexklingenbeck.de/my/stratofold` in Flux image
  automation (`ImageRepository` + `ImagePolicy` + the imagepolicy marker
  on the Deployment) so newly published release tags roll out
  automatically.
- New ADR `docs/decisions/0006-release-image-publishing.md` recording
  tag-triggered CI publishing to Harbor; update
  `docs/decisions/README.md`, `docs/architecture.md`, and `AGENTS.md`.
  The cluster rollout gets **no ADR and no documentation in this
  repository** — its manifests and rationale live in
  `cloud.alexklingenbeck.de`.

## Capabilities

### New Capabilities

- `deployment`: the single-image build/run contract (embedded SPA
  served by the binary, one port, SQLite volume), the release pipeline
  that builds, verifies, and publishes that image from a release tag,
  and the GitOps rollout of the published image to the cluster with
  automatic tag updates.

### Modified Capabilities

- (none — no existing requirement changes; the SPA serving behavior is
  new, not a change to `web-ui` requirements.)

## Impact

- **Code**: `cmd/stratofold/main.go` and `internal/appserver` (embed +
  static/SPA serving), `web/vite.config.ts` build output, new
  `Dockerfile` and `.dockerignore`.
- **CI**: new `.github/workflows/release-image.yaml` (tag-triggered);
  GitHub repo secrets `HARBOR_ROBOT`/`HARBOR_TOKEN`.
- **Docs**: new ADR 0006 + index, `docs/architecture.md` deployment
  section, `AGENTS.md` run/release guidance, roadmap item 9 marked done.
- **Systems**: Harbor registry `harbor.alexklingenbeck.de/my/stratofold`;
  the `cloud.alexklingenbeck.de` GitOps repo gains a `stratofold/` app and
  image-automation enrollment (after the first publish).

## Non-goals

- Multi-arch images (only `linux/amd64`), TLS termination (external
  reverse proxy), and horizontal scaling (single-node SQLite) remain out
  of scope.
- No local Docker build/publish path and no `pb_public` static-file
  serving: the binary embeds the SPA.
- No cluster manifests in **this** repository — the Flux deployment lives
  in `cloud.alexklingenbeck.de` and is deliberately not documented here.
