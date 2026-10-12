# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- The server is one Go binary that boots embedded PocketBase via
  `internal/appserver.Install` and registers `/api/sf/*`, `/files/*`, and
  PocketBase's own routes (`cmd/stratofold/main.go:14`).
- The SPA builds to `web/dist` (Vite default) and is currently only used
  by the dev server and Playwright; nothing in the binary serves it.
- No `Dockerfile`, no `.github/workflows`, and no Go `embed` directive
  exist yet.
- ADR 0004 already fixes the target shape: Node stage → Go
  `CGO_ENABLED=0` stage → Alpine runtime, SPA via `go:embed`, one port,
  SQLite volume.
- Docker is unavailable in the dev container and on the build/verification
  server (CLI only, daemon inaccessible), so container verification can
  only run in GitHub Actions.
- The established registry convention in the `cloud.alexklingenbeck.de`
  repo is `harbor.alexklingenbeck.de/my/<app>` with CI secrets
  `HARBOR_ROBOT` / `HARBOR_TOKEN` (see
  `.github/workflows/opencode-image.yaml` there). The Harbor robot
  credentials live in that repo's `robot$docker.json`.
- The `cloud.alexklingenbeck.de` repo is a Flux GitOps repository:
  each app is a top-level directory with a `resources.yaml` (namespace,
  Harbor `harbor-creds` dockerconfigjson, Longhorn PVC, Deployment,
  Service, Ingress), registered by a `flux-<app>` Kustomization in
  `my-cluster/cluster-kustomizations.yaml`, and enrolled in
  `image-automation/1_repository_policy.yaml` with an `ImageRepository`
  + `ImagePolicy` plus a `# {"$imagepolicy": "flux-system:<policy>"}`
  marker on the image line. `trackify/` and `pocketcloud/` are the
  reference apps.

## Goals / Non-Goals

**Goals:**
- A reproducible multi-stage image whose runtime layer contains the
  binary, the embedded SPA, and a minimal OS — nothing else.
- Serving the SPA from the same origin/port as the API without disturbing
  existing route behavior.
- A release pipeline that is the *only* way an image is produced, gated on
  a `v*` tag, verified against the built image, then pushed to Harbor.
- Deploy the published image to the cluster (in the separate GitOps repo)
  with automatic rollout of later tags, so the instance is testable
  directly.

**Non-Goals:**
- Cluster rollout **manifests in this repository** (they live in
  `cloud.alexklingenbeck.de`) and any documentation of that repo here.
- Multi-arch images, image signing/provenance, or a local build script.
- Seeding a demo dataset in the production binary.

## Decisions

### D1 — Embed the SPA from a dedicated package with a committed placeholder

`go:embed` cannot reach outside the package directory, and `go build ./...`
/ `go vet ./...` must stay green in the dev container where Node may not
have run. Decision: add `internal/webassets` with
`//go:embed all:dist` and a committed minimal `dist/index.html`
placeholder. The Docker/CI build overwrites `internal/webassets/dist`
with the real Vite output before compiling Go. `appserver` imports
`webassets.FS`.

- *Alternative — embed directive inside `web/`*: `web/` is a Node
  workspace; adding a Go package there mixes toolchains and still needs a
  placeholder.
- *Alternative — build tag for embedded assets*: two code paths (with and
  without assets) is more surface for no benefit here.

### D2 — Serve the SPA with an explicit catch-all after all API routes

Register one catch-all handler on the PocketBase router inside the
existing `OnServe` hook, after the `/api/sf/*`, `/files/*`, and
`/api/*` handlers, so those routes always win. The handler:

1. Rejects non-`GET`/`HEAD` with `405`.
2. Serves a file from the embedded FS when the cleaned path maps to one.
3. Otherwise, for extensionless paths, serves `index.html` (SPA fallback).
4. Returns `404` for reserved prefixes (`/api/`, `/api/sf/`, `/files/`)
   and for missing paths that look like assets (have a file extension), so
   a missing JS/CSS file never returns an HTML shell.

