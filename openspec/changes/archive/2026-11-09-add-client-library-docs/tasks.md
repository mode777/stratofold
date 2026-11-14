# Tasks

## 1. Connection-flow section

- [x] 1.1 Add a **Connect an app** section to `client/README.md` before
      the existing "Construction" section, covering prerequisites (a
      vdir you own or one shared with you, plus its effective role) and
      token minting in **Settings → Connected apps** (virtual directory,
      name, Viewer/Editor, expiry Never/7/30/90/365 days, and the
      once-only plaintext panel). Verify every label and step against
      `web/src/pages/AppsPage.tsx` and the "Connecting an app (access
      tokens)" section of `docs/using-stratofold.md`, and fix any wording
      the UI contradicts.
- [x] 1.2 Add the construct-and-verify snippet: create the client from
      `baseUrl`/`vdir`/`token`, then call `tokenInfo()` and describe the
      non-secret fields it returns (`id`, `name`, `vdir`, `role`,
      `expiresAt`, `lastUsedAt`, `tokenHint`) and the fact that the
      plaintext token is never returned. Verify the snippet compiles and
      every field exists in `client/src/types.ts` (`TokenInfo`).
- [x] 1.3 Add the first-request snippet (`list("")`) and a compact
      role-to-operation map: viewer → `list`, `read`, `fileUrl`,
      `temporaryUrl`; editor → also `mkdir`, `move`, `remove`, `upload`.
      Verify the operation list against the public exports in
      `client/src/` and the role rules in the `client-library` and
      `vdir-access-tokens` specs.
- [x] 1.4 Document revocation and lifetime: revoke from the same screen
      and it stops immediately; access is re-resolved per request and is
      capped at `min(token role, current access)`; share removal, role
      change, vdir/user deletion, and expiry end access. Verify against
      `openspec/specs/vdir-access-tokens/spec.md` and the behavior pinned
      by `internal/requestauth` tests.
- [x] 1.5 Add the security checklist (one token per consumer, least
      role, expiry where possible, never in a URL or public bundle,
      `temporaryUrl()` for private media) and fold the existing "Token
      audience" section into the new flow so the guidance exists once.
      Verify no paragraph of the old section remains duplicated and the
      new section renders in order before "Construction".

## 2. Verification

- [x] 2.1 Run `npm --prefix client run typecheck:readme` and confirm
      every ```ts block in `client/README.md`, including the new ones,
      type-checks against the package sources.
- [x] 2.2 Sweep the edited file for link and pointer integrity: the
      front-door `README.md` client-library bullet still reads correctly,
      the cross-link to `docs/using-stratofold.md` resolves, and no
      relative path or heading anchor is broken. Verify each path exists
      and AGENTS.md's client section needs no edit (no invariants change).
- [x] 2.3 Run `npx openspec validate --all --strict` and confirm the
      change validates with `skip_specs: true` and no spec deltas.
