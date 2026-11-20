# Proposal

## Why

Public URL directory paths currently always render the SPA browse view.
That makes `/apps/<name>/` unusable as the home of a published static
app or folder whose `index.html` is its entry point. The pretty URL
should behave like a normal static host: serve the folder's
`index.html` when it exists, and fall back to the browse view only when
the folder has no index document.

## What Changes

- For a public alias, every slashed directory URL (the alias root and
  nested folders such as `/apps/<name>/docs/`) checks for an
  `<dir>/index.html` file through the vdir sandbox. When it is a regular
  file it is streamed with the existing `/files` semantics (Range,
  conditional requests, ETag, HEAD, reconnect).
- When no index document exists, the current read-only SPA browse view
  is served, unchanged; a missing directory still surfaces as a browse
  not-found state.
- The bare `/apps/<name>` form continues to `301` to `/apps/<name>/`,
  which then serves the index or the browse view. The root-level `view`
  preview namespace remains reserved and never resolves an index.
- Unslashed file paths, directory redirects, missing-file `404`s,
  public-only access, and the resolver are unchanged.
- Directory URLs now perform one index lookup (an SSH stat through the
  vdir sandbox) instead of always returning the shell without a dial.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `public-urls`: directory URLs serve `index.html` when present instead
  of always returning the SPA shell.
- `web-ui`: the alias browse view is the fallback for folders without an
  index document; an existing index document takes precedence.

## Impact

- Code: `internal/publicurls` directory handling probes
  `<virtual-path>/index.html` and reuses `fileserver.StatResolved` /
  `ServeFile` to serve it. No change to `/files`, the resolver, the vdir
  sandbox, or the SPA route model.
- Tests: Go route tests for root/nested index precedence, fallback to
  the shell, explicit `index.html`, and the reserved `view` namespace;
  the public-URL E2E uses the seeded root `index.html` as a static site
  and browses a subfolder without one.
- Docs: **new ADR `docs/decisions/0019-index-documents-on-public-urls.md`**
  superseding the no-implicit-index part of ADR 0018, plus the ADR index,
  `docs/using-stratofold.md`, `docs/hosting.md`,
  `docs/architecture.md`, `README.md`, and `AGENTS.md`.
- No breaking change to existing `/v`, `/files`, share, token, or
  link behavior. A folder that previously showed the browse view while
  containing `index.html` now serves that file; this is the intended
  correction.

## Non-goals

- No support for other default documents (`index.htm`, `default.html`) or
  configurable index names; the convention stays `index.html`.
- No autoindex or directory listing, and no change to `/files` index
  resolution.
- No browse-view URL for a folder that has an index document; the index
  takes precedence at that URL.
- No caching of index lookups and no new per-site configuration.
