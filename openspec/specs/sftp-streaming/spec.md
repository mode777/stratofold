# sftp-streaming Specification

## Purpose

Byte-exact, offset-based reads and writes of remote files over SFTP,
with large transfers resuming at their last offset after a connection
drop instead of restarting — the mechanism behind Stratofold's
"stream, don't cache" promise for tens-of-gigabyte files.

## Requirements

### Requirement: Offset-based reads are byte-exact
The system SHALL read remote file content at a caller-supplied offset
and length, returning exactly the requested byte range, verified
byte-for-byte (e.g. by checksum) against the remote source.

#### Scenario: Read a range at an offset

- **WHEN** a read of N bytes at offset O is performed on a remote file
- **THEN** the returned bytes equal bytes O through O+N-1 of the remote file

#### Scenario: Full-file read integrity

- **WHEN** an entire remote file is read through offset-based reads
- **THEN** the checksum of the read bytes equals the checksum of the source file

### Requirement: Offset-based writes are byte-exact
The system SHALL write caller-supplied bytes at a caller-supplied
offset of a remote file without altering bytes outside the written
range, verified byte-for-byte against the expected result.

#### Scenario: Write at an offset

- **WHEN** M bytes are written at offset O of an existing remote file
- **THEN** the remote file equals the original with bytes O through O+M-1 replaced by the written bytes

#### Scenario: Full-file write integrity

- **WHEN** a whole file is written through offset-based writes
- **THEN** the checksum of the remote file equals the checksum of the written byte stream

### Requirement: Interrupted transfers resume at the last offset
The system SHALL resume an interrupted stream at the last confirmed
offset after the connection is re-established: downloads continue
reading from the last served offset, uploads continue writing from the
last acknowledged offset, and a transfer that cannot resume SHALL fail
loudly rather than silently corrupt the file.

#### Scenario: Download survives mid-stream disconnect

- **WHEN** the SSH connection is killed mid-read and reconnection succeeds
- **THEN** the read resumes at the last served offset and the final assembled content checksum matches the source

#### Scenario: Upload survives mid-stream disconnect

- **WHEN** the SSH connection is killed mid-write and reconnection succeeds
- **THEN** writing resumes at the last acknowledged offset and the final remote file checksum matches the uploaded byte stream

#### Scenario: Unresumable transfer fails loudly

- **WHEN** a stream cannot resume (e.g. the remote file changed length or the error is permanent)
- **THEN** the transfer fails with an explicit error and the remote target is not left silently corrupted

### Requirement: Errors are classified retryable or permanent
The system SHALL classify SFTP/SSH errors as retryable (network
failures, EOF, connection loss) or permanent (permission denied, not
found, host key mismatch), retry only retryable errors via the
connection manager's backoff, and never retry permanent errors.

#### Scenario: Network error is retried

- **WHEN** a stream operation fails with a connection loss or EOF
- **THEN** the operation is retried after reconnection rather than failing immediately

#### Scenario: Permanent error is not retried

- **WHEN** a stream operation fails with permission denied or file-not-found
- **THEN** the error is returned immediately without retry attempts

### Requirement: Streaming does not buffer whole files
The system SHALL transfer files incrementally in bounded chunks such
that peak memory use stays bounded by the chunk/concurrency budget,
not by file size.

#### Scenario: Multi-gigabyte transfer keeps memory flat

- **WHEN** a multi-gigabyte file is streamed in full in either direction
- **THEN** the process peak memory remains within the configured bounded budget regardless of file size
