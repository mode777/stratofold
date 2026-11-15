# Design

## Context

See `proposal.md` — Why. The relevant current state:

- `POST /api/sf/tokens` (`internal/vdirtokens/routes.go`) mints a
  `sf_v1_…` token and returns it, its vdir, role, hint, expiry, and
  last-use time. Nothing tells an app where the instance lives.
- `internal/authbridge` already treats a request as HTTPS when `r.TLS`
  is set or `X-Forwarded-Proto` equals `https` (ADR 0002 deployment
  guidance); there is no configured public URL.
- `@stratofold/client` requires `{ baseUrl, vdir, token }` and keeps the
  token header-only (ADR 0012/0013).
- The SPA's Connected apps one-time panel (`web/src/pages/AppsPage.tsx`)
  shows only the plaintext token.

## Goals / Non-Goals

**Goals:**

- Produce, transport, and parse one recognizable value that carries the
  three facts a client needs, without changing token storage, auth, or
  roles.
- Keep the token out of URLs, browser history, referrers, and
  server-side logs.
- Let the client recover from an embedded base URL that is wrong
  (reverse proxy change, instance moved) without re-minting the token.

**Non-Goals:**

- Registering a URL scheme or handling clicks from other apps.
- Storing, listing, or re-deriving a connection string after mint.
- Publishing the format as a server endpoint or embedding it in
  `/files` or `/s` links.
- Changing the web SPA to depend on `@stratofold/client`.

## Decisions

### D1 — Opaque prefixed base64url JSON, not a URL

**Decision:** The value is `sfconn_v1_` + unpadded base64url of the
compact JSON object
`{"v":1,"url":"https://host","vdir":"…","token":"sf_v1_…"}`. It is
recognizable by prefix, versioned at two levels (prefix and `v`), and
carries no delimiters that need escaping. The server and client both
reject anything that does not match exactly.

**Why:** A bearer secret must not travel as a URL. ADR 0012 makes
"tokens never appear in URLs" a durable invariant, and the client-library
spec already forbids the token in a URL, query, fragment, or body.
Putting the bundle in an `https://…#…` link would undercut both and
expose it to history sync, link previews, and accidental sharing. A
custom `stratofold://` scheme is still a URL, needs OS/app registration,
and behaves inconsistently in browsers.

**Rejected alternatives:**

- **URL with a fragment payload** — clickable, but the secret becomes a
  URL; conflicts with ADR 0012 and the client-library spec.
- **`stratofold://connect?…` custom scheme** — same URL exposure plus
  handler registration and inconsistent browser behavior.
- **Readable `sfconn_v1:url=…&vdir=…&token=…`** — inspectable, but
  percent-encoding and delimiter escaping invite truncation/corruption;
  base64url is shorter and copy/paste-safe.
- **Bare JSON or unprefixed base64** — no reliable recognition or
  version gate for error messages or future formats.

### D2 — The mint response is the only producer

**Decision:** Extend `handleMint` to add `connection_string` to the
existing `201` body. `internal/vdirtokens/connection.go` owns
`ConnectionPrefix`, the payload type, and
`EncodeConnectionString(baseURL, vdir, token)`. The plaintext token is
already in hand at that point; no second read, storage, or endpoint.

**Why:** One producer keeps the format in one language and makes it
available to every API caller, not just the SPA. Adding it in the web
client would mean a second encoder that could drift.

**Rejected alternatives:**

- **SPA-only composition from `window.location.origin`** — the browser
  origin is convenient, but programmatic mint callers get nothing and
  the web app and client package would each own half a format.
- **Both server and SPA** — two origins for the same value; the SPA
  would silently diverge from the API response.
- **New `POST /api/sf/connection-strings` route** — duplicates the
  one-time secret lifecycle and adds a route for no new capability.

### D3 — Derive the origin from the request, first forwarded value wins

**Decision:** `OriginFromRequest(r)` returns:

- scheme `https` when `r.TLS != nil` or the first comma-separated
  `X-Forwarded-Proto` value is `https`; otherwise `http`;
- host = the first comma-separated `X-Forwarded-Host` value when
  non-empty, otherwise `r.Host`;
- the origin is `scheme://host` with whitespace trimmed and no trailing
  slash, validated as an absolute URL with an authority and no
  credentials, path, query, or fragment.

If the origin cannot be built (empty host or invalid URL), the mint
still succeeds and omits `connection_string`. Generating the credential
must not fail because of a cosmetic origin problem.

**Why:** There is no configured public URL, and the deployment guide
already expects `X-Forwarded-Proto` behind a reverse proxy. Taking the
first value matches how proxies append to forwarded chains. Trusting
`X-Forwarded-Host` is acceptable here because the value only shapes the
response to the authenticated requester; it is never used for redirects,
cookies, or authorization.

**Rejected alternatives:**

