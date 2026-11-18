# Spec Delta

## REMOVED Requirements

### Requirement: Entry paths are validated strictly and unsafe archives are refused
**Reason**: The fail-the-whole-archive consequence is reversed by this
change: per-entry problems now skip and count the entry while the
extraction completes. The validation rules themselves stay strict and
non-normalizing; only the consequence changed, so the requirement (whose
text and scenarios state whole-archive refusal) is replaced wholesale by
"Entry paths are validated strictly and unsafe entries are skipped" rather
than edited in place — its scenarios assert job failure, which no longer
happens.
**Migration**: None. Externally observable behavior changes by design:
extractions that previously failed now succeed with invalid entries
skipped, counted, and reported in the job snapshot.

## MODIFIED Requirements

### Requirement: A job reports progress and a terminal result

Every accepted extraction SHALL be observable at `GET
/api/sf/vdirs/{vdirId}/extract/{jobId}`, which SHALL return the job's
state, its phase (`scanning`, `extracting`, or `publishing`), the entry and
byte totals known so far, the counts completed, the entry currently being
written, and — once terminal — the resulting virtual path or a structured
error. A job SHALL end in exactly one terminal state: `succeeded`,
`failed`, or `canceled`. Skipped entries SHALL be counted by kind —
cosmetic metadata separately from invalid entries — and a terminal
snapshot SHALL carry a bounded sample of the skipped invalid entry names
with a machine-readable reason for each.

#### Scenario: Progress advances while extracting

- **WHEN** an extraction of a multi-entry archive is polled repeatedly
- **THEN** the phase progresses from `scanning` to `extracting` to `publishing`, and the completed entry count and written bytes are monotonically non-decreasing

#### Scenario: A successful job names its result

- **WHEN** the job reaches `succeeded`
- **THEN** the snapshot reports the target virtual path and the final counts, including how many entries were skipped

#### Scenario: Invalid skips are distinguishable from metadata skips

- **WHEN** an archive carrying cosmetic metadata and invalid entries is extracted to completion
- **THEN** the snapshot reports the metadata-skip count and the invalid-skip count separately, and names a bounded sample of the invalid entries with a reason class each

#### Scenario: A failed job carries its reason

- **WHEN** the job reaches `failed`
- **THEN** the snapshot carries an error with a status code from the existing API error classes and a message, and the target folder does not exist

#### Scenario: Unknown or expired jobs are not found

- **WHEN** a job id that never existed, or one whose finished job was evicted, is polled
- **THEN** the response is `404`

### Requirement: Resource ceilings bound the expansion

Extraction SHALL refuse to exceed a bounded entry count and a bounded total
uncompressed size, enforced on bytes actually inflated and entries actually
read from the archive directory rather than on sizes an archive declares
about itself; exceeding either SHALL fail the job and publish nothing.
Every central-directory entry SHALL count toward the entry-count ceiling
whether or not it is later skipped. The path-depth bound SHALL be enforced
per entry: an entry deeper than the bound SHALL be skipped and counted as
invalid while the rest of the archive extracts.

#### Scenario: Declared sizes are not trusted

- **WHEN** an archive declares small members but inflates far beyond the total bytes ceiling
- **THEN** the job stops at the ceiling, fails, and publishes nothing

#### Scenario: Entry-count ceiling

- **WHEN** an archive exceeds the entry-count ceiling
- **THEN** the job fails before extracting more entries than the ceiling allows and publishes nothing

#### Scenario: Skipped entries still count toward the entry ceiling

- **WHEN** an archive whose entries are mostly invalid exceeds the entry-count ceiling
- **THEN** the job fails at the ceiling exactly as it would with valid entries

#### Scenario: Depth ceiling

- **WHEN** an entry's path is deeper than the permitted depth
- **THEN** that entry is skipped and counted as invalid, and the rest of the archive extracts and publishes

## ADDED Requirements

### Requirement: Entry paths are validated strictly and unsafe entries are skipped

