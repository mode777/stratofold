# Spec Delta

## MODIFIED Requirements

### Requirement: Image entries open the in-app image viewer

The SPA SHALL open an image entry (classified by file extension) in an
in-app fullscreen image viewer that renders the image itself from the
file's plain `/files/<vdir-id>/<virtual-path>` URL (cookie-authenticated,
no auth token in the URL) as an immersive, edge-to-edge view, with
overlay chrome carrying the client-derived name, the file's size and
modified time, and a download action using that URL. An image the
browser cannot decode SHALL fall back to the metadata card for that
slide instead of a broken image frame. Tap and the context menu's open
action both lead to the viewer.

#### Scenario: Image entry opens the fullscreen viewer

- **WHEN** the user activates a browser-renderable image entry via tap or context menu
- **THEN** the fullscreen viewer shows that image edge-to-edge with its name and download action, and the former contained card layout is no longer shown

#### Scenario: Viewer exposes download

- **WHEN** the user activates the download action inside the viewer
- **THEN** the browser retrieves the file byte-exactly through the same `/files` URL

#### Scenario: Undecodable image falls back to metadata

- **WHEN** an image slide's bytes cannot be decoded by the browser (e.g. HEIC, DNG)
- **THEN** the metadata card with the download action is shown for that slide instead of a broken image

#### Scenario: Image load failure shows an explicit failure state

- **WHEN** an image slide's request fails (connection dropped or file removed)
- **THEN** a failure state with a retry action is shown for that slide rather than a silent blank view

#### Scenario: Anonymous visitor views an image on a public vdir

- **WHEN** a visitor without a session opens a public vdir's image entry
- **THEN** the fullscreen viewer renders the image through the public `/files` URL without a login prompt

## ADDED Requirements

### Requirement: The fullscreen viewer zooms and pans

The fullscreen viewer SHALL support pinch-to-zoom and a double-tap
zoom step, SHALL pan the image with a drag while it is zoomed (clamped
to the image bounds), and SHALL return the image to its
fit-to-screen state when the user moves to another image or leaves
the zoomed state.

#### Scenario: Pinch zooms the image

- **WHEN** the user pinches outward on the displayed image
- **THEN** the image zooms in following the pinch and can be panned while zoomed

#### Scenario: Double-tap toggles a zoom step

- **WHEN** the user double-taps the image
- **THEN** the image zooms to the next zoom step centered on the tap point, and a further double-tap returns it to fit-to-screen

#### Scenario: Pan is clamped while zoomed

- **WHEN** the user drags a zoomed image beyond its edge
- **THEN** the image stops at its bounds instead of dragging the interface away

#### Scenario: Zoom resets on image change

- **WHEN** the user moves to another image while the current one is zoomed
- **THEN** the newly shown image starts at fit-to-screen, not at the previous zoom state

### Requirement: The fullscreen viewer cycles through the folder's images

The viewer SHALL let the user swipe horizontally to move to the
previous or next image of the containing directory in the directory's
listing order, considering only image-kind entries; navigation SHALL
stop at the first and last image; the viewer's URL
(`/v/<vdir-id>/view/<path>`) SHALL track the image on screen so deep
links stay exact and back returns to the browse listing; and the
keyboard's arrow keys SHALL page through the images on pointer-capable
devices.

#### Scenario: Swipe moves to the neighboring image

- **WHEN** the user swipes left (or right) on an image that has a next (or previous) image in the directory
- **THEN** the adjacent image slides in and becomes the displayed image

#### Scenario: Navigation stops at the ends

- **WHEN** the user swipes past the first or last image of the directory
- **THEN** the view stays on that image and does not wrap around

#### Scenario: Non-image entries are skipped

- **WHEN** the containing directory holds files of other kinds or subdirectories between image entries
- **THEN** swiping moves directly between the image entries only

#### Scenario: Single-image directory cannot swipe

- **WHEN** the directory contains exactly one image entry
- **THEN** horizontal swipes do not navigate and the viewer stays on that image

#### Scenario: URL follows the gallery position

- **WHEN** the user swipes to another image
- **THEN** the viewer's URL names the newly displayed image, activating it opens the gallery at that image, and browser back returns to the browse listing

#### Scenario: A broken slide does not block the gallery

- **WHEN** the displayed slide shows its failure or metadata fallback and the user swipes
- **THEN** the adjacent image is shown as usual

#### Scenario: Arrow keys page through images

- **WHEN** the user presses the left or right arrow key while viewing an image on a pointer-capable device
- **THEN** the previous or next image is displayed as with a swipe

### Requirement: The fullscreen viewer uses dismissible overlay chrome

The viewer SHALL overlay minimal chrome above the image — back to the
browse listing, the file name, the image's position in the gallery,
and download — SHALL hide the chrome when the user taps the image and
re-show it on the next tap, and SHALL keep the image view itself
immersive (full-screen, dark) regardless of chrome visibility.

#### Scenario: Chrome toggles on image tap

- **WHEN** the user taps the displayed image
- **THEN** the overlay chrome hides if shown and reappears on the next tap, with the image remaining fullscreen

#### Scenario: Back returns to the listing

- **WHEN** the user activates the chrome's back control
- **THEN** the browse listing of the containing directory is shown again

#### Scenario: Position indicator tracks the gallery

- **WHEN** the user swipes to another image
- **THEN** the chrome's position indicator reflects the new image's place among the directory's images
