# 0016 — App connection strings are opaque prefixed values

Status: Accepted (2026-11, change `add-app-connection-strings`)

## Context

A Stratofold app token is useful only with three facts: the instance
origin, the vdir id, and the plaintext token. The mint screen and API
returned the token while the other two had to be copied separately, so
setup errors were common. The client package still required assembling
the three values by hand.

The durable constraints are [ADR 0012](0012-vdir-access-tokens.md)'s
"tokens never appear in URLs" rule and the client-library requirement
that the server address be explicit, never inferred. The server has no
configured public URL; deployments already trust `X-Forwarded-Proto`
for secure cookies, and reverse proxies may rewrite `Host`.

## Decision

A **connection string** is minted only by `POST /api/sf/tokens` as the
optional `connection_string` field of its `201` response. It is:

```
sfconn_v1_ + base64url_unpadded(JSON{v:1,url,vdir,token})
```

where `url` is an absolute `http`/`https` origin with no credentials,
path, query, or fragment, `vdir` is the token's vdir id, and `token` is
the plaintext `sf_v1_…` bearer value. The value is opaque, is not a URL,
and carries its version in both the prefix and `v` so future formats can
fail closed.

- **One producer.** `internal/vdirtokens` owns the encoder and the
  origin rule. The SPA and client package only display or parse; neither
  re-encodes the value.
- **Origin from the request.** Scheme is `https` when TLS is present or
  the first `X-Forwarded-Proto` value is `https`; host is the first
  `X-Forwarded-Host` value when present, otherwise `Host`. If no usable
  origin exists, the mint still succeeds and omits the field.
- **One-time secret.** The string is as sensitive as the token. It is
  not stored, listed, introspected, or logged, and it is shown only in
  the mint panel until dismissed.
- **Local parsing.** `@stratofold/client` exposes
  `parseConnectionString(value)` and
  `StratofoldClient.fromConnectionString(value, overrides?)`. Parsing is
  synchronous, performs no request, rejects malformed input with
  `ConfigurationError`, and allows only the base URL and fetch/XHR seams
  to be overridden.
- **Never authentication.** A connection string presented as a bearer
  credential is not accepted; only the embedded token authenticates.
- **Never in a URL.** The value and its token are never placed in a
  request URL, query, or fragment. The format exists partly so a
  connection cannot become a clickable link with a bearer secret in it.

## Consequences

- The format is a cross-language interoperability contract. Changing it
  requires a new prefix/version and a decoder that keeps accepting the
  old one.
- The embedded origin is a snapshot. If an instance moves or a proxy
  changes its public hostname, an app can override `baseUrl` rather than
  re-minting; docs call this out.
- Reverse proxies must forward `X-Forwarded-Proto`/`X-Forwarded-Host`
  for the minted origin to match the user's address. The client override
  is the escape hatch.
- Secret scanners can recognize `sfconn_v1_` alongside `sf_v1_`, and the
  UI treats both as one-time secrets.
- The static test client parses a pasted string and stores only the
  three separate fields, not the string itself.

## Rejected alternatives

- **URL with the payload in the fragment** — clickable, but puts a
  bearer secret in a URL, conflicting with ADR 0012 and the
  client-library spec, and exposing it to history sync and link
  previews.
- **`stratofold://connect?…` custom scheme** — still a URL, plus handler
  registration and inconsistent browser behavior.
- **Readable `sfconn_v1:url=…&vdir=…&token=…`** — percent-encoding and
  delimiter escaping invite truncation and corruption.
- **Bare JSON or unprefixed base64** — no recognition or version gate.
- **SPA-only composition** — API callers would get no connection string
  and the web app would own a second encoder.
- **A configured public URL** — more accurate for complex proxies, but a
  new deployment setting for a convenience value; the client override
  covers the rare mismatch.
- **Server-side decoding endpoint** — would send the secret back to the
  server and defeat a self-contained string.
