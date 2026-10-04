# Spec Delta

## ADDED Requirements

### Requirement: Share grantees are resolved by exact email lookup

The system SHALL expose an authenticated route
(`GET /api/sf/users/lookup?email=…`) under the custom `/api/sf/`
namespace that resolves an exact email address to the matching user's
id and email, for the sole purpose of naming share grantees; it SHALL
return at most one record, SHALL accept no listing, prefix, or search
form, and SHALL reject unauthenticated requests.

#### Scenario: Exact match resolves the grantee

- **WHEN** an authenticated user requests the lookup with the exact email of a registered user
- **THEN** the response contains that user's id and email and nothing else

#### Scenario: No match is not found

- **WHEN** an authenticated user requests the lookup with an email that is not registered
- **THEN** the response is `404` and no user information is returned

#### Scenario: Unauthenticated requests are rejected

- **WHEN** a request without a valid session calls the lookup route
- **THEN** the response is `401`

#### Scenario: Non-exact queries are rejected

- **WHEN** the lookup is called without the `email` parameter, with an empty value, or with any listing/pagination parameter
- **THEN** the response is `400` and no user data is returned
