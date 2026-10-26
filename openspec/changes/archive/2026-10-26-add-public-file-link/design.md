# Design

## Context

See `proposal.md` — Why. The pieces this design builds on already exist:

- The browse view (`web/src/pages/BrowsePage.tsx`) fetches the vdir record for
  signed-in users (`listVdirs`, which carries `is_public`), and for anonymous
  visitors knows publicness from `PublicGate`'s meta probe
  (`usePublicBrowseName` returns non-null exactly in public mode).
- The entry context menu (`web/src/components/ContextMenu.tsx`) already builds
  a per-entry `/files` URL with `filesUrl(vdirId, path)` for Open/Download and
  gates write actions on `canWrite`.
- `filesUrl` percent-encodes each path segment; `web/src/lib/filesApi.ts` has
  no absolute-URL variant. The sharing screen builds its absolute link with
  `${window.location.origin}/v/<id>`.
- `/files/<vdir-id>/<path>` already serves anonymous downloads on public vdirs
  (`sharing-access-control`, `file-server` specs). There is no per-file token,
  signed URL, or expiry anywhere in the system.

## Goals / Non-Goals

**Goals:**

- One extra menu action on file entries whose vdir is public, copying an
  absolute direct download URL.
- Correct in both browsing modes: anonymous public mode and signed-in browsing
  of a public vdir.
- No server, API, spec-permission, or storage changes.

**Non-Goals:**

- Links for directories, bulk copies, QR codes, or expiry — see the
  proposal's Non-goals.
- Any new authorization path: the copied URL is evaluated by the file server
  exactly as a paste into the address bar would be.

## Decisions

**D1 — Publicness is passed into the menu from the browse page, not probed by
the menu.** `BrowsePage` already holds both sources of truth (`publicMode`
from context, `vdir.is_public` from the record) and passes
`isPublic={publicMode || vdir?.is_public === true}` to `ContextMenu`. The menu
stays a dumb presentational component with no extra fetches, and the rule
("public vdir ⇒ action") lives where the publicness is already derived.
Alternatives: (a) have `ContextMenu` call the meta probe — rejected, it would
add a network round trip per long-press and fail closed for signed-in owners
of non-public vdirs in confusing ways; (b) a new `useVdirPublic` hook —
rejected as indirection over two already-available values.

**D2 — Copy the absolute `/files` URL, computed as
`window.location.origin + filesUrl(vdirId, path)`.** This reuses the existing
encoder instead of re-implementing path escaping, and matches how the sharing
screen makes its link absolute. Alternatives: (a) copy the relative
`/files/...` — rejected, a bare path is useless pasted into a chat or another
origin; (b) copy the browse or preview URL (`/v/<id>` ..) — rejected, the
request is a *direct download* link; the browse link already exists on the
sharing screen.

**D3 — The action appears only for non-directory entries and only when
`isPublic`.** No disabled menu row and no explanation on non-public vdirs: the
menu's contract is "actions you can take", and a permanently disabled row
would leak vdir metadata into a menu that viewers of other people's vdirs see.
Directories are excluded because a folder URL would stream a listing rather
than download anything, and the vdir browse link covers sharing a folder.

**D4 — Feedback is local to the menu: swap the label to "Copied" after a
successful clipboard write, claim nothing on failure.** This mirrors
`SharingPage`'s `copied` state and its `navigator.clipboard.writeText`
try/catch. On failure the row silently does nothing (the menu still offers
Download, and the underlying URL is the same one the Download row points at,
so the user has a recoverable path). Alternatives: (a) a toast/alert on
failure — rejected, the codebase has no toast primitive and the failure is
recoverable; (b) rendering the URL as selectable text inside the menu —
rejected, it bloats a compact action sheet and the clipboard is a secure-context
feature on every platform the SPA targets (HTTPS or localhost).

**D5 — The action keeps its menu position after Download and before the
writer actions,** so read-only and writer menus share one stable prefix and
existing tests' expectations about write actions appearing last stay valid.

## Risks / Trade-offs

- **Stale publicness in a long-lived tab** → the server re-evaluates publicness
  per request, so a copied link stops working the moment the vdir is
  unpublished; the browse view's own next request already surfaces the
  not-available state.
- **Clipboard unavailable (insecure context, permission denied)** → no success
  is claimed (D4); Download still reaches the same bytes in that session.
- **Link discoverability** → the action lives two taps deep (long-press →
  action). Accepted: the alternative (an extra toolbar control) would clutter
  the mobile header for every file, public or not.
- **No token means no revocation granularity** → accepted by design; it is the
  same trust model as the existing public browse link, and adding tokens would
  be a new server capability, explicitly out of scope.

## Migration Plan

None — additive UI only; no data, config, or API migration. Rollback is
reverting the frontend change.

## Open Questions

None.
