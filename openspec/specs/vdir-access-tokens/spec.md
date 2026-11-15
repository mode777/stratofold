# vdir-access-tokens Specification

## Purpose

Grants a signed-in user's third-party clients revocable bearer access to
exactly one virtual directory, without exposing the full account or the
session cookie.

## Requirements

### Requirement: Tokens are minted for one vdir by a grantee

The system SHALL expose `POST /api/sf/tokens` accepting `vdir`, `name`,
`role` (`viewer` or `editor`), and an optional `expires_at`, authenticated
by the `sf_session` cookie. It SHALL mint only when the user currently
holds a grant on that vdir at least as strong as the requested role, and
SHALL return `201` with the plaintext token and its metadata exactly once.

#### Scenario: An owner mints an editor token

- **WHEN** the owner posts a vdir, a name, and role `editor`
- **THEN** the response is `201` with a plaintext `sf_v1_…` token, the vdir, the role, and the expiry

#### Scenario: A viewer mints a read-only token

- **WHEN** a viewer of the vdir posts role `viewer`
- **THEN** the token is created with role `viewer`

#### Scenario: A viewer cannot mint an editor token

- **WHEN** a viewer of the vdir posts role `editor`
- **THEN** the response is `403` and no token is created

#### Scenario: A user without a grant cannot mint

- **WHEN** a signed-in user with no ownership or share on the vdir posts a token request
- **THEN** the response is `403` and no token is created, even when the vdir is public

#### Scenario: Anonymous minting is rejected

- **WHEN** a request without a valid session calls the mint route
- **THEN** the response is `401` and no token is created

#### Scenario: An unknown vdir is not found

- **WHEN** a session-authenticated user mints for an unknown vdir id
- **THEN** the response is `404` and no token is created

#### Scenario: Invalid token shapes are rejected

- **WHEN** the body omits the name or vdir, uses a role other than `viewer`/`editor`, or supplies an expiry that is not in the future
- **THEN** the response is `400` and no token is created

#### Scenario: Rejected mints do not dial

- **WHEN** a rejected mint request is issued against the test fixture
- **THEN** no SSH dial is observed

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

### Requirement: Bearer tokens authenticate only their own vdir

A request carrying `Authorization: Bearer sf_v1_…` SHALL authenticate as
the token's user, scoped to the token's vdir. The token SHALL be accepted
by the filesystem API, `/files` for non-public vdirs, and the file-link
mint route. A token used on another vdir SHALL be `403`; an invalid,
expired, or revoked token SHALL be `401`; a bearer credential SHALL be
authoritative when present, even if a valid session cookie is also sent.

#### Scenario: A viewer token browses and downloads

- **WHEN** a `viewer` token lists a directory through the filesystem API and fetches a file through `/files`
- **THEN** both requests succeed

#### Scenario: A viewer token cannot write

- **WHEN** a `viewer` token calls `mkdir`, `mv`, `rm`, or `upload`
- **THEN** the response is `403` and no remote operation is performed

#### Scenario: An editor token writes

- **WHEN** an `editor` token calls `ls`, `mkdir`, `mv`, `rm`, or `upload` on its vdir
- **THEN** each operation executes with the same semantics as for the owner

#### Scenario: An owner's viewer token stays read-only

- **WHEN** the owner mints a `viewer` token and uses it to upload
- **THEN** the response is `403` despite the owner's own write access

#### Scenario: A token on another vdir is forbidden

- **WHEN** a token scoped to vdir A is used against vdir B
- **THEN** the response is `403` and no remote operation is performed

#### Scenario: An expired or revoked token is unauthenticated

- **WHEN** a request presents a token that is expired or whose record was deleted
- **THEN** the response is `401` and no remote operation is performed

#### Scenario: A bad bearer is not rescued by a cookie

- **WHEN** a request carries an invalid bearer token and a valid `sf_session` cookie
- **THEN** the response is `401`

#### Scenario: Rejected bearer requests never dial

- **WHEN** a wrong-vdir, expired, revoked, or insufficiently granted token request is issued against the test fixture
- **THEN** no SSH dial is observed

### Requirement: Token access is capped by the user's current grant

Every bearer request SHALL re-resolve the token user's current access
through the shared vdir authorization seam and SHALL allow only the
smaller of the token role and that access. Removing a share, changing a
role, deleting the user or vdir, or losing ownership SHALL end the
token's access on the next request; public read access alone SHALL NOT
keep a token alive.

#### Scenario: Removing a share ends the token

- **WHEN** a viewer mints a token, the owner removes the viewer's share, and the token is used
- **THEN** the response is `403`

#### Scenario: A role downgrade stops writes

- **WHEN** an editor mints an `editor` token, the owner changes the share to `viewer`, and the token uploads
- **THEN** the response is `403`

#### Scenario: Deleting the vdir or user ends the token

- **WHEN** the token's vdir or user is deleted and the token is used
- **THEN** the response is `401` and the token no longer grants access

### Requirement: Token management is session-only and own-token only

`GET /api/sf/tokens` and `DELETE /api/sf/tokens/{id}` SHALL require a
valid `sf_session` and SHALL expose or affect only the requester's own
tokens. A bearer credential SHALL NOT mint, list, or revoke tokens.
Listing SHALL return metadata and a non-secret hint, never the hash or
plaintext. Revoking another user's token SHALL be `404`; revoking an
already-absent own token SHALL be idempotent success.

