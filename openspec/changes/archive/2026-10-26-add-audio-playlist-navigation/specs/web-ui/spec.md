# Spec Delta

## MODIFIED Requirements

### Requirement: Audio entries open the in-app audio player

The SPA SHALL open an audio entry (classified by file extension) in an
in-app audio player instead of a new tab. The player SHALL stream the
file's plain `/files/<vdir-id>/<virtual-path>` URL through the
browser's audio element (cookie-authenticated, no auth token in the
URL), SHALL expose play/pause, a position scrubber with elapsed and
remaining time, ±15s skip controls, skip-next and skip-previous over the
containing folder's audio entries, and a dismiss action returning to
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

## ADDED Requirements

### Requirement: Audio playback follows the containing folder's queue

The player SHALL derive a queue from the containing directory's audio
entries in the listing order the browse view shows, excluding
directories and non-audio files. Skip next and skip previous SHALL move
to the adjacent queue entry and SHALL wrap around at both ends. A track
change SHALL update the stream source, title, scrubber, timing readout,
and download action to the selected track, and SHALL NOT add history
entries, so browser back still returns to the browse listing.

#### Scenario: Next and previous move through the folder

- **WHEN** the user activates skip next or skip previous on a track in a folder with other audio files
- **THEN** the player selects the adjacent audio entry in listing order and streams that file

#### Scenario: Queue contains only the folder's audio entries

- **WHEN** the player builds its queue for a folder
- **THEN** subdirectories, non-audio files, and audio files in other directories are excluded

#### Scenario: Navigation wraps at both ends

- **WHEN** the user activates skip next on the last queued track or skip previous on the first
- **THEN** the player selects the first or last queued track respectively

#### Scenario: Manual skip preserves the play/pause state

- **WHEN** the user activates skip next or skip previous while playback is paused, or while it is playing
- **THEN** the player stays paused on the new track, or continues playing it, respectively

#### Scenario: Browser back returns to the listing

- **WHEN** the user has skipped through several tracks and then activates browser back or the player's dismiss action
- **THEN** the browse listing of the folder is shown instead of the previously played track

#### Scenario: Track change updates the whole player surface

- **WHEN** the selected track changes
- **THEN** the title, stream URL, scrubber position, elapsed/remaining times, and download target all refer to the newly selected track

### Requirement: The audio player advances through the folder automatically

When playback of a track reaches its end, the player SHALL select the
next queued track and start playing it without further user action,
wrapping from the last queued track to the first. If the browser
refuses the automatic start, the player SHALL present the next track
paused rather than a stream failure.

#### Scenario: End of track continues with the next track

- **WHEN** a track plays to its end and another queued track follows
- **THEN** the player selects the next track and begins playing it

#### Scenario: End of the last track wraps to the first

- **WHEN** the last queued track plays to its end
- **THEN** the player selects the first queued track and begins playing it

#### Scenario: A refused automatic start is not a failure

- **WHEN** the browser blocks the automatic playback of the next track
- **THEN** that track is shown paused and no stream failure state is reported

### Requirement: The audio player shows folder-derived cover art

The player SHALL display the first image entry of the containing
directory, in listing order, as the cover art in place of the
placeholder icon. When the folder has no image entry, or the chosen
image cannot be loaded or decoded, the player SHALL keep the existing
music-icon placeholder and SHALL NOT report a stream failure. Cover art
SHALL load through the same `/files` URL rules as the rest of the UI,
so public-vdir visitors see it without a session.

#### Scenario: Folder image becomes the cover

- **WHEN** the player opens a track whose folder contains one or more image entries
- **THEN** the first image entry in listing order is displayed as the cover art

#### Scenario: Folders without an image keep the placeholder

- **WHEN** the player opens a track whose folder contains no image entry
- **THEN** the music-icon placeholder is shown and no image request is made

#### Scenario: A broken cover falls back silently

- **WHEN** the chosen cover image fails to load or decode
- **THEN** the music-icon placeholder is shown and playback is unaffected

#### Scenario: Public visitors see the cover

- **WHEN** a visitor without a session opens a public vdir's audio entry in a folder with an image
- **THEN** the cover art loads through the public `/files` URL without a login prompt
