# Spec Delta

## Purpose

Deliver `@stratofold/client` to the public npm registry from the same
version tags that release the server, with verification, no long-lived
publish credential, and no coupling to the image pipeline.

## ADDED Requirements

### Requirement: A version tag triggers an independent client release

Pushing a tag matching `v*` SHALL run the client publish workflow. The
workflow SHALL be independent of the server image workflow, so neither
can cancel or block the other, and ordinary branch pushes SHALL NOT
publish the package.

#### Scenario: A version tag starts the release

- **WHEN** a tag such as `v0.2.0` is pushed
- **THEN** the client publish workflow runs

#### Scenario: A branch push does not publish

- **WHEN** a commit is pushed to a branch such as `main` without a `v*` tag
- **THEN** no client release workflow runs and nothing is published

#### Scenario: The two release pipelines are independent

- **WHEN** the image pipeline fails for a release tag
- **THEN** the client workflow still runs to completion on its own, and a
  client failure does not cancel the image pipeline

#### Scenario: A manual run needs a tag

- **WHEN** the client workflow is dispatched manually on a branch ref
- **THEN** it fails before publishing

### Requirement: The release tag must equal the package version

The workflow SHALL derive the release version from the tag by removing
the leading `v` and SHALL require it to equal the `version` in
`client/package.json`. It SHALL fail before publishing on a mismatch and
SHALL NOT rewrite the package version from the tag.

#### Scenario: Matching versions publish

- **WHEN** tag `v0.2.0` is pushed and `client/package.json` declares `0.2.0`
- **THEN** the workflow publishes `@stratofold/client@0.2.0`

#### Scenario: A mismatch fails before publishing

- **WHEN** tag `v0.2.0` is pushed but `client/package.json` declares `0.1.0`
- **THEN** the workflow fails before contacting the registry to publish and reports the mismatch

#### Scenario: The package version is not rewritten

- **WHEN** the workflow runs for a release tag
- **THEN** the version in `client/package.json` is used as-is, and CI does not commit or generate a different version

### Requirement: The package is verified before it is published

Before publishing a version, the workflow SHALL install the client
package from its lockfile, run its build and unit suite, type-check the
README snippets, and verify the packed tarball contains only `dist/`,
`README.md`, and `package.json` with no runtime dependencies. It SHALL
publish only if every check passes.

#### Scenario: Verification passes and the package is published

- **WHEN** the package builds, its tests pass, the README snippets type-check, and the tarball manifest is correct
- **THEN** the workflow publishes the package

#### Scenario: A failing test blocks the publish

- **WHEN** the build, the unit suite, or the README type-check fails
- **THEN** the workflow fails and no package is published

#### Scenario: Unexpected tarball contents block the publish

- **WHEN** the packed tarball includes a file outside `dist/`, `README.md`, or `package.json`, or declares a runtime dependency
- **THEN** the workflow fails and no package is published

### Requirement: Publishing uses trusted publishing and public access

The workflow SHALL authenticate with npm trusted publishing over OIDC,
SHALL publish the package publicly, and SHALL NOT require a long-lived
npm publish token. Publishing from this public repository SHALL produce
an npm provenance statement.

#### Scenario: OIDC authenticates the publish

- **WHEN** the workflow publishes from a repository configured as a trusted publisher for this package and workflow
- **THEN** npm accepts the publish without an `NPM_TOKEN` secret

#### Scenario: The package is public

- **WHEN** a release publishes
- **THEN** the package is publicly installable without an npm account or access grant

#### Scenario: Provenance is attached

- **WHEN** a release publishes from this public repository through trusted publishing
- **THEN** the npm package version carries a provenance statement

### Requirement: An already-published version is not republished

The workflow SHALL check the registry before publishing. If the release
version already exists, it SHALL skip the publish and report success
without attempting to overwrite the immutable version.

#### Scenario: A re-run does not fail on an existing version

- **WHEN** the workflow runs again for a version that is already published
- **THEN** it skips publishing, reports success, and leaves the existing version unchanged

#### Scenario: A new version is published once

- **WHEN** the release version is absent from the registry
- **THEN** the workflow publishes it exactly once

### Requirement: First-publish setup and operation are documented

The release documentation SHALL describe npm scope and package
prerequisites, the trusted-publisher entry (repository, workflow
filename, and direct-publish permission), the manual bootstrap required
before a trusted publisher can be configured, npm's two-day validation
window for a new trusted publisher, and the version-bump-then-tag
release procedure.

#### Scenario: An operator can perform the first release

- **WHEN** the package has never been published and an operator follows the documented bootstrap
- **THEN** the package exists on npm and the trusted publisher is configured for this repository and workflow

#### Scenario: The release procedure is unambiguous

- **WHEN** an operator prepares a release
- **THEN** the documentation states that the client version must be bumped to the tag version before the tag is pushed

#### Scenario: The README command matches the package

- **WHEN** the documentation tells an operator to inspect the publish tarball
- **THEN** the command runs in the package directory and describes the actual package contents, not the repository root
