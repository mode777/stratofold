# Spec Delta

## REMOVED Requirements

### Requirement: Alias browse paths render the SPA shell

**Reason**: A published folder with an `index.html` entry point must
serve that file at its pretty URL; always returning the browse shell
made static apps unusable.

**Migration**: Slashed alias directory paths now serve
`<dir>/index.html` when it exists and fall back to the SPA browse shell
when it does not. `/apps/<name>/index.html` continues to stream the
file explicitly.

## ADDED Requirements

### Requirement: Alias directory URLs serve index documents

The system SHALL redirect `GET /apps/<name>` to `/apps/<name>/` and,
for every slashed directory path of a public alias, SHALL stream
`<dir>/index.html` when it resolves to a regular file, using the same
file-server semantics as `/files` (Range, conditionals, ETag, HEAD, and
reconnect). When no index document exists it SHALL serve the embedded
SPA shell. The root-level `view` preview namespace SHALL remain
reserved. A directory URL MAY perform a sandboxed stat to find the
index candidate.

#### Scenario: The bare alias redirects to its slashed root

- **WHEN** a client requests `/apps/<name>` for a public alias
- **THEN** the response is a `301` to `/apps/<name>/`

#### Scenario: A root index document is served

- **WHEN** the vdir root contains `index.html` and `/apps/<name>/` is requested
- **THEN** the response body is that index file, served with the file-server headers and validators

#### Scenario: A nested index document is served

- **WHEN** `/apps/<name>/docs/` is requested and `docs/index.html` exists
- **THEN** that `docs/index.html` is streamed instead of the browse shell

#### Scenario: A folder without an index serves the browse view

- **WHEN** `/apps/<name>/docs/` is requested and `docs/index.html` does not exist
- **THEN** the SPA shell is returned and the browse view resolves the directory

#### Scenario: Missing directory paths surface in the browse view

- **WHEN** a slashed alias path names a directory that does not exist
- **THEN** the shell is served and the browse view shows its not-found state

#### Scenario: The index can still be requested explicitly

- **WHEN** `/apps/<name>/docs/index.html` is requested
- **THEN** the same index file is streamed through the direct-file path

#### Scenario: The preview namespace is not overridden by an index

- **WHEN** the vdir root contains `view/index.html` and `/apps/<name>/view/…` is requested
- **THEN** the SPA preview shell is served, not the root-level `view` index
