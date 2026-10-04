# Product vision

Stratofold is a cloud SSH/SFTP client that acts like a Google Drive /
OneDrive / Dropbox alternative. Files live on SSH hosts; Stratofold
makes them browsable, shareable, and streamable through the web.

## Core principles

- **Stream, don't cache.** Files are streamed directly from/to the SSH
  source — no caching in RAM or on the host disk — because transfers of
  tens of gigabytes are expected.
- **No direct host access.** Actual file access is never done against
  the SSH host directly; it is managed through virtual directories.

## SSH connections

- Users can create multiple SSH connections.
- Connections are opened on demand and kept open until 20 minutes of
  inactivity. Connection pools (more than one connection) are a future
  extension.
- If a connection fails, it is automatically reconnected with
  exponential backoff. All operations must be designed around this
  retry mechanism.

## Virtual directories

- Virtual directories (folders on the SSH source) act as isolated
  roots that provide file access in the UI.
- Virtual directories can be shared with other users.
- Virtual directories can be declared **public**, meaning everyone can
  browse and download files.

## File management

- Google Drive–like file management capabilities: upload files, move
  files, etc.
- Different access paths for writing/editing (REST/web API) operations
  versus reading files:
  - API access lives behind `/api/` (listing operations are part of
    the API).
  - File access follows the pattern
    `/files/<vdir-id>/<virtual-path>/file.ext`.
- Reading files is served by a state-of-the-art file server with
  streaming capabilities (e.g. videos) and includes serving standard
  files like `index.html`, mime types, etc.
- Non-public file access in virtual directories requires
  authentication.

## UI

- State-of-the-art JavaScript SPA, designed mobile first but
  responsive; design oriented on Google Drive.
- The SPA supports uploads in the background.

## Architecture considerations (not decisions yet)

> Settled since then — these considerations are now resolved in
> [`architecture.md`](architecture.md) and the ADRs in
> [`decisions/`](decisions/README.md); this section is kept as the
> original input.

- Binary size and low memory footprint should be prioritized; Golang
  shall be strongly considered.
- Final distribution via a single Docker image (frontend and backend).
- PocketBase could be used as a Go framework that easily handles
  resource and user administration. But authorized file access on the
  file server likely needs cookies, while PocketBase uses tokens —
  this needs to be considered and researched early. PocketBase
  read/write timeouts need to be disabled.
- Consider existing SSH libraries and evaluate them against the
  requirements, especially the streaming part.
