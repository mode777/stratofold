# Design

## Context

See [proposal.md](proposal.md) — the repo has no README and no end-user
docs; all operational knowledge currently lives in contributor-facing
sources: `AGENTS.md` (agent-oriented pointers), `docs/architecture.md` /
`docs/vision.md`, the `deployment` spec, the `Dockerfile`, and
`.github/workflows/release-image.yaml`. The logo exists as committed
assets under `web/public/icons/` (`icon.svg` plus PWA PNGs). The project
is early-stage and still moving, so any new prose risks drifting from
actual behavior.

## Goals / Non-Goals

**Goals:**

- A README that works as the project front door on GitHub: logo, what it
  is, core properties, quick start, and links onward.
- A hosting guide that lets someone run the released image correctly on
  the first try: port, data volume, first admin, TLS/reverse-proxy note,
  upgrade, and backup.
- A user guide covering the day-to-day app: account, connections, virtual
  directories, browse/upload/preview, sharing, public vdirs, PWA install.
- Facts stated once, pinned to the sources that own them, with links out
  instead of restatements (matching the project's "point rather than
  restate" convention).

**Non-Goals:**

- No code, build, or spec changes; no new tooling (link checker, docs
  site generator).
- No contributor guide — `AGENTS.md` and `docs/architecture.md` already
  serve that audience; the README only links to them.
- No new branding/logo work — reuse the committed `icon.svg`.

## Decisions

1. **Docs live as plain Markdown in `docs/`, flat, next to the existing
   pages.**
   - *Rejected: external docs site (docusaurus/mkdocs/GitHub Pages).* No
     build/deploy infrastructure exists for it, and the audience size
     doesn't justify it; it also adds a second place for drift.
   - *Rejected: one combined "user guide" page.* Hosting (self-hosters)
     and usage (app users) have different readers and different change
     cadence; splitting them keeps each guide reviewable against its own
     source of truth (`deployment` spec/Dockerfile vs. the web-ui/
     filesystem-api/sharing specs).

2. **`docs/hosting.md` and `docs/using-stratofold.md` are the two
   end-user docs; the README links, but does not duplicate, them.**
   The README carries only the pitch and quick start (a handful of
   commands); everything operational belongs to the hosting guide. This
   keeps the README stable while behavior details evolve.

3. **The README references the existing `web/public/icons/icon.svg`
   in place (`<img src="web/public/icons/icon.svg" …>`), no copied
   asset.**
   GitHub renders relative-path SVG references in READMEs. *Rejected:
   copying the file into a `docs/assets/` or `.github/` location* —
   duplicates a committed asset and invites divergence from the PWA
   icons; *rejected: raster PNG* — the SVG is the vector source and
   scales cleanly.

4. **The hosting guide documents the released Docker image as the only
   first-class path; from-source is a pointer, not a tutorial.**
   Docker-in-CI is the settled distribution (ADR 0004 multi-stage image,
   ADR 0006 release pipeline); the deployment spec pins image reference
   `harbor.alexklingenbeck.de/my/stratofold`, port `8090`, volume
   `/pb_data`. Building from source is contributor territory already
   covered by `AGENTS.md`, so the guide links there instead of
   restating it. The guide must state the backup-relevant caveat that
   the secret-sealing key lives inside the SQLite data directory
   (`_params` row `sf_sealbox_key`) — losing it orphans stored
   connection secrets — and the TLS note that the `sf_session` cookie
   is `Secure` on HTTPS, so the app expects to be served behind HTTPS
   in production.

5. **Every hard fact in the new docs cites its owning source** (spec
   section, `Dockerfile`, workflow, ADR) as a link or comment, so a
   future behavior change surfaces the doc edits that must follow.

## Risks / Trade-offs

- **Doc drift on an early-stage product** → keep guides at the
  capability level (what a vdir is, that uploads stream) rather than
  pixel-level UI walkthroughs; pin exact values (image ref, port,
  volume, superuser command) to the deployment spec; include a docs
  re-check task in feature changes going forward is out of scope here,
  but `AGENTS.md` gains a pointer so agents know user docs exist.
- **Registry/image availability** (`harbor.alexklingenbeck.de` may not
  be publicly pullable) → the guide documents the canonical reference
  as the deployment spec defines it; if pulling fails for a reader,
  that is a distribution concern, not a docs concern. No workaround
  invented in prose.
- **SVG logo rendering variance** (some non-GitHub viewers don't render
  `<img>` SVG in Markdown) → acceptable; the alt text carries the
  project name.

## Migration Plan

Not applicable — additive documentation only; rollback is reverting the
new files.

## Open Questions

None.
