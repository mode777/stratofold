# Tasks

## 1. Embed and serve the SPA

- [x] 1.1 Add `internal/webassets` with `//go:embed all:dist`, a
  committed placeholder `dist/index.html`, and an exported `FS`; verify
  `go build ./...` succeeds with no Node build present.
- [x] 1.2 Implement the SPA handler (GET/HEAD only → `405` otherwise;
  embedded file if present; `index.html` fallback for extensionless
  paths; `404` for reserved `/api/`, `/api/sf/`, `/files/` prefixes and
  missing asset-like paths) and register it in `appserver.Install`'s
  `OnServe` hook after the API routes; verify `go test
  ./internal/appserver/ -run SPA` covers root, asset, fallback, reserved
  404, and method rejection.
- [x] 1.3 Confirm the Vite build output is `web/dist` and the Docker Go
  stage overwrites `internal/webassets/dist` with it; verify `npm --prefix
  web run build` produces `web/dist/index.html`.
- [x] 1.4 Update the deployment section of `docs/architecture.md` to
  describe embedded serving and SPA fallback; verify the text matches the
  implemented behavior and `npx openspec validate --all --strict` passes.

## 2. Container image

- [x] 2.1 Add a multi-stage `Dockerfile` (`web` Node build → `gobuild`
  Go `CGO_ENABLED=0` with the SPA copied in → `runtime` Alpine → `e2e`
  target from `runtime` with the harness binary) and a `.dockerignore`
  excluding `node_modules`, `web/dist`, `pb_data`, and build caches;
  verify the `web` and `gobuild` stages complete in the release workflow
  dry run.
- [x] 2.2 Harden the `runtime` stage: non-root user, `EXPOSE 8090`,
  `VOLUME /pb_data`, only `ca-certificates`/`tzdata` plus the binary;
  verify `docker image inspect` shows the expected user/ports/volumes and
  a started container serves `GET /` and `GET /api/health`.
- [x] 2.3 Add the runtime smoke test step to the release workflow (start
  the `runtime` image, assert the SPA shell at `/` and `200` at
  `/api/health`, create a superuser and assert state persists across a
  container restart with the same volume); verify it passes on the dry
  run.

## 3. Release workflow

- [x] 3.1 Add `.github/workflows/release-image.yaml` triggered only by
  `push` of tags matching `v*` (`permissions: contents: read`), deriving
  the image tag from `${GITHUB_REF_NAME#v}`; verify a branch push does
  not run it and a scratch `v*` tag does.
- [x] 3.2 Add the build-verify-publish sequence: buildx build of the
  `e2e` target (`load: true`), run the container, execute the Playwright
  suite with `SF_E2E_BASE_URL`/`SF_E2E_EXECUTABLE`, then build and push
  the `runtime` target to `harbor.alexklingenbeck.de/my/stratofold` with
  `docker/login-action` using `secrets.HARBOR_ROBOT`/`secrets.HARBOR_TOKEN`;
  verify a failing E2E run publishes nothing and a passing run publishes
  the tag.
- [x] 3.3 Add the image-size gate (documented budget, start at 100 MB
  uncompressed) before the push; verify an oversized image fails the
  workflow and a normal image passes.
- [x] 3.4 Document the required repository secrets and how the Harbor
  robot credentials are obtained from `cloud.alexklingenbeck.de`
  (`robot$docker.json`) in the workflow header and `AGENTS.md`; verify no
  credential value is present in any tracked file.

## 4. Architecture decision and agent guidance

- [x] 4.1 Write `docs/decisions/0006-release-image-publishing.md` from
  `TEMPLATE.md` recording tag-triggered CI-only builds and Harbor
  publishing, with rejected alternatives, and add its row to
  `docs/decisions/README.md`; verify the file and index row exist and
  `npx openspec validate --all --strict` passes.
- [x] 4.2 Update `AGENTS.md` with the build/release workflow (CI-only
  Docker, tag trigger, registry, secrets) and mark roadmap item 9
  implemented; keep it to the image pipeline only (the cluster rollout is
  not documented in this repo); verify the guidance matches the workflow
  and links to ADR 0006.

## 5. Integration verification

- [x] 5.1 Run `go vet ./... && go test ./...` (prepending
  `~/.local/go/bin` to PATH) and confirm the suite is green.
- [x] 5.2 Run `npm --prefix web run test` and confirm component tests
  pass with the embedded-asset changes.
- [x] 5.3 Run `npx openspec validate --all --strict` and confirm the
  change and all specs validate.
- [x] 5.4 On a scratch `v*` tag, run the full release workflow end to
  end and confirm the container E2E passes and
  `harbor.alexklingenbeck.de/my/stratofold:<version>` exists.

## 6. Cluster deployment (cloud.alexklingenbeck.de repo — only after 5.4)

All tasks in this group happen in the `cloud.alexklingenbeck.de` GitOps
repository, are gated on the first image existing in Harbor, and are
operated exclusively through Git commits to `main` (never `kubectl` or
SSH). Nothing from this group is documented in the Stratofold repository.

- [x] 6.1 Add `stratofold/resources.yaml` following the `trackify/`
  reference: namespace `stratofold`, a `harbor-creds` dockerconfigjson
  secret, a Longhorn `ReadWriteOnce` PVC mounted at `/pb_data`, a
  single-replica Deployment (`runAsUser`/`fsGroup` 1000, readiness
  `/api/health`, `imagePullSecrets: harbor-creds`, the imagepolicy marker
  on the image line), a Service, and an Ingress for
  `stratofold.alexklingenbeck.de` (Traefik `websecure`,
  `letsencrypt-prod`); verify the manifests are committed and Flux applies
  them.
- [x] 6.2 Provision a superuser without baking credentials into the
  image (initContainer or one-off job running the binary's `superuser
  upsert` against the shared data volume); verify signing in at
  `https://stratofold.alexklingenbeck.de` works.
- [x] 6.3 Add the `flux-stratofold` Kustomization to
  `my-cluster/cluster-kustomizations.yaml` with `dependsOn` `flux-longhorn`
  and `flux-cluster-issuer`; verify the instance is reachable over HTTPS
  with a valid certificate and that its data survives a pod restart.
- [x] 6.4 Add the `ImageRepository` + `ImagePolicy` for
  `harbor.alexklingenbeck.de/my/stratofold` to
  `image-automation/1_repository_policy.yaml`; verify a subsequently
  published release tag is committed into the Deployment by the image
  automation and rolled out with no manual image edit.
- [x] 6.5 Confirm no Stratofold-side files document the cloud-repo
  deployment: `git status` in the Stratofold repo shows no new manifests
  or docs for it, and the only Stratofold-repo artifacts are the ADR 0006
  and docs updates already scoped in group 4.
