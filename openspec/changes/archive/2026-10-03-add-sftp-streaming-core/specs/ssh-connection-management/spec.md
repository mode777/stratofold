# Spec Delta — `ssh-connection-management`

## Purpose

Owns the lifecycle of SSH/SFTP connections to remote hosts: connections
are dialed on demand, closed after idleness, and automatically
re-established with exponential backoff so every other capability can
assume a working connection or a clearly retryable failure.

## ADDED Requirements

### Requirement: Connections are established on demand
The system SHALL NOT open an SSH connection to a host until the first
operation targeting that host is requested, and SHALL use a single
SSH connection (with one SFTP channel) per connection config while it
remains healthy.

#### Scenario: First operation dials

- **WHEN** an operation targets a host with no established connection
- **THEN** the system dials the SSH connection, opens the SFTP channel, and performs the operation

#### Scenario: Reuse of healthy connection

- **WHEN** a second operation targets the same host while the connection is healthy
- **THEN** no new SSH dial occurs and the existing connection is reused

### Requirement: Idle connections are closed after a TTL
The system SHALL close an SSH connection that has had no activity for
the configured idle TTL (default 20 minutes), and a subsequent
operation after closure SHALL establish a fresh connection.

#### Scenario: Idle connection evicted

- **WHEN** no operation uses a connection for longer than the idle TTL
- **THEN** the system closes the SSH connection

#### Scenario: Operation after eviction reconnects

- **WHEN** an operation arrives after the connection was closed for idleness
- **THEN** a new connection is dialed and the operation succeeds

### Requirement: Failed connections reconnect with exponential backoff
The system SHALL automatically reconnect a failed or dropped
connection using exponential backoff (base, factor, cap, and jitter as
configurable tunables), and SHALL surface an in-progress reconnect as a
retryable condition rather than a permanent error.

#### Scenario: Reconnect succeeds after drop

- **WHEN** the SSH connection is dropped and the host becomes reachable again
- **THEN** the system re-establishes the connection via backoff retries without operator intervention

#### Scenario: Backoff growth is bounded

- **WHEN** reconnect attempts repeatedly fail
- **THEN** the delay between attempts grows by the configured factor from the base, is capped at the configured maximum, and includes jitter

### Requirement: Host key changes abort the connection
The system SHALL verify the remote host key against the pinned
SHA256 fingerprint configured for the connection, abort the
connection on mismatch, and report the mismatch as a permanent error
requiring re-approval.

#### Scenario: Matching host key

- **WHEN** the remote presents the host key matching the pinned fingerprint
- **THEN** the connection is established

#### Scenario: Changed host key

- **WHEN** the remote presents a host key that does not match the pinned fingerprint
- **THEN** the connection is refused with a permanent error and no operation is executed

### Requirement: Operations survive connection replacement
The system SHALL serialize operations through the current connection
such that replacing a broken connection with a re-established one does
not interleave or corrupt concurrent operations.

#### Scenario: Concurrent operations during reconnect

- **WHEN** multiple operations are issued while the connection is being re-established
- **THEN** each operation either completes against the re-established connection or fails with a retryable error, and none is partially applied
