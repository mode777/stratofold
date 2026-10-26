# Spec Delta

## ADDED Requirements

### Requirement: Video playback offers Cast to a default media receiver

The SPA SHALL offer a Cast action on the video player where the browser
exposes the Cast Web Sender SDK over a secure context. Activating it
SHALL connect a Cast session to the selected device and load the video
into the Default Media Receiver. The action SHALL be absent — not
disabled — when casting is unsupported, and local playback SHALL pause
while the video is casting.

#### Scenario: A supported browser shows the Cast action

- **WHEN** the video player renders in Chromium over a secure context with the Cast SDK available
- **THEN** the player offers a Cast action

#### Scenario: Unsupported browsers show no action

- **WHEN** the video player renders where the Cast SDK is unavailable (Safari, Firefox, iOS Chrome, an insecure context, or a blocked SDK)
- **THEN** no Cast action is shown and local playback is unaffected

#### Scenario: Casting loads the video on the device

- **WHEN** the user selects a Cast device from the picker
- **THEN** the session connects and the selected video loads on that device's Default Media Receiver

#### Scenario: Local playback pauses while casting

- **WHEN** the video starts casting
- **THEN** local playback pauses and the player indicates that playback is on the device

### Requirement: Cast media URLs are session-free

A cast load SHALL use a URL the receiver can fetch without a session: for
a signed-in user the SPA SHALL mint a fresh 24-hour file link and pass its
absolute `/s/<token>` URL; for an anonymous visitor of a public vdir it
SHALL pass the file's plain absolute `/files/<vdir-id>/<virtual-path>`
URL. The local `<video>` source SHALL remain the plain `/files` URL and
SHALL never carry the token.

#### Scenario: Signed-in casting uses a temporary link

- **WHEN** a signed-in user casts a video
- **THEN** the app mints a file link and loads its absolute `/s/<token>` URL on the receiver

#### Scenario: Public anonymous casting uses the plain URL

- **WHEN** an anonymous visitor casts a video on a public vdir
- **THEN** the receiver loads the file's plain absolute `/files` URL and no link is minted

#### Scenario: The local player never carries the token

- **WHEN** the video is casting
- **THEN** the local `<video>` source remains the plain `/files` URL with no token

#### Scenario: The receiver fetches without a session

- **WHEN** the receiver requests the cast media URL
- **THEN** the request carries no session cookie and the media is served (or rejected) solely by the selected URL

### Requirement: Cast requests identify the media

The cast load SHALL carry the content type associated with the video's
extension and the file name as the media title, so the receiver can
select a player and show the title.

#### Scenario: The receiver gets the content type and title

- **WHEN** a video is cast
- **THEN** the load request carries that video's content type and its file name as the title

#### Scenario: An unsupported container fails explicitly

- **WHEN** the receiver cannot decode the video's container or codecs
- **THEN** the SPA reports that the video cannot be played on the device rather than appearing to cast successfully

### Requirement: The Cast session survives navigation and is stoppable

An active Cast session SHALL survive in-app navigation. While a session
is connected the SPA SHALL show a casting indicator naming the device
with a stop action. Stopping or disconnecting SHALL end playback on the
device and leave local playback paused.

#### Scenario: Navigating away keeps casting

- **WHEN** the user starts casting and navigates to another in-app screen
- **THEN** the cast continues and the indicator remains available

#### Scenario: The user can stop casting in-app

- **WHEN** the user activates the stop action
- **THEN** the session ends, the device stops playing, and local playback is paused

#### Scenario: A device-side disconnect clears the state

- **WHEN** the device ends the session or the connection drops
- **THEN** the indicator clears and local playback remains paused

### Requirement: Cast failures are explicit

The SPA SHALL report a cast failure without claiming success: a cancelled
picker or no available device, a failed link mint (retryable), an
unreachable media URL, and a receiver load or decode failure SHALL each
leave local playback usable and surface the failure to the user.

#### Scenario: A failed link mint is retryable

- **WHEN** the video link mint fails while casting
- **THEN** the player shows a retryable failure and no media is reported as casting

#### Scenario: No device is not a success

- **WHEN** the user opens the device picker and cancels or no device is available
- **THEN** the player reports that nothing is casting and local playback remains available

#### Scenario: A receiver load failure is visible

- **WHEN** the receiver rejects the media URL or cannot decode the video
- **THEN** the player shows an explicit cast failure and local playback remains usable
