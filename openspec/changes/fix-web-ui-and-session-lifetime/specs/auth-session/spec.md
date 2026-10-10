# Spec Delta: auth-session

## ADDED Requirements

### Requirement: Sessions last the maximum supported lifetime

The system SHALL issue login auth tokens valid for the longest token
lifetime the platform supports (the users collection's auth-token
duration at its validated maximum, 94,670,856 seconds ≈ 3 years), and
SHALL set the `sf_session` cookie as persistent with a `MaxAge` no
shorter than the browser-standard maximum cookie persistence (400
days), so the effective session length is bounded by platform maxima
rather than by Stratofold's defaults. Logout invalidation and expiry
rejection SHALL still apply unchanged.

#### Scenario: Login issues a maximum-lifetime token

- **WHEN** a client posts valid credentials to the authentication route
- **THEN** the issued auth token's validity is derived from the users collection's auth-token duration configured to the platform's validated maximum (94,670,856 seconds)

#### Scenario: Session cookie is persistent

- **WHEN** a client logs in successfully
- **THEN** the `Set-Cookie` header for `sf_session` carries a `MaxAge` of at least 400 days, so the cookie survives browser restarts instead of dying with the browser session

#### Scenario: Persistent cookie authenticates after restart

- **WHEN** a browser that logged in earlier presents the persisted `sf_session` cookie in a new session, within the token's validity
- **THEN** requests authenticated by that cookie are accepted as the same user

#### Scenario: Logout still invalidates immediately

- **WHEN** a user logs out while holding a maximum-lifetime token and persistent cookie
- **THEN** the token is invalidated server-side, the cookie is cleared, and subsequent requests are unauthenticated

#### Scenario: Expired maximum-lifetime tokens are still rejected

- **WHEN** a request presents an `sf_session` cookie whose token has passed the configured maximum lifetime
- **THEN** the request is rejected as unauthenticated
