# Spec Delta

## MODIFIED Requirements

### Requirement: Connections are manageable in the UI

The SPA SHALL let a user create, edit, and delete their own connection
records (label, host, port, username, auth method `password`/`key`, the
matching secret, an optional host-key fingerprint, and a remote
directory) through the record API; secrets SHALL be write-only in the UI
— never rendered back after saving — and editing with an empty secret
SHALL leave the stored secret unchanged. The fingerprint field SHALL be
optional and SHALL explain that an empty fingerprint is pinned on first
successful connection (trust on first use).

#### Scenario: Password connection is created

- **WHEN** a user submits the connection form with auth method `password` and a password
- **THEN** the connection record is created owned by that user and appears in their connection list

#### Scenario: Key connection is created

- **WHEN** a user submits the connection form with auth method `key` and a private key
- **THEN** the connection record is created with that key material

#### Scenario: Connection is created without a fingerprint

- **WHEN** a user submits the connection form leaving the host-key fingerprint empty
- **THEN** the connection record is created and the form explains the fingerprint will be pinned on first connection

#### Scenario: Remote directory is editable

- **WHEN** a user submits the connection form with a remote directory such as `/home/`
- **THEN** the connection record stores it and the connection list shows it

#### Scenario: Secrets are never rendered back

- **WHEN** an existing connection is opened for editing
- **THEN** no secret field shows the stored value (placeholders only), and the response that populated the form contained no secrets

#### Scenario: Empty secret on edit preserves the stored secret

- **WHEN** a connection is saved with a secret field left empty
- **THEN** the previously stored secret remains in effect

#### Scenario: Connection is deleted

- **WHEN** the owner deletes a connection
- **THEN** the record is removed and the UI no longer offers it (vdirs bound to it are removed by the server's cascade)

### Requirement: Vdirs are manageable in the UI

The SPA SHALL let a user create, edit, and delete their own vdir
records (name, root path, `is_public`, bound connection) through the
record API, offering only the user's own connections for binding; when
creating a vdir the root path SHALL default from the selected
connection's remote directory while remaining editable.

#### Scenario: Vdir is created on an own connection

- **WHEN** a user submits the vdir form with a name, root path, and one of their own connections
- **THEN** the vdir record is created and appears under "My vdirs"

#### Scenario: Root path defaults from the connection

- **WHEN** a user selects a connection with a remote directory while creating a new vdir
- **THEN** the root-path field is prefilled with that remote directory and can still be edited before saving

#### Scenario: Foreign connections are not offered

- **WHEN** the vdir form is opened
- **THEN** only the user's own connections are selectable for binding

#### Scenario: is_public is toggled

- **WHEN** the owner flips a vdir's `is_public` and saves
- **THEN** the vdir's public marking updates accordingly in the UI

#### Scenario: Vdir is deleted

- **WHEN** the owner deletes a vdir
- **THEN** the record is removed and it disappears from the switcher
