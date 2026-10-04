# auth-session Specification

## Purpose

Bridges PocketBase's token-based authentication and the browser-native
cookie world: one login exchanges credentials for a PocketBase token and
an HttpOnly session cookie, so both API calls and plain browser requests
(`<video>`, downloads) authenticate against the same users, and long
streaming responses are not cut off by HTTP defaults.

## Requirements

### Requirement: Login exchanges credentials for token and session cookie
The system SHALL expose an authentication route (`POST /api/sf/auth`)
that, given valid user credentials, authenticates the user against
PocketBase and responds with the PocketBase auth token in the body and
an `sf_session` cookie carrying the same token in the `Set-Cookie`
header.

#### Scenario: Valid login returns token and sets cookie

- **WHEN** a client posts valid user credentials to the authentication route
- **THEN** the response contains a valid PocketBase auth token and a `Set-Cookie` header establishing the `sf_session` cookie with that token

#### Scenario: Built-in token remains usable after login

- **WHEN** a client uses the token returned by the authentication route against a PocketBase built-in authenticated endpoint
- **THEN** the request is accepted as that user

### Requirement: Failed login is rejected without a session
The system SHALL reject authentication with invalid credentials and
SHALL NOT set the `sf_session` cookie.

#### Scenario: Wrong password

- **WHEN** a client posts credentials with an incorrect password
- **THEN** the response is an authentication error, no `sf_session` cookie is set, and no token is issued

#### Scenario: Unknown user

- **WHEN** a client posts credentials for a user that does not exist
- **THEN** the response is an authentication error indistinguishable from a wrong password, and no cookie is set

### Requirement: Logout invalidates the session
The system SHALL expose a logout route (`DELETE /api/sf/auth`) that
clears the `sf_session` cookie and invalidates the session token, such
that the cookie is no longer accepted afterwards.

#### Scenario: Logout clears the cookie

- **WHEN** an authenticated client calls the logout route
- **THEN** the response instructs the browser to clear the `sf_session` cookie

#### Scenario: Session is invalid after logout

- **WHEN** the previously used `sf_session` cookie is presented after logout
- **THEN** the session is rejected as unauthenticated

### Requirement: Session cookie authenticates protected requests
The system SHALL provide request protection based on the `sf_session`
cookie: a request carrying a valid session cookie is authenticated as
the cookie's user, and the authenticated identity is available to the
protected handler.

#### Scenario: Anonymous request to a protected route

- **WHEN** a request without the `sf_session` cookie targets a route protected by the session middleware
- **THEN** the request is rejected as unauthenticated and the handler is not executed

#### Scenario: Valid cookie authenticates the user

- **WHEN** a request carries a valid `sf_session` cookie to a route protected by the session middleware
- **THEN** the request proceeds and the handler observes the authenticated user matching the cookie's token

### Requirement: Invalid or expired sessions are rejected
The system SHALL reject session cookies whose token is expired,
invalidated, or otherwise not resolvable to an auth record, treating
them as unauthenticated.

#### Scenario: Expired token

- **WHEN** a request presents an `sf_session` cookie whose token has expired
- **THEN** the request is rejected as unauthenticated

#### Scenario: Invalidated or forged token

- **WHEN** a request presents an `sf_session` cookie with an arbitrary or previously-invalidated token value
- **THEN** the request is rejected as unauthenticated

### Requirement: Session cookie attributes are browser-safe
The system SHALL set the `sf_session` cookie as HttpOnly and SameSite,
and as Secure when the request arrived over HTTPS, so the cookie is not
readable by scripts and travels only over secure top-level contexts.

#### Scenario: Cookie flags over plain HTTP

- **WHEN** login happens over plain HTTP
- **THEN** the `sf_session` cookie is set HttpOnly with a SameSite policy and without the Secure attribute

#### Scenario: Cookie flags over HTTPS

- **WHEN** login happens over HTTPS
- **THEN** the `sf_session` cookie is set HttpOnly, SameSite, and Secure

### Requirement: Custom routes never shadow PocketBase built-ins
The system SHALL mount all custom routes under the `/api/sf/` prefix and
SHALL keep every PocketBase built-in route and namespace (including
`/api/files/*`, owned by PocketBase for record attachments) functioning
with its built-in behavior on the same port.

#### Scenario: Built-in auth still works alongside custom routes

- **WHEN** the custom `/api/sf/auth` route is mounted and a client calls the PocketBase built-in auth endpoint for the users collection
- **THEN** the built-in endpoint responds with its normal behavior

#### Scenario: No route collision

- **WHEN** all custom routes are registered on the server
- **THEN** no custom route path shadows a PocketBase built-in namespace, and a request to any built-in route reaches PocketBase's handler

### Requirement: Streaming responses outlive default HTTP deadlines
The system SHALL clear per-request read/write deadlines on routes
designated as streaming, such that a streaming response continues past
the HTTP server's default timeouts and is not terminated mid-transfer
by framework defaults.

#### Scenario: Long-running streaming response completes

- **WHEN** a streaming-designated route produces a response that outlives the server's default request timeout
- **THEN** the response is delivered completely rather than aborted by a timeout
