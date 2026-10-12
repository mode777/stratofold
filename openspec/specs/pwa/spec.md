# pwa Specification

## Purpose

The installability contract for the Stratofold browser SPA: it can be
installed from a supporting browser and launched as a standalone app,
with a proper name, launcher icons, and theme — while deliberately
providing no offline capability.

## Requirements

### Requirement: The SPA is installable from a supporting browser

The shell served at the site root SHALL link a web app manifest that is
reachable on the same origin and includes the members browsers require
for installability: a `name` or `short_name`, icons at 192px and 512px,
a `start_url`, a `display` mode, and no `prefer_related_applications`
opt-in; the app SHALL be served over a secure context (HTTPS or
localhost). The manifest SHALL be served as a JSON content type and
SHALL NOT be answered by the client-route fallback.

#### Scenario: The manifest is linked and fetchable

- **WHEN** a browser loads the SPA shell and follows its manifest link
- **THEN** the manifest is returned with `200` and a JSON content type

#### Scenario: The manifest carries the required members

- **WHEN** the served manifest is parsed
- **THEN** it declares a name, a `start_url`, a `display` mode, no `prefer_related_applications` opt-in, and icons at both 192px and 512px

#### Scenario: A supporting browser offers installation

- **WHEN** the app is visited over a secure context in a supporting browser
- **THEN** the browser treats it as installable and promotes installation

### Requirement: An installed app launches standalone at the app root

The manifest SHALL request a standalone display mode and SHALL scope the
app to the site root with a root `start_url`, so an installed app opens
without browser UI and treats all app routes as in scope.

#### Scenario: Launch opens standalone at the root

- **WHEN** the installed app is launched from the home screen or dock
- **THEN** it opens at the site root without browser chrome

#### Scenario: Client routes stay in scope

- **WHEN** the user navigates to an application route after launching
- **THEN** the app remains in standalone display and does not fall back to a browser tab

### Requirement: The installed app has a name, theme, and launcher icons

The manifest SHALL provide the app name and short name, a theme color and
background color consistent with the app's visual design, and launcher
icons in the sizes and purposes platforms use, including a 512px
`maskable` icon and an `apple-touch-icon` for iOS.

#### Scenario: The install prompt shows the app identity

- **WHEN** the browser presents its install prompt
- **THEN** the app name and a launcher icon are shown

#### Scenario: Maskable icon is available

- **WHEN** a platform requests a maskable launcher icon
- **THEN** a 512px icon declared with the `maskable` purpose is available

#### Scenario: iOS home-screen icon is available

- **WHEN** the user adds the app to the home screen on iOS
- **THEN** the declared `apple-touch-icon` is used as the app icon

### Requirement: iOS home-screen install launches standalone

The shell SHALL include the iOS web-app metadata needed for Add to Home
Screen: an `apple-touch-icon`, a web-app-capable marker, an app title,
and a status-bar style, so the installed app launches without Safari UI.

#### Scenario: iOS Add to Home Screen launches standalone

- **WHEN** a user installs the app from Safari's Add to Home Screen and launches it
- **THEN** it opens without Safari's browser UI using the declared app title and icon

### Requirement: An in-app install affordance appears only when installable

The Settings screen SHALL offer an install action only while the browser
signals that the app can be installed; activating it SHALL open the
browser's native install prompt, and the action SHALL NOT be shown when
the browser offers no install prompt (for example on iOS or when the app
is already installed).

#### Scenario: Install action appears when installation is offered

- **WHEN** the browser signals that the app can be installed
- **THEN** the Settings screen shows an install action

#### Scenario: Activating install opens the browser prompt

- **WHEN** the user activates the install action
- **THEN** the browser's native install prompt is shown

#### Scenario: No false install affordance

- **WHEN** the browser cannot install the app or the app is already installed
- **THEN** no install action is offered

### Requirement: The app provides no offline capability

The SPA SHALL NOT register a service worker and SHALL NOT cache
application, API, or file responses; an installed app without network
connectivity SHALL show the app's normal failure states rather than
stale or cached content.

#### Scenario: No service worker is registered

- **WHEN** the app loads and is used
- **THEN** no service worker is registered and no responses are served from a cache

#### Scenario: Offline use fails normally

- **WHEN** an installed app is opened or used without network connectivity
- **THEN** the normal network-failure states are shown and no stale content is presented
