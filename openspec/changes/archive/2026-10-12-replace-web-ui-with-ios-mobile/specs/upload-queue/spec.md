# Spec Delta

## MODIFIED Requirements

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
