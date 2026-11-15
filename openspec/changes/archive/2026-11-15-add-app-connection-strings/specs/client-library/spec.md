# Spec Delta

## MODIFIED Requirements

### Requirement: The server address is explicit and authentication is header-only

A client SHALL be created with an explicit absolute server base URL and
a vdir id, supplied either as construction options or inside a
connection string; it SHALL NOT infer the server address. When a token
is configured, every request SHALL carry it as `Authorization: Bearer …`
and SHALL never place it in a URL, query string, fragment, or body.
Requests SHALL NOT require cookies or a credentials mode.

#### Scenario: The token never appears in a URL

- **WHEN** any operation is performed with a token
- **THEN** the token is absent from every request URL and query parameter

#### Scenario: The base URL is required

- **WHEN** a client is created without an absolute base URL
- **THEN** creation fails with a rejected-argument error and no request is attempted

#### Scenario: No credentials mode is used

- **WHEN** a request is sent from a foreign origin
- **THEN** it authenticates from the header alone and sends no cookies

## ADDED Requirements

### Requirement: Connection strings configure a client

The package SHALL expose `StratofoldClient.fromConnectionString(value,
overrides?)` and `parseConnectionString(value)`. Parsing SHALL be local
and synchronous, SHALL make no network request, SHALL return the base
URL, vdir id, and token, and SHALL reject a malformed or unknown-version
value with the configuration error class. Overrides SHALL be able to
replace the base URL and inject the fetch/XHR seams without changing the
vdir or token.

#### Scenario: A parsed connection string exposes the facts

- **WHEN** a caller parses a valid `sfconn_v1_` value
- **THEN** the result carries the embedded base URL, vdir id, and token

#### Scenario: A factory builds a working client

- **WHEN** a caller creates a client from a valid connection string and lists the vdir
- **THEN** the request targets the embedded base URL and vdir with `Authorization: Bearer <token>`

#### Scenario: Parsing performs no request

- **WHEN** a caller parses a connection string
- **THEN** no fetch or XHR is attempted

#### Scenario: The base URL can be overridden

- **WHEN** a caller supplies a `baseUrl` override to the factory
- **THEN** requests use the override while the embedded vdir and token are unchanged

#### Scenario: A malformed value is rejected locally

- **WHEN** the prefix, version, base64url payload, or a required field is invalid
- **THEN** parsing fails with the configuration error class and no request is attempted

#### Scenario: The secret still never enters a URL

- **WHEN** any operation runs on a client created from a connection string
- **THEN** no request URL, query, or fragment contains the connection string or its token

### Requirement: The static test client accepts a connection string

The static test client SHALL accept a pasted `sfconn_v1_` connection
string as an alternative to entering the base URL, vdir, and token
separately. A valid value SHALL fill those three fields; an invalid value
SHALL be reported without changing the current connection. The
connection string itself SHALL NOT be persisted, and the existing
browser-only persistence and no-checked-in-secret rules SHALL continue
to apply.

#### Scenario: A pasted string fills the connection fields

- **WHEN** a visitor pastes a valid connection string and applies it
- **THEN** the server URL, vdir, and token fields show the decoded values

#### Scenario: An invalid string changes nothing

- **WHEN** a visitor applies a malformed connection string
- **THEN** the client reports the error and keeps the previous connection values

#### Scenario: The connection string is not stored

- **WHEN** a visitor applies a connection string and reloads
- **THEN** the fields restore from the existing browser-only base URL, vdir, and token storage, not from a stored connection string

#### Scenario: The deployed bundle still carries no secret

- **WHEN** the production test-client build is inspected
- **THEN** it contains no connection string, token, or default instance URL
