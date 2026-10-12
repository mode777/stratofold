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