The system SHALL validate every archive entry name against strict rules
rather than the normalizing rules used for user-provided virtual paths: a
segment that is empty, `.`, or `..`; a name that is absolute, contains a
backslash or a NUL byte, or is not valid UTF-8; an entry that is a symbolic
link, is encrypted, uses an unsupported compression method, or is deeper
than the depth bound. An entry name ending in exactly one `/` is the zip
convention for a directory entry and SHALL be accepted. Normalization SHALL
NOT be applied — no entry may be silently rewritten to a different path. An
invalid entry SHALL be skipped, never written: it SHALL be counted and
reported as skipped invalid, and the extraction SHALL continue with the
remaining entries. An invalid entry SHALL NOT fail the job unless nothing
can be extracted at all.

#### Scenario: Traversal segments are skipped, not extracted

- **WHEN** an archive contains an entry named `../escape.txt` or `a/../../../escape.txt` alongside safe entries
- **THEN** the job completes, the safe entries are published, no path outside the target folder is created or modified, and the traversal entry is counted and named as skipped invalid

#### Scenario: A doubly-dotted segment is skipped rather than normalized

- **WHEN** an archive contains both `a/../b.txt` and `b.txt`
- **THEN** only `b.txt` is published, `a/../b.txt` is skipped and counted as invalid, and no two entries ever collapse onto one path

#### Scenario: Directory entries named with a trailing slash extract

- **WHEN** an archive contains a directory entry named `POLY_SurvivalWorkshop/` or nested `docs/2026/` — the zip convention for directories
- **THEN** those directories are created in the target folder and the trailing slash is not treated as an empty segment

#### Scenario: Absolute and hostile names are skipped

- **WHEN** an entry is absolute (`/etc/x`), contains a backslash separator, or contains a NUL byte
- **THEN** that entry is skipped and counted as invalid, nothing is written for it, and the rest of the archive extracts

#### Scenario: Symlink entries never produce links

- **WHEN** an entry would be created as a symbolic link to any target
- **THEN** the entry is skipped and counted as invalid, and no link is created inside or outside the target folder

#### Scenario: Encrypted and unsupported entries are skipped beside decodable ones

- **WHEN** an archive mixes plaintext entries with encrypted entries or entries using an unsupported compression method
- **THEN** the decodable entries are published, and each undecodable entry is skipped, counted, and reported with its reason

#### Scenario: Skips are reported, not silent

- **WHEN** an extraction completes with entries skipped as invalid
- **THEN** the terminal snapshot carries the invalid-skip count and a bounded sample of the skipped entry names, each with a machine-readable reason, so the user can act on them

### Requirement: Undecodable member data skips the member

A member whose stored data cannot be decoded while it is being written —
a checksum mismatch or a read failure of the member's own data — SHALL be
skipped: any partially written file for that member SHALL be removed from
the temporary output before the job continues, the member SHALL be counted
and reported as skipped invalid, and the extraction SHALL complete with
the remaining members. No truncated member SHALL ever be published.

#### Scenario: A checksum-broken member is skipped

- **WHEN** an archive contains one member whose stored data fails its checksum beside intact members
- **THEN** the job succeeds, the broken member is absent from the published folder and reported as skipped invalid, and every other member is byte-identical to its entry data

#### Scenario: No partial file survives the skip

- **WHEN** a member fails partway through being written
- **THEN** its partially written file is removed from the temporary output before the next member starts, and the published folder contains no truncated file for it

### Requirement: An extraction that extracts nothing fails explicitly

If an extraction would publish no member — every non-cosmetic entry was
skipped as invalid, or the archive holds only cosmetic metadata — the job
SHALL fail with an explicit error naming why nothing could be extracted,
report the skip counts it gathered, and publish nothing. An empty folder
SHALL NOT be presented as a successful result.

#### Scenario: A fully encrypted archive fails explicitly

- **WHEN** every non-cosmetic entry of an archive is encrypted
- **THEN** the job fails with an error naming encryption as the reason, the invalid-skip counts are still reported, and no folder is published

#### Scenario: An archive of only invalid entries fails

- **WHEN** every non-cosmetic entry fails validation
- **THEN** the job fails, the skip details name the offending entries, and nothing is published

#### Scenario: A cosmetic-only archive is not an empty success

- **WHEN** an archive contains only cosmetic metadata entries
- **THEN** the job fails with an explicit error and no folder is published
