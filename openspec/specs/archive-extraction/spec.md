# archive-extraction Specification

## Purpose

Unpack an archive stored on an SSH host into an adjacent folder without
downloading it, so users can use a remote zip in place the way a desktop file
manager lets them — with the same atomicity, resumability, and sandbox
guarantees as every other write.

## Requirements

### Requirement: Extraction targets an equally named folder beside the archive

The system SHALL expose `POST /api/sf/vdirs/{vdirId}/extract` with a JSON
body naming a virtual path to a `.zip` archive, and SHALL extract it into a
folder in the archive's own directory whose name is the archive's name with
its `.zip` extension removed, case-insensitively (`docs/photos.zip` →
`docs/photos`). The request body MAY carry a `name` that overrides the
derived folder name. A successful request SHALL answer `202` with a job
object identifying itself and its target folder.

#### Scenario: Archive extracts into the adjacent folder

- **WHEN** `docs/photos.zip` is extracted through the vdir
- **THEN** the response is `202`, its job names `docs/photos` as the target, and after completion `docs/photos/` exists beside the archive

#### Scenario: Extension is matched case-insensitively

- **WHEN** `Backup.ZIP` is extracted
- **THEN** the target folder is `Backup` in the same directory

#### Scenario: The archive in the vdir root extracts at the root

- **WHEN** an archive at the vdir root is extracted
- **THEN** the target folder is created at the vdir root beside it

#### Scenario: A caller may override the folder name

- **WHEN** the request body names a target folder explicitly
- **THEN** that name is used instead of the derived one

#### Scenario: A non-archive or missing source is refused before work starts

- **WHEN** the path does not exist, is a directory, or is not a zip archive by content
- **THEN** the request fails with `404` for a missing path and `400` for a path that is not an archive, and nothing is written

#### Scenario: The archive is kept

- **WHEN** an extraction completes
- **THEN** the source archive still exists unmodified and no separate delete step is implied

### Requirement: A job reports progress and a terminal result

Every accepted extraction SHALL be observable at `GET
/api/sf/vdirs/{vdirId}/extract/{jobId}`, which SHALL return the job's
state, its phase (`scanning`, `extracting`, or `publishing`), the entry and
byte totals known so far, the counts completed, the entry currently being
written, and — once terminal — the resulting virtual path or a structured
error. A job SHALL end in exactly one terminal state: `succeeded`, `failed`,
or `canceled`.

#### Scenario: Progress advances while extracting

- **WHEN** an extraction of a multi-entry archive is polled repeatedly
- **THEN** the phase progresses from `scanning` to `extracting` to `publishing`, and the completed entry count and written bytes are monotonically non-decreasing

#### Scenario: A successful job names its result

- **WHEN** the job reaches `succeeded`
- **THEN** the snapshot reports the target virtual path and the final counts, including how many entries were skipped

#### Scenario: A failed job carries its reason

- **WHEN** the job reaches `failed`
- **THEN** the snapshot carries an error with a status code from the existing API error classes and a message, and the target folder does not exist

#### Scenario: Unknown or expired jobs are not found

- **WHEN** a job id that never existed, or one whose finished job was evicted, is polled
- **THEN** the response is `404`

### Requirement: An existing target is a conflict, never a merge

If the target folder already exists, extraction SHALL NOT start and SHALL
NOT merge into it, rename the archive, or invent a new name. The refusal
SHALL be reported as a conflict at request time, and the caller MAY repeat
the request with an explicit folder name.

#### Scenario: Existing folder blocks extraction

- **WHEN** `docs/photos.zip` is extracted while `docs/photos/` already exists
- **THEN** the request fails with `409`, the existing folder is untouched, and no extraction runs

#### Scenario: A supplied name resolves the conflict

- **WHEN** the caller repeats the request with a different target name
- **THEN** the extraction starts and publishes the folder under that name

#### Scenario: A concurrent extraction of the same archive conflicts

- **WHEN** a second extraction request targets the same archive and folder while the first is running
- **THEN** the second request fails with `409` rather than queueing behind the first

### Requirement: Entry paths are validated strictly and unsafe archives are refused

The system SHALL validate every archive entry name against strict rules
rather than the normalizing rules used for user-provided virtual paths: a
segment that is empty, `.`, or `..`; a name that is absolute or contains a
backslash or a NUL byte; a name that is not valid UTF-8; an entry that is a
symbolic link; or an entry that is encrypted SHALL fail the extraction.
Normalization SHALL NOT be applied — no entry may be silently rewritten to
a different path. A failure SHALL publish nothing and remove all partial
output.

#### Scenario: Traversal segments fail the archive

- **WHEN** an archive contains an entry named `../escape.txt` or `a/../../../escape.txt`
- **THEN** the job fails, nothing is published, and no path outside the target folder is created or modified

#### Scenario: A doubly-dotted segment inside the archive fails rather than normalizes

- **WHEN** an archive contains both `a/../b.txt` and `b.txt`
- **THEN** the job fails instead of collapsing both entries onto one path

#### Scenario: Absolute and hostile names fail the archive

- **WHEN** an entry is absolute (`/etc/x`), contains a backslash separator, or contains a NUL byte
- **THEN** the job fails and nothing is published

#### Scenario: Symlink entries never produce links

