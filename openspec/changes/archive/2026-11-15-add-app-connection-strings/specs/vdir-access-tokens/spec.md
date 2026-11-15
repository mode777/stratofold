# Spec Delta

## ADDED Requirements

### Requirement: Mint returns a one-time app connection string

`POST /api/sf/tokens` SHALL include a one-time `connection_string` in
its `201` response. The value SHALL bundle the request's external server
base URL, the minted token's vdir id, and the plaintext token. It SHALL
NOT be stored, listed, introspected, or returned again, and no server
request log SHALL contain it.

#### Scenario: A successful mint returns a connection string

- **WHEN** a grantee mints a token
- **THEN** the `201` response contains a `connection_string` beginning with `sfconn_v1_`

#### Scenario: The connection string matches the minted token

- **WHEN** the returned connection string is decoded
- **THEN** its server URL, vdir id, and token equal the request origin, the minted token's vdir, and the plaintext token

#### Scenario: Later responses omit the connection string

- **WHEN** the token list or bearer introspection route answers
- **THEN** the response contains no `connection_string`

#### Scenario: A rejected mint returns no connection string

- **WHEN** a mint request is rejected with `400`, `401`, `403`, or `404`
- **THEN** the response contains no `connection_string`

#### Scenario: The connection string is not itself a credential

- **WHEN** a request presents a connection string as the bearer credential
- **THEN** the response is `401` and no remote operation is performed

### Requirement: Connection strings are versioned opaque values

The connection string SHALL be `sfconn_v1_` followed by the unpadded
base64url encoding of a UTF-8 JSON object with `v` equal to `1`, an
absolute `http` or `https` `url`, the `vdir` id, and the plaintext
`token`. It SHALL NOT be a URL, and it SHALL NOT rely on URL query or
fragment encoding. A decoder SHALL reject an unknown prefix or version,
invalid base64url, or a missing or invalid field rather than guessing.

#### Scenario: The payload contains exactly the connection facts

- **WHEN** the value after the `sfconn_v1_` prefix is decoded
- **THEN** it is a JSON object whose `v` is `1` and whose `url`, `vdir`, and `token` are non-empty strings

#### Scenario: The base URL is an absolute HTTP origin

- **WHEN** the decoded `url` field is parsed
- **THEN** it is an absolute `http` or `https` URL with an authority and no credentials, path, query, or fragment

#### Scenario: The string is not a URL

- **WHEN** the connection string is supplied to a standard URL parser
- **THEN** it does not resolve to an `http` or `https` URL

### Requirement: The embedded origin follows the request's external address

The embedded base URL SHALL be the absolute origin the requester used:
HTTPS when TLS is present or the first `X-Forwarded-Proto` value is
`https`, and the first `X-Forwarded-Host` value when present, otherwise
`Host`. A mint whose origin cannot be determined SHALL still return the
token but SHALL omit `connection_string`.

#### Scenario: A direct HTTPS request embeds HTTPS

- **WHEN** a mint is served over TLS at `files.example.com`
- **THEN** the decoded `url` is `https://files.example.com`

#### Scenario: A proxied HTTPS request embeds HTTPS

- **WHEN** a plain-HTTP mint carries `X-Forwarded-Proto: https` and `Host: files.example.com`
- **THEN** the decoded `url` is `https://files.example.com`

#### Scenario: The forwarded host wins

- **WHEN** a mint carries `X-Forwarded-Host: drive.example.com` and `Host: internal:8090`
- **THEN** the decoded `url` uses `drive.example.com`

#### Scenario: A plain HTTP request embeds HTTP

- **WHEN** a mint reaches the server directly over plain HTTP
- **THEN** the decoded `url` uses the `http` scheme and the request host

#### Scenario: A missing origin omits the string

- **WHEN** a mint request has no usable host
- **THEN** the response still carries the plaintext token and omits `connection_string`

#### Scenario: Forwarded values are not concatenated

- **WHEN** `X-Forwarded-Host` or `X-Forwarded-Proto` carries a comma-separated list
- **THEN** only the first value is used in the decoded `url`