- **Explicit `--public-url`/env setting** — more correct for complex
  proxies, but new configuration and deployment surface for a
  convenience value; the client can override the base URL.
- **`Host` only** — fails when a proxy rewrites `Host` to the backend.
- **RFC 7239 `Forwarded`** — not the convention used by this repo's
  deployment docs; supporting both would add parsing ambiguity.

### D4 — The client parses locally and offers a factory plus an override

**Decision:** New `client/src/connectionString.ts` exports
`parseConnectionString(value)` and the types. It validates the prefix,
base64url alphabet, JSON shape, `v === 1`, and a non-empty absolute
`http`/`https` origin, vdir, and token, throwing `ConfigurationError` on
any failure. `StratofoldClient.fromConnectionString(value, overrides?)`
reuses `parseConnectionString` and forwards `baseUrl`, `fetch`, and
`createXhr` overrides to the existing constructor. `index.ts` exports
both.

**Why:** The factory keeps the existing constructor contract intact and
makes the override explicit. Local parsing means no network request, no
round trip, and no chance of the full string being sent as a header or
body. `normalizeBaseUrl` keeps scheme/authority validation consistent,
with an origin-only guard on top because the producer emits no path.

**Rejected alternatives:**

- **Constructor overload** — `new StratofoldClient(string | options)`
  complicates typing and error messages for little gain.
- **Top-level `connect()`** — a second entry point that is easy to
  confuse with the class; a static factory is discoverable next to the
  constructor.
- **Server-side decoding endpoint** — would send the secret back to the
  server and defeat the point of a self-contained string.

### D5 — The one-time panel treats both values as secrets

**Decision:** `MintedToken` gains an optional `connection_string`.
`AppsPage` renders a second code block with its own copy state, only
when the field is present (older servers, origin unavailable), and
clears both values from state on dismiss. The token list never carries
it because the list route does not.

**Why:** The string contains the plaintext token. It gets the same
show-once lifecycle, and a missing field degrades gracefully rather than
blocking the token copy.

**Rejected alternatives:**

- **Replace the token block with the connection string** — breaks the
  existing flow for users who only need a bearer token.
- **Generate in the SPA when the field is missing** — would reintroduce
  a second producer and could embed a misleading origin.

### D6 — Test client parses and clears the pasted string

**Decision:** Add a connection-string input and apply action to
`client/test-client/index.html`/`main.ts`. On success, fill the existing
base URL, vdir, and token fields, save through the existing
local/session storage split, clear the input, and log the resulting
connection. On failure, show the configuration error and leave the
current fields untouched. The string itself is never stored.

**Why:** It is the runtime harness for the package and already has a
place to persist exactly these three fields. Reusing the parser proves
the format end to end without adding a second code path.

**Rejected alternatives:**

- **Store the connection string and parse on load** — persists a
  longer-lived secret than the existing token storage and complicates
  the "no secret in the deployed bundle" property.
- **Leave the test client unchanged** — the new public API would only be
  unit-tested, not exercised in the browser harness.

### D7 — Record the format as ADR 0016

**Decision:** Add `docs/decisions/0016-app-connection-strings.md` with
the format version, origin rule, no-URL invariant, and one-time
handling; index it. Because the roadmap reserved 0016/0017 for the
still-unwritten connect-flow/OAuth follow-ons, shift those references to
0017/0018 in the same docs pass. Update the client README, user and
hosting guides, architecture summary, and `AGENTS.md` pointers.

**Why:** The string is an interoperability contract between the server
and third-party apps; changing it later breaks consumers. That is
exactly the durable-decision test the ADR process exists for.

## Risks / Trade-offs

- **Stale embedded origin** (instance moved, proxy hostname changed) →
  the app can pass `baseUrl` to `fromConnectionString`, or mint a new
  token; docs call this out. The credential itself stays valid.
- **Reverse proxy omits forwarded headers** → the string embeds
  `http`/an internal host. Documented in `docs/hosting.md`; the client
  override is the escape hatch.
- **Connection string is a bearer secret** → shown once, never stored
  server-side or in the list, never logged, and never placed in a URL;
  the test client drops the pasted value after parsing.
- **Header spoofing changes the embedded origin** → affects only the
  authenticated requester's own response; no redirect, cookie, or auth
  decision reads these headers.
- **Payload growth/versioning** → the fixed prefix and `v` allow a
  future `sfconn_v2_` without guessing; decoders fail closed.
- **Copy/paste truncation** → the parser rejects malformed input with a
  configuration error rather than silently constructing a wrong client.

## Migration Plan

1. Ship the additive mint field and the client parser/factory together.
2. The SPA treats the field as optional, so it works against an older
   server and vice versa; no schema or data migration.
3. Rollback is removing the field/UI and keeping tokens unchanged;
   already-copied strings remain valid because they contain a normal
   bearer token.
