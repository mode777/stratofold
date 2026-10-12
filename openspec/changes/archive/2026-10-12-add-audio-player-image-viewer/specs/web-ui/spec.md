# Spec Delta

## MODIFIED Requirements

### Requirement: Media files open in a new tab through /files URLs

The SPA SHALL open video and other non-audio media entries (e.g. mp4,
mov, webm, ogv) in a new browser tab at their plain
`/files/<vdir-id>/<virtual-path>` URL — the browser's native player
serves playback through HTTP Range requests and is not replaced by a
dedicated in-app player; no auth token appears in the URL. Audio
entries are excluded from this requirement: they open the in-app audio
player.

#### Scenario: Media entry opens a new tab

- **WHEN** the user activates a video entry (tap or context-menu open)
- **THEN** a new browser tab opens at the file's `/files` URL and the browser's native player takes over

#### Scenario: Native playback is served by Range requests

- **WHEN** media plays in the opened tab
- **THEN** the network log shows Range requests (`206`) against the file's `/files` URL

#### Scenario: Seeking issues further Range requests

- **WHEN** the user seeks within playing media in the opened tab
- **THEN** a new Range request at the seek offset is issued and playback continues from there

## ADDED Requirements

### Requirement: Audio entries open the in-app audio player

The SPA SHALL open an audio entry (classified by file extension) in an
in-app audio player instead of a new tab. The player SHALL stream the
file's plain `/files/<vdir-id>/<virtual-path>` URL through the
browser's audio element (cookie-authenticated, no auth token in the
URL), SHALL expose play/pause, a position scrubber with elapsed and
remaining time, ±15s skip controls, and a dismiss action returning to
the listing, and SHALL start playback only on an explicit user action.
Tap and the context menu's open action both lead to the player, and
the context menu's Download action remains available.

#### Scenario: Audio entry opens the player

- **WHEN** the user activates an audio entry via tap or context menu
- **THEN** the in-app audio player opens for that file without leaving the SPA and no new tab is opened

#### Scenario: Playback starts only on user action

- **WHEN** the player opens
- **THEN** playback is paused until the user activates play

#### Scenario: Controls drive the audio element

- **WHEN** the user toggles play/pause or activates a ±15s skip control
- **THEN** playback state and position follow the control and the scrubber and elapsed/remaining times track playback

#### Scenario: Scrubbing seeks by Range requests

- **WHEN** the user moves the scrubber to an unbuffered position
- **THEN** the audio element issues a Range request at that offset against the file's `/files` URL and playback continues from there

#### Scenario: Player exposes download

- **WHEN** the user activates the download action inside the player
- **THEN** the browser retrieves the file byte-exactly through the same `/files` URL

#### Scenario: Stream failure shows an explicit failure state

- **WHEN** the audio stream fails (connection dropped, file removed, or undecodable)
- **THEN** a failure state with a retry action is shown and playback does not silently hang

#### Scenario: Anonymous visitor plays audio on a public vdir

- **WHEN** a visitor without a session opens a public vdir's audio entry
- **THEN** the player renders and streams through the public `/files` URL without a login prompt

### Requirement: Image entries open the in-app image viewer

The SPA SHALL open an image entry (classified by file extension) in an
in-app image viewer that renders the image itself from the file's
plain `/files/<vdir-id>/<virtual-path>` URL (cookie-authenticated, no
auth token in the URL), shows the client-derived name, size, and
modified time, and offers a download action using that URL. An image
the browser cannot decode SHALL fall back to the metadata card with
its download action instead of a broken image frame. Tap and the
context menu's open action both lead to the viewer.

#### Scenario: Image entry renders inline

- **WHEN** the user activates a browser-renderable image entry via tap or context menu
- **THEN** the viewer shows the image itself together with the file's name and metadata

#### Scenario: Viewer exposes download

- **WHEN** the user activates the download action inside the viewer
- **THEN** the browser retrieves the file byte-exactly through the same `/files` URL

#### Scenario: Undecodable image falls back to metadata

- **WHEN** an image entry's bytes cannot be decoded by the browser (e.g. HEIC, DNG)
- **THEN** the metadata card with the download action is shown instead of a broken image

#### Scenario: Image load failure shows an explicit failure state

- **WHEN** the image request fails (connection dropped or file removed)
- **THEN** a failure state with a retry action is shown rather than a silent blank view

#### Scenario: Anonymous visitor views an image on a public vdir

- **WHEN** a visitor without a session opens a public vdir's image entry
- **THEN** the viewer renders the image through the public `/files` URL without a login prompt
