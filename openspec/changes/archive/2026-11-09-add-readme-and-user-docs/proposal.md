# Proposal

## Why

The repository has no README and no documentation aimed at the people the
product is for: someone landing on the project cannot tell what Stratofold is,
and someone who wants to run it has to reverse-engineer the hosting facts
(image reference, port, data volume, superuser bootstrap, backup caveats) from
the Dockerfile, CI workflow, and agent docs. The feature work through roadmap
change 9 (packaging & release) is complete enough that a public front door and
a hosting guide are now meaningful — and nothing else documents these facts
for non-contributors.

## What Changes

- Add a root `README.md`: the project logo, a short description of what
  Stratofold is and its core properties (stream-don't-cache, virtual
  directories, sharing/public vdirs, single self-contained image), a
  quick-start for running the released image, and pointers into the
  end-user docs and contributor docs.
- Add end-user documentation under `docs/` (plain Markdown, linked from the
  README):
  - `docs/hosting.md` — a hosting guide: how to run the released Docker
    image (port, `/pb_data` volume, persistent state), how to create the
    first admin, what to know about running behind a reverse proxy with
    HTTPS, upgrading, and backing up (including the sealed-secrets key
    caveat).
  - `docs/using-stratofold.md` — a getting-started user guide: accounts,
    connecting an SSH host, virtual directories, browsing/uploading, the
    mobile shell and PWA install, sharing and public vdirs.
- Update `AGENTS.md`'s doc map ("Read first") so agent guidance points to the
  new docs instead of duplicating them.
- No code, API, build, or spec behavior changes — this is a docs-only change
  (`skip_specs: true`).

Assumptions (recorded, not blocking): "end-user documentation" means docs for
the people who deploy and use Stratofold (self-hosters and app users), written
as Markdown in this repo next to the existing `docs/` files — not an in-app
help center or an external docs site.

## Capabilities

### New Capabilities

None — no system behavior is introduced.

### Modified Capabilities

None — no requirement in `openspec/specs/` changes. The change is pure
documentation, so it opts out with `skip_specs: true` in `.openspec.yaml`.

## Impact

- New files: `README.md`, `docs/hosting.md`, `docs/using-stratofold.md`.
- Modified files: `AGENTS.md` (doc-map pointers only).
- Affected docs: README (created), `docs/` (two new user-facing pages),
  `AGENTS.md` (pointer update).
- **No ADR** — documentation adds no durable architecture decision; the
  hosting guide restates facts already pinned by the `deployment` spec, the
  `Dockerfile`, and ADRs 0002/0004/0005/0006.
- Out of scope (Non-goals):
  - No behavior changes: no server, API, SPA, or pipeline code is touched.
  - No screenshots or images beyond the existing logo assets in
    `web/public/icons/` (no new logo or branding work).
  - No external docs site, no in-app help UI, no i18n.
  - No license text (the repo has no `LICENSE` file; choosing one is a
    separate decision).
  - No cluster/GitOps rollout documentation (that lives in the separate
    `cloud.alexklingenbeck.de` repo by design).
