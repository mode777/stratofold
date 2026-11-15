# Spec Delta

## ADDED Requirements

### Requirement: Zero-byte uploads publish an empty file

An upload with an empty request body SHALL publish a zero-byte file at the
target through the same temporary-file and atomic-rename path as any other
upload. It SHALL return `200` identifying the target path and `size: 0`; the
target SHALL exist with no bytes, its content version SHALL change as for any
publication, and no upload temp file SHALL remain. An empty upload SHALL NOT
be reported as a retryable failure or consume the transfer retry budget.

#### Scenario: Empty upload creates an empty file

- **WHEN** an upload with a zero-byte body targets a path whose parent directory exists
- **THEN** the response is `200` with the target path and `size: 0`, the target exists as a zero-byte file, and no upload temp file remains

#### Scenario: Empty upload replaces existing content

- **WHEN** an empty body is uploaded over an existing non-empty file
- **THEN** the target exists with zero bytes and its content version differs from the version observed before the upload

#### Scenario: Declared and streamed empty bodies both succeed

- **WHEN** an empty upload declares `Content-Length: 0`, and another sends a chunked body that reaches EOF without any bytes
- **THEN** both requests create a zero-byte file and report success rather than an unavailable (`503`) failure

#### Scenario: A conditional empty upload publishes

- **WHEN** an empty upload carries `If-Match` matching the target's current version
- **THEN** the empty file is published and the target's version changes
