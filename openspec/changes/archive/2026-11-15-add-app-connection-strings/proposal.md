# Proposal

## Why

Connecting an app today means copying three separate facts — the server
URL, the vdir id, and the bearer token — from a screen that only surfaces
the token. App authors routinely get one of them wrong, and the client
library still requires assembling them by hand. A single copyable
connection string makes "connect an app" one paste and lets
`@stratofold/client` construct itself from exactly the credential the
user minted.

## What Changes

- `POST /api/sf/tokens` additionally returns a one-time
  `connection_string` that bundles the request's external server origin,
  the token's vdir id, and the plaintext token.
- The connection string is an opaque, versioned, URL-safe value
  (`sfconn_v1_…`) containing a base64url JSON payload — deliberately not
  a URL, so the existing "tokens never appear in URLs" invariant holds.
- Settings → Connected apps shows the connection string in the same
  one-time panel as the token, with its own copy action; it is never
  stored or listed again.
- `@stratofold/client` gains `StratofoldClient.fromConnectionString(...)`
  and an exported `parseConnectionString(...)` that validate the value
  locally, never send the connection string anywhere, and allow explicit
  overrides (for example a corrected base URL).
- The static test client accepts a pasted connection string and fills
  its base URL, vdir, and token fields from it.
- The server derives the embedded origin from the request: HTTPS from
  TLS or `X-Forwarded-Proto`, host from `X-Forwarded-Host` or `Host`.
- **BREAKING**: none. The mint response is additive; existing clients
  ignore the new field, and the token format and auth behavior are
  unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vdir-access-tokens`: mint returns an app connection string, defines
  its versioned opaque shape, origin derivation, and one-time handling.
- `client-library`: connection-string parsing/configuration factory and
  test-client support for pasted connection strings.
- `web-ui`: the Connected apps one-time panel presents and copies the
  connection string.

## Impact

- **Server**: `internal/vdirtokens` mint response plus a connection-string
  helper and route tests. No schema, route, or token-auth change.
- **Client package**: `client/src/client.ts`, `types.ts`, `index.ts`,
  unit tests, README walkthrough, and the IIFE/package smoke checks.
- **Test client**: `client/test-client` connection form, config
  persistence, and tests.
- **Web UI**: `web/src/lib/tokensApi.ts` and
  `web/src/pages/AppsPage.tsx` plus component tests.
- **Docs**: ADR **`docs/decisions/0016-app-connection-strings.md`** (new;
  the format and origin-derivation rule are a durable interoperability
  contract) and its index row; `docs/roadmap.md` (add this additive
  follow-on and shift the still-unwritten connect-flow/OAuth ADR
  numbers), `client/README.md`, `docs/using-stratofold.md`,
  `docs/hosting.md`, `docs/architecture.md`, and `AGENTS.md` updated
  where they describe app tokens or the client.
- **Non-goals**: no URL/deep-link or QR form, no server-side storage of
  connection strings, no way to re-display one after the mint panel is
  dismissed, no token rotation/reissue flow, no change to token roles,
  expiry, revocation, or auth resolution, and no `@stratofold/client`
  dependency added to the web SPA.
