# Spec Delta

## ADDED Requirements

### Requirement: Upload items may target subdirectory paths

The upload manager SHALL accept items whose target is a full virtual
path beneath the enqueue directory (subdirectories included), with the
same ordering, dedupe-by-normalized-target, pause, cancel, and retry
semantics as flat uploads; a completed item SHALL report its published
full target path.

#### Scenario: A file enqueued with a subdirectory target lands there

- **WHEN** a file is enqueued with target path `photos/sub/a.jpg` under the browsed directory `docs`
- **THEN** the item uploads to that full virtual path and reports it as the published target

#### Scenario: Dedupe keys on the full target path

- **WHEN** two items are enqueued whose normalized target paths are equal and the first is still queued or running
- **THEN** only one upload to that target proceeds

### Requirement: Folder items create directories ahead of their contents

The upload manager SHALL accept folder items — directory creations run
through the API's parent-creating directory operation — that join the
same FIFO queue as uploads, so a folder item runs and completes before
any item whose target lies inside it. Folder items SHALL carry the
same lifecycle states and bounded retry as uploads and SHALL report no
byte progress, and an empty folder SHALL still be created.

#### Scenario: The folder is created before the files inside it

- **WHEN** a folder and the files inside it are enqueued together
- **THEN** the folder item completes before any of those files starts uploading

#### Scenario: An empty folder is still created

- **WHEN** an enqueued folder contains no files
- **THEN** its folder item runs and completes, creating the directory

#### Scenario: A retryable folder failure is retried within the bound

- **WHEN** a folder item fails with a retryable error
- **THEN** it is retried under the same bounded budget as uploads and never loops forever

#### Scenario: Folder items appear in the queue list

- **WHEN** folder items are queued
- **THEN** each appears in the upload manager's list alongside uploads with its lifecycle state and no byte progress

### Requirement: A folder item's terminal outcome applies to its pending dependents

Canceling or terminally failing a folder item SHALL move every
not-yet-started item whose target lies inside it to canceled or failed
(respectively) with the folder item's error, without starting them;
re-enqueueing a failed folder item SHALL re-enqueue its dependents that
failed by that carry-over, while items that failed on their own are
untouched.

#### Scenario: A terminal folder failure carries to its pending files

- **WHEN** a folder item fails with a permanent error while files inside it are still queued
- **THEN** those files are marked failed with that error and none of them starts

#### Scenario: Canceling a folder cancels its pending files

- **WHEN** a folder item is canceled while files inside it are still queued or paused
- **THEN** those files are marked canceled without starting

#### Scenario: Re-enqueueing a folder restores its carried failures

- **WHEN** a user re-enqueues a folder item that failed and whose files failed by the carry-over
- **THEN** the folder and those files run again from the beginning, and any file that failed on its own stays failed until separately retried
