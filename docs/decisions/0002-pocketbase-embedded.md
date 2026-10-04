# 0002 — PocketBase is the embedded application framework

Status: Accepted (2026-10)

## Context

The vision wants resource and user administration "for free" and flags two
risks: PocketBase authenticates with bearer tokens while the file server
needs browser-native access (`<img>`, `<video>`, direct downloads), and
PocketBase's HTTP server defaults could kill long-running streams. Both had
to be answerable before committing.

## Decision

Embed [PocketBase](https://pocketbase.io) as a Go library (not a separate
process). Users, connections, virtual directories and shares are PocketBase
collections with API rules. Custom endpoints live under `/api/sf/*`
(PocketBase itself owns `/api/files/*` for record attachments — do not
collide). The cookie question is resolved with a session bridge:

- A custom auth route performs PocketBase authentication and additionally
  sets an HttpOnly `sf_session` cookie containing the PocketBase auth token.
- The `/files/*` middleware validates that cookie in-process against
  PocketBase (`apis.FindAuthRecordByToken`); public virtual directories
  skip it.
- Streaming routes (`/files/*`, upload) clear per-request read/write
  deadlines via `http.NewResponseController`; server-level timeouts are set
  generously there. The PocketBase default-timeout worry is thus a
  configuration task, not a blocker.

## Consequences

Users, admin UI, password reset, REST-with-rules and token refresh come out
of the box in the same binary. Accepted costs: framework upgrades are app
upgrades (pin and bump deliberately), and custom middleware must not fight
PocketBase's router — all filesystem endpoints use the `/api/sf/` namespace.

## Rejected alternatives

- Plain `chi` + hand-rolled auth/users/admin: reinventing what PocketBase
  provides was the largest early-project risk.
- Token in `Authorization` header for `/files/*`: breaks native browser
  element loading and shareable links.
- Basic auth on `/files/*`: no expiry/revocation, poor mobile UX.
