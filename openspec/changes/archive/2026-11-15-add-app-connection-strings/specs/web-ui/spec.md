# Spec Delta

## ADDED Requirements

### Requirement: The one-time panel offers an app connection string

The Connected apps one-time panel SHALL show the mint response's
`connection_string` alongside the plaintext token, with its own copy
action and a statement that it will not be shown again. The value SHALL
be treated as a secret, SHALL disappear when the panel is dismissed, and
SHALL NOT appear in the token list or any later response.

#### Scenario: A mint shows both credential forms

- **WHEN** a mint succeeds and the response carries a connection string
- **THEN** the one-time panel shows the plaintext token and the `sfconn_v1_` connection string

#### Scenario: The connection string has its own copy action

- **WHEN** the user activates the connection-string copy control
- **THEN** the exact connection string is written to the clipboard and the control reports success

#### Scenario: Copy failure leaves the value selectable

- **WHEN** the clipboard write fails
- **THEN** the full connection string stays visible and an error tells the user to select it manually

#### Scenario: Dismissing the panel clears both values

- **WHEN** the user dismisses the one-time panel
- **THEN** neither the plaintext token nor the connection string remains in the UI

#### Scenario: The list never exposes the connection string

- **WHEN** the Connected apps list is rendered
- **THEN** no row contains a connection string

#### Scenario: A response without a connection string still shows the token

- **WHEN** a mint response omits `connection_string`
- **THEN** the panel shows the plaintext token and omits the connection-string block
