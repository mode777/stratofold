# Spec Delta

## REMOVED Requirements

### Requirement: Media files open in a new tab through /files URLs

**Reason**: Video is the only remaining media kind without an in-app
view. It now opens the in-app video player (see the added requirements);
the browser's native player remains reachable through the context menu's
open-in-new-tab action.

**Migration**: Use "Video entries open the in-app video player" and "The
in-app video player exposes transport controls" below. Audio and image
behavior is unchanged and already pinned by their own requirements; the
open-in-new-tab action keeps the old `/files` URL reachable.

### Requirement: Non-media files open a preview screen

**Reason**: The requirement's media exception ("media files SHALL
continue to open in a new tab") is no longer true: audio, images, and
video all have in-app views. The remaining metadata-preview behavior is
restated under a clearer name.

**Migration**: Use "Files without an in-app view open a preview screen"
below; the metadata preview, download action, and directory-derived
fields are unchanged.

## ADDED Requirements

### Requirement: Files without an in-app view open a preview screen

The SPA SHALL open a preview screen for a file entry that has no in-app
player or viewer (currently files other than audio, images, and video),
showing its name, size, and modification time derived from the directory
listing and offering a download action. Audio, image, and video entries
SHALL open their respective in-app player or viewer instead of the
metadata-only preview.

#### Scenario: Preview shows listed metadata

- **WHEN** the user activates a file entry without an in-app view
- **THEN** a preview screen shows the file's name, size, and modification time and offers download

#### Scenario: Media opens its in-app view

- **WHEN** the user activates an audio, image, or video entry
- **THEN** the matching in-app player or viewer opens instead of the metadata-only preview screen

### Requirement: Video entries open the in-app video player

The SPA SHALL open a video entry (classified by file extension) at
`/v/<vdir-id>/view/<virtual-path>` in an in-app video player instead of a
new browser tab. The player SHALL stream the file's plain
`/files/<vdir-id>/<virtual-path>` URL through a native video element,
cookie-authenticated with no auth token in the URL, and SHALL start
paused until the user plays it.

#### Scenario: Tapping a video opens the player

- **WHEN** the user activates a video entry by tap, grid tile, or the context menu's Open action
- **THEN** the in-app video player opens for that file without leaving the SPA and no new tab is opened

#### Scenario: Playback starts only on user action

- **WHEN** the player opens
- **THEN** playback is paused until the user activates play

#### Scenario: Local playback uses the plain /files URL

- **WHEN** the player streams the video
- **THEN** the request targets the file's `/files` URL with no token in it and the browser's Range requests (`206`) serve seeking

#### Scenario: The raw file stays reachable in a new tab

- **WHEN** the user chooses open in new tab from the context menu of a video entry
- **THEN** a new browser tab opens at the file's `/files` URL

#### Scenario: Anonymous visitor plays video on a public vdir

- **WHEN** a visitor without a session opens a public vdir's video entry
- **THEN** the player renders and streams through the public `/files` URL without a login prompt

### Requirement: The in-app video player exposes transport controls

The player SHALL offer play/pause, a position scrubber with elapsed and
remaining time, volume/mute, fullscreen, a download action, and the
preview screen's back control, and SHALL show a retryable failure state
when the stream fails.

#### Scenario: Controls drive the video element

- **WHEN** the user toggles play/pause, seeks, changes volume, or enters fullscreen
- **THEN** the video element's state follows the control and the scrubber and times track playback

#### Scenario: Scrubbing seeks by Range requests

- **WHEN** the user moves the scrubber to an unbuffered position
- **THEN** the video element issues a Range request at that offset against the file's `/files` URL and playback continues from there

#### Scenario: Player exposes download

- **WHEN** the user activates the download action inside the player
- **THEN** the browser retrieves the file byte-exactly through the same `/files` URL

#### Scenario: Back returns to the listing

- **WHEN** the user activates the player's back control
- **THEN** the browse listing of the file's containing directory is shown

#### Scenario: Stream failure shows an explicit failure state

- **WHEN** the video stream fails (connection dropped, file removed, or undecodable container)
- **THEN** a failure state with a retry action is shown and playback does not silently hang
