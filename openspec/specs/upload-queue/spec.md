# upload-queue Specification

## Purpose

The SPA's in-app upload manager: a queue that keeps uploading while the
user navigates, reports per-file progress, and exposes pause, cancel,
retry, and re-enqueue controls.

## Requirements

### Requirement: Uploads are queued and survive in-app navigation

The upload manager SHALL accept one or more files for a target
directory and run them independently of the view that started them, so
that navigating to another route or directory does not pause, cancel, or
lose an upload; only a page reload or tab close ends the queue.

#### Scenario: Enqueued upload starts without blocking the view

- **WHEN** the user selects one or more files to upload in a directory
- **THEN** each file is enqueued and uploading begins while the current view stays interactive

#### Scenario: Navigating away does not interrupt an upload

- **WHEN** an upload is running and the user navigates to another route or directory
- **THEN** the upload continues to completion and its result is recorded in the queue

#### Scenario: A reload ends the queue

- **WHEN** the page is reloaded or the tab is closed during an upload
- **THEN** the queue does not resume that upload afterward

### Requirement: Uploads are processed in enqueue order

The manager SHALL process queued uploads in the order they were
enqueued, and SHALL NOT start a later upload ahead of an earlier one
that is still queued.

#### Scenario: Ordering is preserved

- **WHEN** three files are enqueued in sequence
- **THEN** they start in that order

#### Scenario: Pausing the queue holds later items

- **WHEN** the queue is paused
- **THEN** no queued upload starts until the queue is resumed

### Requirement: Every upload reports progress and a lifecycle state

Each queued upload SHALL expose a lifecycle state of queued, running,
paused, completed, canceled, or failed, and while running SHALL report
progress as bytes sent against the total size; a completed upload SHALL
report the published target path and size.

#### Scenario: Progress advances during a large upload

- **WHEN** a large file uploads
- **THEN** its reported progress increases from zero toward the total before it completes

#### Scenario: Completion is reported

- **WHEN** an upload finishes successfully
- **THEN** its state is completed and it reports the target path and published size

#### Scenario: Failure is reported

- **WHEN** an upload cannot complete
- **THEN** its state is failed and the failure is visible in the queue

### Requirement: Uploads can be paused, canceled, and re-enqueued

The manager SHALL let the user pause the queue (no new upload starts),
resume it, and cancel an individual upload; canceling SHALL abort the
in-flight request and mark the item canceled, and re-enqueueing a
canceled or failed item SHALL restart it from byte zero. A canceled or
failed upload SHALL leave no file published at its target path.

#### Scenario: Cancel aborts and publishes nothing

- **WHEN** the user cancels a running upload
- **THEN** the request is aborted, the item is canceled, and no file exists at the target path

#### Scenario: Re-enqueue restarts from the beginning

- **WHEN** the user re-enqueues a canceled or failed upload
- **THEN** it runs again from byte zero and, on success, publishes the file

### Requirement: Failures distinguish retryable from permanent

The manager SHALL treat network failures and retryable API statuses as
retryable — offering or performing bounded retries — and SHALL treat
forbidden, not-found, invalid-request, and server-error statuses as
permanent: the item fails with the error surfaced and is not retried
automatically.

#### Scenario: Transient failure is retried or offered retry

- **WHEN** an upload fails with a network error or a retryable status
- **THEN** it is retried a bounded number of times or shown with an explicit retry action

#### Scenario: Permanent failure is not retried

- **WHEN** an upload fails with `403`, `404`, `400`, or `500`
- **THEN** the item is marked failed with the error surfaced and no further attempt is made automatically

### Requirement: A target path has at most one active upload

The manager SHALL NOT run two uploads to the same target path at once;
enqueueing a file whose target is already queued or running SHALL be
coalesced or rejected so a single upload results.

#### Scenario: Duplicate target is not uploaded twice

- **WHEN** the user enqueues the same target path while an upload to it is queued or running
- **THEN** only one upload to that target proceeds

### Requirement: Queue status is visible from every authenticated screen

The SPA SHALL present the upload manager's status on an Uploads
destination reachable from every authenticated screen, showing each item
and its state, and SHALL keep that status available as the user
navigates — including a floating progress indicator on other
destinations while uploads are active.

#### Scenario: Panel persists across navigation

- **WHEN** uploads are queued and the user moves between screens
- **THEN** the upload status remains available and reflects the current queue

#### Scenario: Active uploads are indicated elsewhere

- **WHEN** uploads are active and the user is not on the Uploads destination
- **THEN** a floating indicator shows that uploads are in progress and opens the Uploads destination when activated

#### Scenario: Active count is shown on the destination

- **WHEN** uploads are active
- **THEN** the Uploads destination indicates the number of active uploads

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