- *Alternative — wrap `se.Server.Handler` in a custom mux*: bypasses
  PocketBase's router precedence and risks shadowing built-ins; the
  catch-all keeps the existing router authoritative.
- *Alternative — serve from `pb_public`*: contradicts ADR 0004 and adds a
  runtime file dependency.

### D3 — Multi-stage Dockerfile with a shared build and two runtime targets

Stages:

- `web`: Node (LTS alpine) + `npm ci` in `web/` → `web/dist`.
- `gobuild`: Go (matching `go.mod`) with the `web/dist` copied to
  `internal/webassets/dist`, `CGO_ENABLED=0`, builds both
  `./cmd/stratofold` and `./cmd/stratofold-e2e`.
- `runtime`: `alpine` + `ca-certificates` + `tzdata`, non-root user,
  `EXPOSE 8090`, `VOLUME /pb_data`, `ENTRYPOINT ["/stratofold"]`.
- `e2e`: `FROM runtime`, copies `stratofold-e2e`, used only for
  verification; the in-proc SSH fixture and seeded dataset live in that
  binary.

- *Alternative — a single target with the harness in the production
  binary*: would link `internal/testssh` into production; rejected.
- *Alternative — separate images for verify and publish*: they already
  differ only by entrypoint; both derive from the same `web`/`gobuild`
  layers, and the workflow additionally smoke-tests the published
  `runtime` image (start it, `GET /`, `GET /api/health`).

### D4 — Build once, verify, then push the exact image

The workflow builds the `e2e` target with buildx (`load: true`), runs the
container, executes the Playwright suite against it
(`SF_E2E_BASE_URL`, `SF_E2E_EXECUTABLE` = chrome-headless-shell), and only
on success builds/loads the `runtime` target and pushes it. This keeps
"verified" and "published" as close as possible while covering the
runtime base via the smoke test.

### D5 — Tag-triggered release workflow, version derived from the tag

`on: push: tags: ['v*']`. Version = `${GITHUB_REF_NAME#v}`; image tags
`harbor.alexklingenbeck.de/my/stratofold:${VERSION}` and `:latest`.
`permissions: contents: read`; credentials from `secrets.HARBOR_ROBOT` /
`secrets.HARBOR_TOKEN` via `docker/login-action`. `platforms: linux/amd64`,
`cache-from/to: type=gha`.

- *Alternative — `on: release: published`*: the user chose tag pushes;
  a bare `v*` tag is the release trigger.

### D6 — Size budget as a CI gate

After building the `runtime` image, compare `docker image inspect` size
against a documented budget (start at 100 MB uncompressed, tunable) and
fail before push on breach. The Alpine runtime is expected well under
this.

### D7 — Graceful shutdown relies on PocketBase, verified not reimplemented

`apis.Serve` already binds an `OnTerminate` hook that calls
`server.Shutdown` with a short timeout. Decision: do not add a second
signal handler; verify behavior with a test that issues SIGTERM while a
request is in flight.

### D8 — Deploy through the cloud repo's GitOps conventions, after the first publish

The cluster rollout is a separate, later step that runs **after** the
first image is confirmed in Harbor. It follows the existing
`cloud.alexklingenbeck.de` patterns rather than inventing new ones:

- `stratofold/resources.yaml`: namespace `stratofold`; a
  `harbor-creds` dockerconfigjson secret; a Longhorn
  `ReadWriteOnce` PVC mounted at the container's PocketBase data
  directory (`/pb_data`); a single-replica `Deployment` (`runAsUser`/
  `fsGroup` 1000, readiness on `/api/health`, `imagePullSecrets:
  harbor-creds`); a `Service`; and an `Ingress` for
  `stratofold.alexklingenbeck.de` using the Traefik `websecure`
  entrypoint and the `letsencrypt-prod` cluster issuer.