#### Scenario: A user lists exactly their own tokens

- **WHEN** two users each mint tokens and one calls the list route
- **THEN** the response contains exactly that user's token metadata

#### Scenario: A bearer cannot manage tokens

- **WHEN** a request with a valid bearer token calls the mint, list, or revoke route without a valid session cookie
- **THEN** the response is `401`

#### Scenario: A user revokes their own token

- **WHEN** a user deletes their own token
- **THEN** the response is `204` and the token stops working immediately

#### Scenario: Another user's token is not found

- **WHEN** a user calls the revoke route with another user's token id
- **THEN** the response is `404` and the token remains usable by its owner

#### Scenario: Revoking a missing token is idempotent

- **WHEN** a user repeats the revoke call for a token that is already gone
- **THEN** the response is `204`

#### Scenario: Listing never reveals a secret

- **WHEN** the list route answers
- **THEN** it contains no plaintext token, token hash, or other secret

### Requirement: Tokens are introspectable without exposing the secret

`GET /api/sf/tokens/me` SHALL accept only a bearer token and SHALL
return the token's vdir id and name, role, expiry, last-used time, and
non-secret hint. It SHALL NOT return the plaintext token, its hash, or
any other secret, and SHALL reject a cookie-only or invalid request with
`401`.

#### Scenario: A valid token discovers its scope

- **WHEN** a bearer token calls the introspection route
- **THEN** the response contains its vdir id and name, role, expiry, and last-used time

#### Scenario: Cookie-only introspection is rejected

- **WHEN** a request with only the `sf_session` cookie calls the bearer introspection route
- **THEN** the response is `401`

#### Scenario: Introspection never returns the secret

- **WHEN** any introspection response is examined
- **THEN** it contains no plaintext token, token hash, or other secret

#### Scenario: Expired tokens cannot introspect

- **WHEN** an expired or revoked token calls the introspection route
- **THEN** the response is `401`

### Requirement: Tokens are high-entropy, hashed, and never re-exposed

Each token SHALL contain at least 256 bits of cryptographic randomness,
carry an `sf_v1_` prefix, and be stored only as a SHA-256 hash plus a
non-secret display hint. The plaintext SHALL appear only in the mint
response; no list, introspection, record API, or server request log
SHALL reveal a working token, and a token SHALL NOT be accepted in a
path or query parameter.

#### Scenario: Two mints produce different tokens

- **WHEN** the same user mints two tokens for the same vdir
- **THEN** the plaintext tokens differ

#### Scenario: The database stores no plaintext token

- **WHEN** the stored token row is inspected after minting
- **THEN** it contains a hash and a hint but no plaintext token

#### Scenario: The record API cannot reach tokens

- **WHEN** a normal authenticated user lists the `vdir_tokens` collection through the record API
- **THEN** the response is empty or denied, never the token rows

#### Scenario: Tokens are not URL credentials

- **WHEN** a token is supplied as a path segment or query parameter instead of the `Authorization` header
- **THEN** it does not authenticate the request

### Requirement: Revocation and expiry are immediate and cascade

Deleting a token, deleting its user or vdir, or passing its expiry SHALL
make the next bearer request `401`. Deleting the user or vdir SHALL also
remove its tokens. Revocation SHALL require no restart or cache purge,
and a successful bearer use SHALL update the token's last-used time.

#### Scenario: Deleting a token revokes it immediately

- **WHEN** a token is deleted and then used
- **THEN** the response is `401`

#### Scenario: Expiry ends the token

- **WHEN** a token's stored expiry has passed and it is used
- **THEN** the response is `401`

#### Scenario: Deleting the owner removes the tokens

- **WHEN** a user with tokens is deleted
- **THEN** that user's tokens no longer exist

#### Scenario: Deleting the vdir removes the tokens

- **WHEN** a vdir with tokens is deleted
- **THEN** those tokens no longer exist

#### Scenario: Last use is recorded

- **WHEN** a token successfully authenticates a request and the token is listed
- **THEN** its last-used time reflects that use without failing the request when the audit update fails

### Requirement: Cross-origin browser clients can use bearer tokens

The bearer surfaces SHALL answer cross-origin preflights with
`Authorization` (and `Range` on `/files`) allowed, and SHALL expose
`Accept-Ranges`, `Content-Length`, `Content-Range`, `Content-Type`,
`ETag`, `Last-Modified`, and `Content-Disposition` on `/files`
responses. No cookie or credentials mode SHALL be required.

#### Scenario: A preflight allows the bearer header

- **WHEN** a foreign origin sends `OPTIONS` with `Access-Control-Request-Headers: authorization`
- **THEN** the preflight allows `Authorization` and the response allows the origin

#### Scenario: A preflight allows Range on files

- **WHEN** a foreign origin sends `OPTIONS` for `/files` with `Range` requested
- **THEN** the preflight allows `Range`

#### Scenario: Representation headers are readable

- **WHEN** a cross-origin `/files` request succeeds
- **THEN** the browser can read the exposed range, validator, and disposition headers

#### Scenario: No credentials are needed

- **WHEN** a cross-origin bearer request omits cookies
- **THEN** it authenticates from the `Authorization` header alone
