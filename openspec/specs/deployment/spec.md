# deployment Specification

## Purpose

The deployment contract for Stratofold: one self-contained server image
that embeds and serves the SPA, and a release pipeline that builds,
verifies, and publishes that image from a version tag.

## Requirements

### Requirement: The SPA is embedded and served by the server binary

The server binary SHALL embed the production SPA build and serve it on
the same HTTP listener as the API, with no separate static host and no
externally mounted asset directory.

#### Scenario: SPA shell is served at the site root

- **WHEN** a browser requests `/` from a running release image
- **THEN** the SPA shell (the built `index.html`) is returned with `200`

#### Scenario: Built assets are served

- **WHEN** the SPA requests a built asset path (for example a hashed JS or CSS file referenced by the shell)
- **THEN** the asset is returned with `200` and a content type matching its extension

#### Scenario: Client-side routes fall back to the SPA shell

- **WHEN** a browser requests an application route that is not a real file (for example `/vdirs/abc/browse`)
- **THEN** the SPA shell is returned with `200` so the client router can handle it

#### Scenario: SPA serving does not shadow server routes

- **WHEN** a request targets a PocketBase or custom server route (`/api/*`, `/api/sf/*`, `/files/*`)
- **THEN** it is handled by that route's own handler and never by the SPA fallback

### Requirement: One image, one process, one persistent data directory

The release image SHALL run the server as a single process on one
configurable HTTP port, and SHALL keep all persistent state in a SQLite
database inside one data directory intended to be mounted as a volume.

#### Scenario: State is created in the data directory

- **WHEN** the container starts with an empty mounted data directory
- **THEN** the server creates its database there and serves normally

#### Scenario: State survives a container restart

- **WHEN** the container is stopped and started again with the same mounted data directory
- **THEN** previously created users and virtual directories are still present

### Requirement: A release tag is the only trigger that builds and publishes the image

The image build and publish SHALL run exclusively in CI and SHALL be
triggered only by pushing a version tag matching `v*`; ordinary branch
pushes SHALL NOT build or publish an image.

#### Scenario: Version tag triggers the pipeline

- **WHEN** a tag such as `v0.2.0` is pushed
- **THEN** the image pipeline runs

#### Scenario: Branch push does not trigger the pipeline

- **WHEN** a commit is pushed to a branch such as `main`
- **THEN** no image is built or published

#### Scenario: The image tag derives from the release tag

- **WHEN** the pipeline runs for release tag `v0.2.0`
- **THEN** the published image is tagged `0.2.0`

### Requirement: The image is verified before it is published

The pipeline SHALL run the end-to-end browser suite against the built
container image and SHALL publish the image only if that verification
passes.

#### Scenario: Verification passes and the image is published

- **WHEN** the end-to-end suite succeeds against the built image
- **THEN** the image is pushed to the registry

#### Scenario: Verification fails and nothing is published

- **WHEN** the end-to-end suite fails against the built image
- **THEN** the pipeline fails and no image is pushed

### Requirement: The image is published to the project registry

A verified image SHALL be pushed to `harbor.alexklingenbeck.de` under
the project's repository, authenticating with robot credentials supplied
to CI as secrets and never committed to the repository.

#### Scenario: Verified image lands in the registry

- **WHEN** the pipeline publishes a verified image for release tag `v0.2.0`
- **THEN** `harbor.alexklingenbeck.de/my/stratofold:0.2.0` exists

#### Scenario: Credentials come from CI secrets

- **WHEN** the pipeline authenticates to the registry
- **THEN** it reads the robot account name and secret from repository secrets and no credential value appears in the repository

### Requirement: The server shuts down gracefully

On receiving a termination signal the server SHALL stop accepting new
connections and drain or cleanly fail in-flight requests before exiting.

#### Scenario: In-flight requests are handled on shutdown

- **WHEN** the container is asked to stop while a request is in flight
- **THEN** the in-flight request is allowed to finish or fails cleanly rather than being silently truncated

### Requirement: The release image stays within its size budget

The published image SHALL stay within a documented size budget, checked
in CI so that a regression fails the pipeline.

#### Scenario: Oversized image fails the pipeline

- **WHEN** the built image exceeds the documented size budget
- **THEN** the pipeline reports the breach and fails before publishing

### Requirement: The published image is deployed to the cluster

Once the first release image is published, Stratofold SHALL be deployed
to the cluster as a GitOps-managed workload reachable over HTTPS at
`stratofold.alexklingenbeck.de`, with its SQLite database on a
persistent volume.

#### Scenario: Deployment reconciles from Git

- **WHEN** the deployment manifests are merged to the GitOps repository's main branch
- **THEN** the cluster reconciles them without any manual cluster change

#### Scenario: The instance is reachable over HTTPS

- **WHEN** a browser requests `https://stratofold.alexklingenbeck.de`
- **THEN** the SPA is served over TLS with a valid certificate for that host

#### Scenario: Data survives a pod restart

- **WHEN** the deployed pod is restarted or rescheduled
- **THEN** previously created users and virtual directories are still present

### Requirement: Published release tags roll out automatically

The deployed workload SHALL be enrolled in image automation so that a
newly published release tag is written into the deployment manifest and
rolled out without a manual image edit, and the deployed tag only moves
forward.

#### Scenario: A new release tag rolls out

- **WHEN** a newer image tag is published to the registry
- **THEN** the deployment manifest is updated to that tag automatically and the new image is rolled out

#### Scenario: No manual image edit is required

- **WHEN** a new release is published
- **THEN** no human edit to the deployment's image field is needed for it to run
