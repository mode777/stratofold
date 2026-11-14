# Proposal

## Why

`client/README.md` documents the package's API surface but not the
end-to-end connection flow. A developer who has a vdir and wants to use
`@stratofold/client` has to assemble the story from three places: the
"Construction" snippet in the client README, the token-minting steps in
`docs/using-stratofold.md`, and a short "Token audience" note at the
bottom. Nothing walks from "mint an app token" through "verify the
connection with `tokenInfo()`" to "revoke it", so the first integration
is guesswork and the security rules read as an afterthought.

## What Changes

- Add a dedicated **Connect an app** section to `client/README.md`,
  placed before the API reference, that covers the whole flow:
  - Preconditions: a vdir the user owns or one shared with them, and
    the role that vdir grants.
  - Minting an app token in **Settings → Connected apps**: name, vdir,
    role (`viewer`/`editor`, capped by the user's own access), optional
    expiry, and the once-only plaintext display.
  - Installing the package and constructing the client with `baseUrl`,
    `vdir`, and `token`.
  - Verifying the connection with `tokenInfo()` and reading its
    non-secret scope (`id`, `name`, `vdir`, `role`, `expiresAt`,
    `lastUsedAt`, `tokenHint`).
  - The first request (`list("")`) and a compact role-to-operation map.
  - Public mode as the tokenless alternative, and when it applies.
  - Revocation in **Settings → Connected apps**, including immediate
    effect, the `min(token role, current access)` cap, and the
    share/role/vdir/user/expiry events that end access.
  - A short security checklist: one token per consumer, least role,
    expiry where possible, never in a URL or a public bundle, and
    `temporaryUrl()` for private media.
- Fold the existing "Token audience" section into the new flow (or
  reduce it to a pointer) so the security guidance exists once.
- Keep the existing install, construction, operations, public-mode,
  errors, test-client, deployment, and publishing sections as the API
  reference; adjust their links and wording only where the new section
  supersedes them.

## Capabilities

No spec changes. The requested work is documentation for an already
specified capability, so this change sets `skip_specs: true` in
`.openspec.yaml`; `openspec/specs/client-library/` stays untouched.

## Impact

- **Docs**: `client/README.md` is the only file expected to change.
  The front-door `README.md` already links it and needs no edit
  unless the section title changes the pointer text.
  `docs/using-stratofold.md` keeps owning the end-user token flow; the
  new section links to it rather than duplicating it.
- **No ADR** — documentation only; no durable architecture decision is
  being made or revisited (ADR 0013 still owns client distribution).
- **No code, API, spec, build, or dependency changes.**

## Non-goals

- A separate page under `docs/` (the client README stays the SDK's
  documentation).
- Rewriting the existing API-surface sections.
- Changing `docs/using-stratofold.md`, the SPA, the server, or the test
  client.
- Screenshots or a hosted docs site.
- npm publishing or release changes.
