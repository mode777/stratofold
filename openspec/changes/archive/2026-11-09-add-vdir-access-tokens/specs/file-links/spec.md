# Spec Delta

## MODIFIED Requirements

### Requirement: Links are minted for one file on a readable vdir

The system SHALL expose `POST /api/sf/vdirs/<vdir-id>/links` accepting a
JSON body with a `path`, and SHALL create a link only when the request
carries a valid session cookie or a valid vdir-scoped bearer token and
the requester currently holds read access on the vdir (owner, viewer, or
editor). A bearer token SHALL be scoped to the vdir and its user SHALL
currently hold a grant on it. It SHALL reject anonymous requests with
`401` and requests without read access with `403` before any remote
operation, and SHALL reject an empty path with `400`. A successful mint
SHALL return `201` with the link's session-free URL and its expiry.

#### Scenario: A signed-in reader mints a link

- **WHEN** an owner, editor, or viewer posts a file path for a vdir they can read
- **THEN** the response is `201` with a `/s/<token>` URL and an expiry

#### Scenario: A bearer token mints a link

- **WHEN** a request carrying a valid vdir-scoped token posts a file path for that vdir
- **THEN** the response is `201` with a `/s/<token>` URL and an expiry

#### Scenario: A token on another vdir cannot mint

- **WHEN** a token scoped to vdir A posts a link request for vdir B
- **THEN** the response is `403` and no link is created

#### Scenario: Anonymous minting is rejected

- **WHEN** a request without a valid session or token calls the mint route
- **THEN** the response is `401` and no link is created

#### Scenario: Non-readers cannot mint

- **WHEN** a signed-in user or token user with no ownership or share on a non-public vdir calls the mint route
- **THEN** the response is `403` and no link is created

#### Scenario: Empty paths are rejected

- **WHEN** the mint body has an empty or missing path
- **THEN** the response is `400` and no link is created

#### Scenario: Rejected mints do not dial

- **WHEN** a rejected mint request is issued against the test fixture
- **THEN** no SSH dial is observed

## ADDED Requirements

### Requirement: Token-minted links are revoked with their token

A link minted with a bearer token SHALL record that token as its source.
Redemption SHALL require the source token to exist, be unexpired, belong
to the link creator, and still be scoped to the link's vdir; deleting or
expiring the token SHALL make the next redemption `404`. Links minted
with the session cookie SHALL be unaffected by token revocation.

#### Scenario: Revoking the token kills its links

- **WHEN** a token mints a link, the token is revoked, and the link is redeemed
- **THEN** the response is `404` and no file is served

#### Scenario: Expiring the token kills its links

- **WHEN** a token mints a link and the token's expiry passes before the link is redeemed
- **THEN** the response is `404`

#### Scenario: Deleting the token removes its links

- **WHEN** a token with minted links is deleted
- **THEN** those link records are removed with it

#### Scenario: Cookie-minted links are unaffected

- **WHEN** a link is minted with the session cookie and an unrelated token is revoked
- **THEN** the cookie-minted link still redeems until its own expiry or loss of the creator's access

#### Scenario: Losing access still revokes a token-minted link

- **WHEN** a token mints a link and the token's user loses read access before redemption
- **THEN** the response is `404`
