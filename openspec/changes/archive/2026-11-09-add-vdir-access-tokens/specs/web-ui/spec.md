# Spec Delta

## ADDED Requirements

### Requirement: Connected apps are manageable in the UI

The SPA SHALL provide a Settings destination listing the signed-in
user's vdir access tokens with name, vdir, role, non-secret hint, expiry,
and last use; SHALL let the user mint a token for an accessible vdir with
a required name, a role capped by their effective role, and an optional
expiry; SHALL show the plaintext token once with a copy action and never
again; and SHALL let the user revoke a token with confirmation.

#### Scenario: Settings opens Connected apps

- **WHEN** a signed-in user opens Settings and selects Connected apps
- **THEN** the screen lists that user's vdir access tokens

#### Scenario: The list exposes no secret

- **WHEN** the Connected apps list is rendered
- **THEN** each row shows metadata and a non-secret hint, never a plaintext token or hash

#### Scenario: An owner or editor chooses either role

- **WHEN** the user mints a token for a vdir they own or edit
- **THEN** the role control offers `viewer` and `editor`

#### Scenario: A viewer can only mint a read-only token

- **WHEN** the user mints a token for a vdir where they hold a `viewer` share
- **THEN** `viewer` is the only role offered and the request succeeds

#### Scenario: The plaintext token is shown once

- **WHEN** a mint succeeds
- **THEN** the screen shows the plaintext token with a copy action and states that it will not be shown again

#### Scenario: Leaving the screen clears the secret

- **WHEN** the user dismisses the one-time token panel or reloads the list
- **THEN** the plaintext token is no longer available from the UI or the list response

#### Scenario: A token is revoked with confirmation

- **WHEN** the user chooses Revoke on a token and confirms
- **THEN** the token is deleted, the list updates, and the token stops working immediately

#### Scenario: Token failures map to UI states

- **WHEN** minting or revoking fails with `400`, `401`, `403`, `404`, or `503`
- **THEN** the screen surfaces the existing rejected, unauthorized, forbidden, not-found, or retryable state and does not report success

#### Scenario: Shared vdirs are selectable

- **WHEN** the user opens the mint form
- **THEN** the vdir choices include vdirs they own and vdirs shared with them, with roles capped by their effective role
