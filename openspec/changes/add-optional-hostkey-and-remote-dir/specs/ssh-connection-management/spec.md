# Spec Delta

## MODIFIED Requirements

### Requirement: Host key changes abort the connection
The system SHALL verify the remote host key against the SHA256
fingerprint pinned on the connection when one is configured, abort the
connection on mismatch, and report the mismatch as a permanent error
requiring re-approval. When no fingerprint is pinned, the system SHALL
accept the host key presented by the first successfully authenticated
connection, pin it to the connection, and verify every subsequent
connection against that captured fingerprint.

#### Scenario: Matching host key

- **WHEN** the remote presents the host key matching the pinned fingerprint
- **THEN** the connection is established

#### Scenario: Changed host key

- **WHEN** the remote presents a host key that does not match the pinned fingerprint
- **THEN** the connection is refused with a permanent error and no operation is executed

#### Scenario: Unpinned connection captures the host key

- **WHEN** a connection with no pinned fingerprint completes a handshake and authentication for the first time
- **THEN** the presented host key's fingerprint is captured and pinned on the connection record, and the operation proceeds

#### Scenario: Captured fingerprint is enforced afterwards

- **WHEN** a connection whose fingerprint was captured on first use later reaches a host presenting a different key
- **THEN** the connection is refused with a permanent error and no operation is executed

#### Scenario: Failed authentication does not pin

- **WHEN** an unpinned connection presents a host key but authentication fails
- **THEN** no fingerprint is pinned on the connection and the failure is reported
