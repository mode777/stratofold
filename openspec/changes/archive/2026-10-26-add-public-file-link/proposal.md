# Proposal

## Why

A public vdir is meant to be handed to people — but the only link the app
offers is the vdir's browse link on the sharing screen. Someone who wants to
point a colleague, a chat, or a direct-download consumer at one file has to
open the browse view, tap the file, and reconstruct a `/files` URL by hand.
The capability is already there (public vdirs serve anonymous `/files`
downloads); the UI just does not expose it per file.

## What Changes

- The browse view's entry context menu gains a **Copy public link** action for
  file entries while the vdir is public. It copies an absolute, direct
  `/files/<vdir-id>/<path>` URL — the URL that already downloads the file
  anonymously — to the clipboard.
- The action appears for every viewer of a public vdir, not only anonymous
  visitors: the owner and share holders browsing their own public vdir get the
  same action, because the link's meaning is the vdir's publicness alone.
- Directories do not offer the action (a folder has no download URL; the vdir
  browse link covers that case).
- Non-public vdirs offer nothing new — no action, no disabled state, no hint.
- Feedback follows the existing sharing-screen pattern: a transient "Copied"
  confirmation when the clipboard write succeeds; when the clipboard API is
  unavailable or rejects, the menu stays dismissible and no false success is
  claimed.

Assumptions (recorded, not blocking): the copied URL is absolute
(`<origin>/files/...`) so it is usable outside the tab that copied it, and it
carries no token — un-publishing the vdir revokes it exactly like the browse
link. Mutation is out of the picture: this is a read-only affordance.

## Capabilities

### New Capabilities

None — the behavior extends an existing capability.

### Modified Capabilities

- `web-ui`: the long-press context menu requirement gains the public-file-link
  action, and a new requirement pins what the copied link is and when it is
  offered.

## Impact

- Code: `web/src/components/ContextMenu.tsx` (new action + copy feedback),
  `web/src/pages/BrowsePage.tsx` (pass the vdir's publicness into the menu),
  `web/src/pages/EntryViews.tsx` only if the publicness plumbing requires it,
  and `web/src/components/icons.tsx` if no existing icon fits (the `LinkIcon`
  already used by the sharing screen does).
- Tests: `web/src/components/ContextMenu.test.tsx`,
  `web/src/pages/BrowsePage.test.tsx`,
  `web/e2e/public-browsing.spec.ts` (verification-server only).
- Docs: `docs/using-stratofold.md` (public-browsing section) and the
  `web-ui` spec; `README.md`, `docs/hosting.md`, and `AGENTS.md` need no
  change beyond AGENTS.md's web-UI bullet mentioning the new menu action.
- **No ADR** — a context-menu action over an already-specified anonymous
  `/files` URL introduces no durable stack or security decision; it reuses the
  existing public-read model (ADR 0007 is unrelated; sharing-access-control
  already pins the access semantics).

## Non-goals

- No new server endpoint, token, or sharing primitive; the link is the plain
  public `/files` URL.
- No link for directories, no bulk/multi-select link copying.
- No QR codes, share sheets beyond the clipboard, or expiry controls.
- No changes to who may read a public vdir (that stays
  `sharing-access-control`'s contract).
- No link affordance in the audio player, image gallery, or preview screens —
  the context menu is the single entry point.