- **WHEN** an entry would be created as a symbolic link to any target
- **THEN** the job is refused and no link is created inside or outside the target folder

#### Scenario: Encrypted archives are refused explicitly

- **WHEN** the archive's entries are encrypted
- **THEN** the job fails with an explicit unsupported-archive error rather than an opaque decompression failure

#### Scenario: Refusal is reported, not silent

- **WHEN** an archive is refused for an unsafe entry
- **THEN** the failing job's error names the offending entry so the user can act on it

### Requirement: Cosmetic metadata entries are skipped, not refused

AppleDouble metadata (`__MACOSX/` contents and `._*` entries), `.DS_Store`,
and `Thumbs.db` SHALL be skipped during extraction and counted in the job's
skipped total. Skipping them SHALL NOT fail the archive, because an archive
produced by an operating system is routinely full of them.

#### Scenario: A macOS-created archive extracts

- **WHEN** an archive carrying a `__MACOSX/` tree and `.DS_Store` files is extracted
- **THEN** the job succeeds, the target folder contains the real members only, and the skipped count reports the metadata entries

#### Scenario: Skipped entries do not appear as members

- **WHEN** an extraction completes with skipped metadata entries
- **THEN** no `__MACOSX`, `.DS_Store`, or `Thumbs.db` path exists in the target folder

### Requirement: Resource ceilings bound the expansion

Extraction SHALL refuse to exceed a bounded entry count, a bounded path
depth, and a bounded total uncompressed size, enforced on bytes actually
inflated and entries actually created rather than on sizes an archive
declares about itself. Exceeding a ceiling SHALL fail the job and publish
nothing.

#### Scenario: Declared sizes are not trusted

- **WHEN** an archive declares small members but inflates far beyond the total bytes ceiling
- **THEN** the job stops at the ceiling, fails, and publishes nothing

#### Scenario: Entry-count ceiling

- **WHEN** an archive exceeds the entry-count ceiling
- **THEN** the job fails before creating more entries than the ceiling allows and publishes nothing

#### Scenario: Depth ceiling

- **WHEN** an entry exceeds the permitted path depth
- **THEN** the job fails and publishes nothing

### Requirement: Publication is atomic and never half-visible

Members SHALL be written into a hidden temporary directory in the
archive's directory, and the target folder SHALL appear only through a
single final publish step after the last member is written. No concurrent
listing SHALL observe a partially extracted folder under the target name,
and a failed or canceled job SHALL remove its temporary output.

#### Scenario: No partial folder is ever observable

- **WHEN** a large extraction is in progress and the parent directory is listed repeatedly
- **THEN** the target folder name never appears until the extraction has finished, and thereafter it appears complete

#### Scenario: Failure leaves nothing behind

- **WHEN** an extraction fails after writing many members
- **THEN** the target folder does not exist and no temporary directory remains in the parent

#### Scenario: Temporary output is not a browsable artifact

- **WHEN** the parent directory is listed during an extraction
- **THEN** no temporary extraction directory is presented as a member of the listing

### Requirement: Lost connections resume without duplicating or corrupting members

An extraction SHALL survive connection drops that are recoverable: the
member being read or written SHALL continue from the point it reached
rather than restarting the whole archive, and the completed folder's
contents SHALL be byte-identical to a clean extraction of the same
archive. Failures that exhaust the recovery budget SHALL fail the job
loudly and publish nothing.

#### Scenario: Disconnect mid-member resumes

- **WHEN** the SSH connection drops while a member is being written and reconnection succeeds
- **THEN** the job completes and every member's content matches the archive's entry data

#### Scenario: Repeated drops still converge

- **WHEN** the connection is dropped repeatedly at different points of one extraction
- **THEN** the job either completes with byte-identical output or fails without publishing, never with a truncated or duplicated member

### Requirement: A running extraction can be canceled

`DELETE /api/sf/vdirs/{vdirId}/extract/{jobId}` SHALL stop a running
extraction promptly, publish nothing, and remove its temporary output. The
request SHALL be idempotent: canceling a job that already ended SHALL
report its existing terminal state rather than failing.

#### Scenario: Cancel publishes nothing

- **WHEN** a running extraction is canceled
- **THEN** the job reports `canceled`, the target folder does not exist, and no temporary output remains

#### Scenario: Cancel after completion is a no-op

- **WHEN** a completed job is canceled
- **THEN** the response reports the job's existing terminal state and the published folder is untouched

### Requirement: Job state is in-process, bounded, and short-lived

Extraction jobs SHALL live only in the running server process: a restart
SHALL abandon them, leaving no published folder and no browsable remnant.
The number of concurrent running jobs SHALL be bounded, terminals jobs
SHALL be retained only long enough for a client to read the result and
SHALL then be evicted without affecting published output.

#### Scenario: Restart abandons a job

- **WHEN** the server restarts during an extraction
- **THEN** the target folder does not exist afterwards, the job id is unknown, and the archive is unchanged

#### Scenario: Concurrency is bounded

- **WHEN** extraction requests exceed the concurrent-job budget
- **THEN** the excess requests are refused with a retryable error rather than starting unbounded work

#### Scenario: Eviction keeps the result

- **WHEN** a finished job is evicted after its retention window
- **THEN** its published folder still exists and polling its id returns `404`
