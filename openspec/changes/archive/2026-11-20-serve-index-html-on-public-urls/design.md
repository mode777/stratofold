# Design

## Context

See `proposal.md` — Why. The pretty URL server route currently classifies
a request only by shape: slashed paths are the SPA shell, unslashed paths
are direct files. That makes `index.html` unreachable as a folder entry
point. The file server already has the exact streaming semantics needed
(`fileserver.StatResolved` + `ServeFile`), and the vdir sandbox already
decides whether a candidate is safely inside the root.

## Goals / Non-Goals

**Goals:**

- Serve `<dir>/index.html` for the alias root and nested slashed
  directory URLs when it exists.
- Keep the browse view as the fallback when no index document exists.
- Reuse the existing file-serving and sandbox seams; add no new
  authorization path.

**Non-Goals:**

- Other default document names, configurable index names, or autoindex.
- Changing `/files` behavior.
- Serving an index for the reserved root-level `view` preview namespace.

## Decisions

### D1 — Probe `index.html` for slashed alias paths

For a public alias, a slashed path (including the root) first checks
`path.Join(virtualPath, "index.html")` through `StatResolved`. If the
result is a regular file, `ServeFile` streams it with the same Range,
conditional, ETag, HEAD, content-type, and reconnect behavior as
`/files`. If the stat fails or resolves to a directory, the existing SPA
shell is served. The bare alias still `301`s to its slashed form, and the
root-level `view` check stays ahead of the index probe.

Rejected: serving the index only when the alias root is requested
(nested folders would remain inconsistent); client-side fetching of
`index.html` (two requests, no correct content-type/conditional
handling, and the server already owns the file-server seam); a
configurable default-document list (no requirement).

### D2 — Accept one index stat per directory URL

The index decision needs a remote stat, so slashed browse paths may now
dial SSH. The connection manager reuses one connection, and the browse
view already performs a listing after the shell loads. The alternative
(always shell, then have the SPA probe) adds a second request and moves
file semantics into the browser. The trade-off is recorded in the spec
and ADR.

### D3 — No SPA route change

The browser still sees the existing SPA for folders without an index;
when an index is served, the browser renders that document directly.
Navigation links in the index use normal relative/absolute semantics,
the same as `/files` directory URLs. No React route or alias gate logic
changes.

### D4 — ADR 0019 supersedes the no-index part of ADR 0018

ADR 0018 chose a browse-shell-first URL contract. This correction
reverses that specific behavior while keeping the global namespace,
public-only serving, direct-file routing, and reserved `view` rules.
Write `0019-index-documents-on-public-urls.md`, mark 0018 superseded,
and update the index.

## Risks / Trade-offs

- **One extra SSH stat per directory URL** → bounded by the existing
  connection manager; the correctness requirement is explicit.
- **An index hides the browse view for that folder** → intended: the
  index is the folder's entry point. Folders without one keep browsing.
- **A directory with a slow/unavailable host delays the shell** → the
  stat is part of the request; a failure falls back to the shell, whose
  listing shows the existing retryable/not-found states.
- **Index relative assets** → the slashed URL is the canonical base, so
  relative links resolve as they do for `/files` directory URLs.
- **Other servers may expect only `index.html`** → the scope explicitly
  keeps one documented default document.

## Migration Plan

No schema or data migration. Deploy the updated server; existing aliases
immediately begin serving an `index.html` that they already contain.
Rollback restores browse-shell-first behavior with no data loss.
