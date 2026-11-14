# Spec Delta

## ADDED Requirements

### Requirement: ETags are the shared content version

Every successful file response SHALL send a strong `ETag` equal to the
quoted content version of the file actually served (including a resolved
`index.html`), the same value `stat`/`ls` report for that file. `HEAD`
SHALL send the same validators and `Content-Length` as `GET` with no
body. Conditional GET, Range, and `304` semantics SHALL not change.

#### Scenario: ETag equals the stat version

- **WHEN** a file is stat-ed and then fetched through `/files`
- **THEN** the response `ETag` is the quoted form of the stat `version`

#### Scenario: A resolved index.html uses its own version

- **WHEN** a directory URL is requested and resolves to `index.html`
- **THEN** the response `ETag` is the quoted version of that `index.html`, not the directory's version

#### Scenario: A same-size, same-second save rotates the ETag

- **WHEN** a file is replaced by an upload of the same byte length within one whole second
- **THEN** a later GET sends a different `ETag`, and a GET carrying the previous `ETag` in `If-None-Match` returns `200` with the new content

#### Scenario: A matching ETag still yields 304

- **WHEN** a GET carries the current `ETag` in `If-None-Match`
- **THEN** the response is `304` without a body

#### Scenario: HEAD carries the same validators without a body

- **WHEN** the same file is requested with `HEAD`
- **THEN** the response carries the same `ETag`, `Last-Modified`, `Content-Length`, and `Accept-Ranges` as the GET, and no body

#### Scenario: Range responses keep the same validator

- **WHEN** a single-range request is served
- **THEN** the `206` response carries the same `ETag` as the full representation
