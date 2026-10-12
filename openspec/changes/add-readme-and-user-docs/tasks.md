# Tasks

## 1. Hosting guide (`docs/hosting.md`)

- [x] 1.1 Write `docs/hosting.md`: what the single image contains (server + embedded SPA, per the `deployment` spec); running it (`docker run` with `-p 8090:8090` and a mounted volume at `/pb_data`, matching the `Dockerfile` CMD/EXPOSE/VOLUME); first-time setup (`stratofold superuser upsert EMAIL PASS`, first sign-in); production notes (serve behind HTTPS — the `sf_session` cookie is `Secure` on HTTPS; persistent state is the SQLite database under `/pb_data`); upgrading (pull a newer tag — state survives restarts per the deployment spec); backup/restore (`/pb_data` includes the secret-sealing key `_params.sf_sealbox_key` — losing it orphans stored connection secrets, so back up the whole directory). Cite the owning source (spec section, `Dockerfile`, workflow) for every hard fact and verify each command in the guide runs as written against the pinned flags
- [x] 1.2 Cross-check the guide against `openspec/specs/deployment/spec.md`, the `Dockerfile`, and `.github/workflows/release-image.yaml` line by line and fix any mismatch (image reference, port, volume path, superuser command)

## 2. User guide (`docs/using-stratofold.md`)

- [x] 2.1 Write `docs/using-stratofold.md`, capability-level (no pixel walkthroughs): creating an account and signing in; adding an SSH connection (host, credentials, optional `host_key_fingerprint` — first successful connection pins the host key, trust-on-first-use); creating a virtual directory (root path from the connection's `remote_dir`, public toggle); browsing, previews (audio/image gallery/Quick Look), the move/rename/delete/new-folder actions, uploads (queue, pause/cancel/retry); sharing a vdir with viewer/editor roles and revoking; installing the app as a PWA. Link to `docs/hosting.md` for deployment and avoid restating internals owned by `AGENTS.md`/ADRs
- [x] 2.2 Cross-check each described flow against the `web-ui`, `filesystem-api`, `sharing-access-control`, and `pwa` specs and the actual SPA routes (`web/src/App.tsx`); fix any mismatch between prose and shipped behavior

## 3. README

- [x] 3.1 Write `README.md`: centered logo via `<img src="web/public/icons/icon.svg">` (no copied asset); one-paragraph description (cloud file manager over SSH/SFTP, Drive/Dropbox-style) plus core properties (stream-don't-cache, virtual directories, sharing + public vdirs, single self-contained image, installable PWA); a quick start (run the image, create the superuser, sign in — 3–4 commands max, linking to `docs/hosting.md` for the full guide); "Documentation" links to `docs/using-stratofold.md` and `docs/hosting.md`; "For contributors" links to `AGENTS.md`, `docs/architecture.md`, `docs/decisions/README.md`, and `openspec/`; no license section (no `LICENSE` file exists). Verify every relative link and image path resolves and the SVG renders on GitHub

## 4. Agent guidance pointer

- [x] 4.1 Update `AGENTS.md` so the doc map ("Read first" section) points to the new end-user docs (`README.md`, `docs/hosting.md`, `docs/using-stratofold.md`) and states they must be re-checked when user-facing behavior changes; keep it a pointer — do not restate their content. Verify the section reads coherently alongside the existing doc map

## 5. Final verification

- [x] 5.1 Run `npx openspec validate --all --strict` (the repo's verification harness) and confirm it passes with the `skip_specs` change present
- [x] 5.2 Sweep all new docs for link/path integrity: every referenced file exists (`README.md` → logo, docs pages, AGENTS.md, decisions index; docs pages → each other and the specs they cite) and no duplicated facts have drifted from their cited sources
