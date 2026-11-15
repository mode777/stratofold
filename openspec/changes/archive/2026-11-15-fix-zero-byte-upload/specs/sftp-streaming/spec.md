# Spec Delta

## ADDED Requirements

### Requirement: Zero-length writes complete successfully

A write of an empty byte stream SHALL succeed with zero bytes written and
leave the remote file present and empty. This SHALL hold both when the caller
declares a size of zero and when the stream is read to EOF and ends
immediately. The operation SHALL NOT retry, report failure, or remain marked
unfinished because no chunk was written.

#### Scenario: Declared zero-length write creates an empty file

- **WHEN** a zero-byte stream with a declared size of zero is written to a new remote path
- **THEN** the write reports success with zero bytes and the remote file exists and is empty

#### Scenario: EOF-delimited empty stream succeeds

- **WHEN** an empty reader is written with no declared size
- **THEN** the write reports success with zero bytes and the remote file exists and is empty

#### Scenario: Empty write replaces existing content

- **WHEN** a zero-byte stream is written to an existing non-empty remote path
- **THEN** the remote file exists with zero bytes
