# 0019 — Index documents on pretty public URLs

Status: Accepted (2026-11, change `serve-index-html-on-public-urls`)

## Context

ADR 0018 made every slashed `/apps/<name>/…` path return the SPA browse
shell and deliberately did not resolve an implicit `index.html`. That
broke the common static-app case: a folder whose entry point is
`index.html` could not be published at its pretty URL at all. The
public-urls surface already reuses the vdir sandbox and the `/files`
streaming seam, so serving the index safely is a routing correction, not
a new file-serving model.

## Decision

For a public alias, a slashed directory URL (the alias root and nested
folders) checks `<dir>/index.html` through the vdir sandbox:

- When it resolves to a regular file, stream it with the same
  `fileserver` Range, conditional, ETag, HEAD, content-type, and
  reconnect behavior as `/files`.
- When it does not exist (or is not a regular file), serve the existing
  read-only SPA browse shell.
- The bare `/apps/<name>` form still `301`s to `/apps/<name>/`; the
  slashed root then serves the index or the browse fallback.
- The root-level `view` preview namespace is checked first and never
  resolves an index.
- Directory URLs may perform one index stat. Private, unknown, released,
  and un-published aliases still fail before any dial and remain
  indistinguishable `404`s.

Everything else from ADR 0018 still applies: the global name namespace,
owner-managed `public_slug`, public-only serving, direct-file paths,
reserved `view`, and the session-free resolver.

## Consequences

- A folder containing `index.html` now serves that document at its
  alias URL; its browse view is not reachable at that path. Folders
  without an index keep the browse view.
- Directory responses now need one remote stat before they can decide
  between the index and the shell. This is the correctness cost of the
  correction; the connection manager reuses the SSH connection and the
  shell's listing follows as before.
- Index relative asset links work like `/files` directory URLs because
  the slashed URL is the canonical base.
- `/files` behavior, the resolver, sharing, tokens, and existing links
  are unchanged.

## Rejected alternatives

- **Serve the index only at the alias root** — nested published folders
  would remain inconsistent; the same rule should apply everywhere.
- **Client-side index probing** — adds a second request and moves file
  content-type/conditional semantics into the SPA; the server already
  owns the file-serving seam.
- **Configurable default documents** — no requirement; one documented
  convention (`index.html`) keeps the contract testable.
- **Always serve the shell and add a separate static-site URL** — makes
  the pretty URL unable to be the site itself, which was the actual
  correction.
