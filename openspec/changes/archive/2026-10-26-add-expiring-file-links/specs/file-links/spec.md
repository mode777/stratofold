# Spec Delta

## Purpose

Grants time-bounded, per-file read access to clients that cannot present
the session cookie — cast receivers, download consumers — without making
a whole virtual directory public.

## ADDED Requirements

### Requirement: Links are minted for one file on a readable vdir

The system SHALL expose `POST /api/sf/vdirs/<vdir-id>/links` accepting a
JSON body with a `path`, and SHALL create a link only when the request
carries a valid session and the requester currently holds read access on
the vdir (owner, viewer, or editor). It SHALL reject anonymous requests
with `401` and authenticated requests without read access with `403`
before any remote operation, and SHALL reject an empty path with `400`. A
successful mint SHALL return `201` with the link's session-free URL and
its expiry.

#### Scenario: A signed-in reader mints a link

- **WHEN** an owner, editor, or viewer posts a file path for a vdir they can read
- **THEN** the response is `201` with a `/s/<token>` URL and an expiry

#### Scenario: Anonymous minting is rejected

- **WHEN** a request without a valid session calls the mint route
- **THEN** the response is `401` and no link is created

#### Scenario: Non-readers cannot mint

- **WHEN** a signed-in user with no ownership or share on a non-public vdir calls the mint route
- **THEN** the response is `403` and no link is created

#### Scenario: Empty paths are rejected

- **WHEN** the mint body has an empty or missing path
- **THEN** the response is `400` and no link is created

#### Scenario: Rejected mints do not dial

- **WHEN** a rejected mint request is issued against the test fixture
- **THEN** no SSH dial is observed

### Requirement: Links are scoped to one file and grant no other access

A link SHALL redeem to exactly the stored vdir and virtual path and SHALL
grant only the read of that file. It SHALL NOT serve a directory listing,
another file or vdir, or any write operation; a link whose target
resolves to a directory SHALL be `404`.

#### Scenario: The stored file is served

- **WHEN** a link minted for one file is redeemed
- **THEN** the response body is that file's bytes and nothing else

#### Scenario: Directory targets are not served

- **WHEN** a link was minted for a path that resolves to a directory
- **THEN** redemption is `404` and no listing is returned

#### Scenario: Link URLs carry no path or write channel

- **WHEN** a client appends a suffix, path segment, or query parameter to a link URL, or attempts a non-read method
- **THEN** no other path is served and no write is performed

### Requirement: Links expire 24 hours after minting

The system SHALL treat a link as valid only before its stored expiry,
SHALL set that expiry to 24 hours after minting, SHALL report it in the
mint response, and SHALL NOT let clients choose, extend, or renew it.
Redemption at or after the expiry SHALL be `404`.

#### Scenario: A fresh link is valid

- **WHEN** a link is redeemed before its reported expiry
- **THEN** the file is served

#### Scenario: An expired link is not found

- **WHEN** a link is redeemed at or after its expiry
- **THEN** the response is `404` and no remote file is served

#### Scenario: Clients cannot extend validity

- **WHEN** a mint or redemption request supplies a lifetime or renewal parameter
- **THEN** it is ignored and the server-chosen expiry stands

### Requirement: Losing read access revokes a link

Redemption SHALL re-evaluate the link creator's current read access
against the vdir and its shares on every request. Removing the creator's
share, or deleting the creator, the vdir, the link record, or the target
file SHALL make the next redemption `404`. Un-publishing a vdir SHALL NOT
revoke an owner-created link while it is unexpired.

#### Scenario: Removing a share revokes the viewer's link

- **WHEN** a viewer mints a link, the owner deletes that share, and the link is redeemed
- **THEN** the response is `404`

#### Scenario: Deleting the vdir revokes every link

- **WHEN** a vdir with links is deleted and one of its links is redeemed
- **THEN** the response is `404`

#### Scenario: A deleted target is not found

- **WHEN** the linked file is deleted or moved and the link is redeemed
- **THEN** the response is `404`

#### Scenario: An owner link survives un-publishing

- **WHEN** the owner mints a link, un-publishes the vdir, and redeems the link before its expiry
- **THEN** the file is served

### Requirement: Redemption is session-free and failures are indistinguishable

`GET` and `HEAD` on `/s/<token>` SHALL require no session cookie and
SHALL answer `404` for an unknown, expired, revoked, missing, directory,
or sandbox-rejected target without revealing whether the vdir or path
exists. The route SHALL live outside every `/api/` namespace and SHALL
never fall back to the SPA shell.

#### Scenario: Anonymous redemption works

- **WHEN** a request with no cookie redeems a valid link
- **THEN** the file is served

#### Scenario: Every invalid link is a plain 404

- **WHEN** the token is unknown, expired, revoked, or its target is missing
- **THEN** the response is `404` with no vdir or path information

#### Scenario: Missing links are not the SPA shell

- **WHEN** an unknown path under `/s/` is requested
- **THEN** the response is a server `404`, not the embedded SPA page

#### Scenario: HEAD returns headers without a body

- **WHEN** a valid link is requested with `HEAD`
- **THEN** the response carries the representation headers and no body

### Requirement: Links serve with file-server representation semantics

A successful redemption SHALL deliver the linked file's bytes with the
same single-range, conditional, content-header, and mid-response
reconnect behavior as `/files` for the same file.

#### Scenario: Range requests are honored

- **WHEN** a redemption carries a single `Range` header
- **THEN** the response is `206` with the matching `Content-Range` and exactly the requested bytes

#### Scenario: Conditional requests short-circuit

- **WHEN** a redemption carries matching `If-None-Match` or `If-Modified-Since` validators
- **THEN** the response is `304` without a body

#### Scenario: Content type follows the shared table

- **WHEN** a linked file's extension is in the file server's mime table
- **THEN** the response carries that type and advertises `Accept-Ranges: bytes`

#### Scenario: A mid-response drop resumes

- **WHEN** the SSH connection drops during a link response and the client retries the remaining range
- **THEN** the retry serves the remaining bytes from the correct offset

### Requirement: Link responses are unshared and receiver-readable

The system SHALL send `Cache-Control: no-store` on link responses and
SHALL allow cross-origin `GET` and `HEAD` requests, including `Range` and
conditional request headers, so a media receiver can fetch the link
without credentials.

#### Scenario: Link responses are not cached

- **WHEN** a link response is returned
- **THEN** it carries `Cache-Control: no-store`

#### Scenario: A receiver can read the link cross-origin

- **WHEN** a cross-origin request redeems a link with a range or conditional header
- **THEN** the response allows the origin and exposes the range/content headers it needs

#### Scenario: No credentials are required

- **WHEN** a cross-origin redemption request omits credentials
- **THEN** it succeeds for a valid link and never depends on a cookie

### Requirement: Tokens are unguessable and never re-exposed

Each token SHALL be generated from at least 128 bits of cryptographic
randomness. The plaintext token SHALL appear only in the mint response;
no API or record listing SHALL reveal a previously minted token, and two
mints SHALL produce different tokens.

#### Scenario: The token is shown once

- **WHEN** a link is minted and later records or APIs are read
- **THEN** the plaintext token is not returned again

#### Scenario: Tokens are unique

- **WHEN** the same file is minted twice
- **THEN** each response carries a different token

### Requirement: Server request logs do not retain working tokens

The server's own request logging SHALL redact the token segment of `/s/`
URLs so a logged request cannot be replayed as a working link.

#### Scenario: Logged link paths are redacted

- **WHEN** a link is redeemed and the server's request log entry is examined
- **THEN** the URL contains a redacted `/s/` path rather than a reusable token