- A `flux-stratofold` Kustomization in
  `my-cluster/cluster-kustomizations.yaml` with `dependsOn`
  `flux-longhorn` and `flux-cluster-issuer` (the same dependencies as
  `trackify`/`pocketcloud`).
- The instance needs a superuser before it is usable; provision it with
  an `initContainer` (or one-off job) running the binary's built-in
  `superuser upsert`, writing to the shared data volume, rather than
  baking credentials into the image.

The cluster is operated exclusively through GitOps (per that repo's
`AGENTS.md`): commit to `main`, let Flux reconcile — never `kubectl`/SSH
into the node.

- *Alternative — document the rollout in this repo*: rejected per the
  addendum; the manifests and their rationale belong with the cluster
  repo's other apps.
- *Alternative — deploy before the first image exists*: rejected; the
  manifests would reference a non-existent tag and crash-loop.

### D9 — Enroll the image in Flux image automation for forward-only rollouts

Add an `ImageRepository` for `harbor.alexklingenbeck.de/my/stratofold`
and an `ImagePolicy` (semver `>=0.0.0-0`, matching the other apps) to
`image-automation/1_repository_policy.yaml`, and put the
`# {"$imagepolicy": "flux-system:stratofold"}` marker on the Deployment's
image line. The existing `ImageUpdateAutomation` then commits tag bumps
to `main` and Flux rolls them out — no manual image edit.

- *Alternative — pin tags manually*: loses the point of automatic
  rollout and was explicitly requested against.
- *Note*: automation only moves tags forward; rollback is a revert of the
  automation commit, not pushing an older tag.

## Risks / Trade-offs

- **Placeholder assets drift from the real build if someone runs `go run`
  without building the SPA** → the placeholder is obviously a stub
  (`index.html` saying "build the SPA"); dev uses Vite, CI always
  overwrites; a test asserts the embed compiles and serves the
  placeholder.
- **Container E2E exercises the `e2e` target, not the published
  entrypoint** → both share the same base and embedded assets; the
  workflow smoke-tests the `runtime` image (start, `/`, `/api/health`)
  before push.
- **Catch-all route precedence could shadow a future PocketBase route** →
  handler returns `404` for reserved prefixes and only falls back for
  extensionless paths; a route-collision test asserts `/api/*` still 404s
  as API (not HTML).
- **CI-only Docker means no local reproduction** → the workflow is
  `workflow_dispatch`-able against a tag, and the Dockerfile stages are
  plain enough to build anywhere Docker exists.
- **Secrets handling** → robot credentials are only referenced as
  `secrets.*`; no credential value is written to any file in this repo.
- **Deploying before an image exists would crash-loop the pod** → the
  Flux work is sequenced after the first image is confirmed in Harbor.
- **Image automation is forward-only** → rollback is reverting the
  automation commit; this matches the cluster repo's existing gotcha and
  is documented there, not here.

## Migration Plan

1. Land the embed package + serving + tests (local `go test` stays green).
2. Land the Dockerfile and `.dockerignore`.
3. Land the workflow; validate with `workflow_dispatch` on a scratch tag
   before the first real release.
4. Cut the first release tag (`v0.1.0`); confirm the image lands in
   Harbor and the runtime smoke test passes.
5. **Only after step 4 succeeds**, add the `stratofold/` app, the
   `flux-stratofold` Kustomization, and the image-automation enrollment
   in the `cloud.alexklingenbeck.de` repo; confirm
   `https://stratofold.alexklingenbeck.de` serves the SPA over a valid
   certificate and that a later tag rolls out automatically.
6. Rollback: the pipeline publishes new tags only; a bad release is
   superseded by a new tag, and the previous image remains in Harbor.

## Open Questions

- Exact size budget value (100 MB is a starting point; tighten once the
  first image is measured).
- Whether to also emit build-provenance/SBOM attestations (deferred; no
  requirement yet).
