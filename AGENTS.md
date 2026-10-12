# AGENTS.md

Stratofold — a cloud file manager: an SSH/SFTP client that works like a
Google Drive / Dropbox alternative. **Early stage**: the SFTP streaming
core (roadmap change 1), the auth/session bridge (change 2), the vdir
sandbox (change 3), and the `/files/*` file server (change 4) are
implemented; later changes add the write API, sharing, and the UI.
The stack is settled at the ADR level (Go + PocketBase, React SPA) —
see `docs/architecture.md`; finer details still follow.

## Read first

- `docs/vision.md` — the product vision. Proposals should serve it; it is
  the source of truth for what Stratofold is meant to be.
- `docs/architecture.md` — how the system is shaped; resolves the vision's
  architecture considerations via the ADRs in `docs/decisions/`.
- `docs/roadmap.md` — the planned OpenSpec changes, risk-ordered, with
  per-change validation strategies.
- `openspec/config.yaml` — project context and per-artifact rules for the
  OpenSpec workflow.

End-user docs (point, don't restate): `README.md` is the project front
door; `docs/hosting.md` (hosting guide) and `docs/using-stratofold.md`
(user guide) are written for self-hosters and app users. When a change
alters user-facing behavior, re-check those three for drift — they cite
the specs and files that own each fact.

## Development environment

- **Go**: installed user-locally at `~/.local/go` in the dev container
  (not on the image PATH — prepend `~/.local/go/bin`).
- **Docker**: unavailable — no daemon in the dev container, and the
  build/verification server's Docker socket is permission-denied. The
  dockerized OpenSSH fixture (`internal/testssh/docker/`) ships for
  Docker-capable environments; its container bring-up verification is
  **deferred** (change `add-sftp-streaming-core`, design D7).
- **Verification**: `go vet ./... && go test ./...` locally (the
  in-proc fixture runs everywhere); the long-running risk gates run
  with `SF_RUN_GATES=1`; `SF_TESTSSH_MODE=external` + `SF_TESTSSH_*`
  env vars run the same suite against a real OpenSSH (used on the
  build/verification server).
- **Running the server** (roadmap change 2): `go run ./cmd/stratofold
  serve` — one process, one port (default `127.0.0.1:8090`, override
  with `--http`), SQLite under `./pb_data` (override with `--dir`).
  Superuser: `go run ./cmd/stratofold superuser upsert EMAIL PASS`.
  Auth: `POST /api/sf/auth` returns the PocketBase token and sets the
  HttpOnly `sf_session` cookie (SameSite=Lax, `Secure` on HTTPS) —
  persistent, with MaxAge = the users collection's token duration
  (migration `1770000004` pins it to the PocketBase maximum ≈ 3 y;
  browsers cap cookie life at 400 days); `DELETE /api/sf/auth` clears
  it (all-devices logout — token-key rotation, design D3). Custom
  routes live only under `/api/sf/`
  (PocketBase owns `/api/files/*`); streaming routes clear deadlines
  via `appserver.ClearStreamDeadlines`.
- **Connections & vdirs** (roadmap change 3): both are PocketBase
  records with owner-only API rules — create a user, authenticate (via
  `/api/sf/auth` or `/api/collections/users/auth-with-password`), then
  POST to `/api/collections/connections/records` and
  `/api/collections/vdirs/records` (secret fields are write-only:
  sealed at rest, never returned; a vdir must reference an own
  connection). Remote access goes exclusively through the vdir
  resolver (`internal/vdir`: lexical anchoring + server-side symlink
  walk, fail-closed before dialing); one `sshconn.Manager` per
  connection record, rebuilt when the record changes
  (`internal/connreg`). The connection's `host_key_fingerprint` is
  optional (migration `1770000003_connection_remote_dir.go`): when set
  it is verified on every dial, and when empty the first successfully
  authenticated connection pins it (trust on first use —
  `sshconn.WithHostKeyCapture`, persisted by `connreg` with a hook-free
  DB update so the live manager survives; ADR 0007). A connection also
  carries a `remote_dir` (e.g. `/home/`) used as the default vdir
  `root_path` in the UI. Record creates from the SPA must include
  `owner` = the signed-in user id (the create rules require it). The
  secret-sealing key lives in the app's
  SQLite `_params` table (row `sf_sealbox_key`) — losing it orphans
  stored secrets; there is no key rotation yet.
  Verification: `go test ./internal/migrations/ ./internal/sshconn/
  ./internal/connreg/`.
- **File server** (roadmap change 4): `GET
  /files/<vdir-id>/<virtual-path>` (bare `/files/<vdir-id>` = root)
  streams through the vdir sandbox — access is decided before any SSH
  dial (non-public vdirs serve the owner's or a share holder's
  `sf_session` cookie; `is_public` serves everyone), sandbox
  rejections are `404`, and single-range/conditional/index semantics
  follow the `file-server` spec. Streaming responses resume in-place
  across SSH drops; a mid-response failure aborts the connection
  (`http.ErrAbortHandler`) so a truncated body can never look complete.
  Verification: `go test ./internal/fileserver/` (Range/conditional/
  auth matrix + reconnect + the golden runner) — the golden runner
  executes `scripts/fileserver-golden.sh` against an ephemeral
  in-proc stack; against a manually-run server, point the script at it
  with `SF_BASE_URL SF_EMAIL SF_PASSWORD SF_VDIR_ID SF_PUB_VDIR_ID`
  (a public and a private vdir over the seeded dataset).
- **Filesystem API** (roadmap change 5): `POST
  /api/sf/vdirs/<vdir-id>/{ls,mkdir,mv,rm,upload}` is the write path —
  JSON bodies (`{"path": …}`, `{"path", "to"}` for mv; upload takes
  `?path=` and the raw body). Same authorize-before-dial order as
  `/files/*` (`ls` needs owner/viewer/editor or, on public vdirs,
  nothing; `mkdir`/`mv`/`rm`/`upload` need the owner or an `editor`
  share on that vdir — `is_public` never implies write).
  Mutations are idempotent per operation and retried across
  disconnects (never partially applied); uploads stream body → temp
  name → atomic rename (nothing buffered host-side; a truncated or
  canceled body never publishes; `fsapi.MaxAttempts` /
  `fsapi.UploadTransferOptions` bound the retry budgets). Errors map
  deterministically: sandbox/missing `404`, permission `403`, bad
  shape `400`, retryable/unreachable `503`, else `500`.
  Verification: `go test ./internal/fsapi/` (operation/retry/authz
  matrices, disconnect-resume, concurrency); the R5 memory ceiling and
  sustained-concurrency gates run with `SF_RUN_GATES=1 go test
  ./internal/fsapi/ -run Gate`.
- **Sharing** (roadmap change 6): `vdir_shares` records
  (`vdir`, `user`, `role` ∈ `viewer`|`editor`, unique per pair) are
  managed over the record API by the vdir's owner; grantees see their
  own shares and can list/view the shared vdirs. Remote access is
  decided per request by the shared seam `internal/vdirauthz`
  (`None`/`Viewer`/`Editor`/`Owner` + `is_public`), used identically by
  `internal/fileserver` and `internal/fsapi` — no caching, so share
  removal, role changes, and un-publishing apply to the next request.
  Gotcha: the `vdirs` list/view rules use the back-relation with the
  multi-match operator (`vdir_shares_via_vdir.user ?= …`); a plain `=`
  silently stops matching once a vdir has more than one share.
  Verification: `go test ./internal/migrations/` (record-rules matrix)
  and the authz/revocation matrices in `./internal/fileserver/` +
  `./internal/fsapi/`.
- **Web UI** (roadmap change 7): the SPA lives in the `web/` workspace
  (Vite + React + TS + Tailwind, ADR 0005) and is an iOS-style mobile
   shell (ADR 0008): a translucent bottom tab bar below `md` and a
   persistent sidebar at `md`+, with Files / Uploads / Settings
    destinations. Routes: `/` → `/files` (Locations), `/v/:vdirId/*`
   (browse), `/v/:vdirId/view/*` (preview — dispatched by file kind into
   the in-app audio player, the in-app fullscreen image gallery, or the Quick Look
   metadata card), `/v/:vdirId/move` (move
   picker), `/uploads`, `/settings`, `/settings/connections[/:id]`,
   `/settings/vdirs[/:id[/sharing]]`; unknown routes show Page Not Found.
   Tap behavior follows the file kind (`web/src/lib/entryKind.ts`):
   audio opens the in-app player and images the in-app fullscreen
   gallery (both
   under `/v/:vdirId/view/*`, streaming the plain `/files` URL), video
   still opens a new tab at `/files`. The image gallery
   (`web/src/pages/ImageViewerPage.tsx`, change
   `add-fullscreen-image-gallery`) is a dark edge-to-edge overlay: it
   zooms (pinch + double-tap) and pans while zoomed, swipes (or arrow
   keys) through the containing directory's image entries in listing
   order stopping at the ends, navigates with `replace: true` so the
   URL tracks the displayed image and browser back returns to the
   browse listing, and hides/re-shows its overlay chrome (back, name,
   size/modified, position, download) on image tap; slides fetch
   through the object-URL pattern with a current±1 window and fall back
   per slide (fetch failure → retry state, undecodable → metadata
   card). Download stays available in the
   context menu for every file and inside the player and gallery.
  The SPA is installable as a PWA (ADR 0009): `web/public/manifest.json`
  (served as `application/json`) and the committed icons under
  `web/public/icons/` are linked from `web/index.html`, Settings offers an
  install action only while `beforeinstallprompt` is available
  (`web/src/lib/useInstallPrompt.ts`), and there is deliberately **no
  service worker and no offline behavior**.
  Root script shims are
  `npm run web` (dev server on 127.0.0.1:5173, proxying `/api` + `/files`
  to 127.0.0.1:8090), `web:build` (output `web/dist`), `web:test`
  (Vitest + Testing Library), `web:e2e` (Playwright). Login posts to
  `/api/sf/auth`; the token goes into the PocketBase SDK auth store
  (record API) and the `sf_session` cookie drives `/files/*`. A new
  route `GET /api/sf/users/lookup?email=…` (`internal/userlookup`)
  resolves a share grantee by exact email. **Public vdirs are browsable
  without an account** (change `add-public-vdir-browsing`): an anonymous
  visitor opening `/v/:vdirId` browse or `/v/:vdirId/view/*` gets the
  read-only public view (no write affordances, no shell destinations,
  not-available state after un-publish); every other route still lands
  on the login screen. The gate is `SessionGate` + `PublicGate` in
  `web/src/App.tsx` probing `GET /api/sf/vdirs/<vdir-id>/meta`
  (`internal/vdirmeta`: session-free, answers `{name, is_public}` for
  public vdirs, `404` for non-public/unknown — no existence disclosure).
  The sharing screen offers the owner the plain absolute
  `/v/<vdir-id>` link with a copy action for public vdirs (no tokens;
  revocation is the `is_public` toggle). E2E needs a browser and a
  running stack: `cmd/stratofold-e2e` (`internal/e2eharness`) boots the
  app + in-proc SSH fixture on real ports with seeded users/vdirs/entries
  (including a 10k-entry directory and a media file). **Run E2E
  exclusively on the build/verification server** — the dev container's
  headless shell cannot launch (missing ALSA symbols), so `web:e2e` is
  never a local gate; component tests are. Playwright's `webServer`
  starts the harness with `go run ./cmd/stratofold-e2e`, so the server
  needs a Go toolchain (install it user-locally there if missing); or
  run a prebuilt harness binary and point Playwright at the stack with
  `SF_E2E_BASE_URL` + `SF_E2E_EXECUTABLE` (the server's
  chrome-headless-shell). Component tests gate locally; E2E gates on
  the verification server.
  Verification: `npm --prefix web run test` (PWA manifest/shell/install-hook
  tests in `web/src/pwa/` and `web/src/lib/useInstallPrompt.test.tsx`; the
  anonymous-gate matrix in `web/src/App.test.tsx` and the public-mode
  browse/preview tests in `web/src/pages/BrowsePage.test.tsx`); E2E
  on the build server via `npm --prefix web run e2e` (`web/e2e/pwa.spec.ts`,
  `web/e2e/public-browsing.spec.ts`, `web/e2e/image-gallery.spec.ts`, or the
  `SF_E2E_BASE_URL` override);
  `go test ./internal/vdirmeta/ ./internal/userlookup/ ./internal/appserver/`.
- **File management & uploads** (roadmap change 8): the browse view
  offers new-folder / rename / move / delete and multi-file upload,
  gated by the signed-in user's effective role on the vdir (owner or
  `editor`) derived client-side in `web/src/lib/useVdirRole.ts` from the
  vdir's `owner` field or the user's own `vdir_shares` record — the
  server still enforces independently. New-folder and upload live in
  the browse folder header (above the breadcrumbs), the compact
  toolbar stays view-controls-only, and the listing scrolls beneath
  the mobile tab bar (destinations own their bottom clearance).
  Entry actions live in the
  long-press / ellipsis context menu; new-folder and rename are bottom
  sheets, delete is a destructive alert, and move is the pushed
  `/v/:vdirId/move` picker. Mutations reuse the
  `lib/filesApi.ts` `mkdir`/`mv`/`rm` wrappers and the overlays map
  failures to the existing error states. Uploads go through the in-app
  manager (`web/src/lib/uploadQueue.ts` + `useUploadQueue`), surfaced on
  the Uploads destination plus a floating indicator on other
  destinations: in-memory, FIFO, one upload at a time,
  survives in-app navigation, and exposes progress/pause/cancel/retry.
  The transport is `XMLHttpRequest` (upload progress + abort); a
  canceled or failed upload restarts from byte zero (no cross-request
  resume protocol), and permanent classes are never auto-retried.
  Verification: `npm --prefix web run test` (queue unit tests, role
  matrix, action/error component tests); E2E on the verification server
  via `web/e2e/file-management.spec.ts` (small+large upload,
  navigate-away R7 acceptance, mutation flows, viewer gating,
  permanent-failure no-retry-storm).

- **Packaging & release** (roadmap change 9): the SPA is embedded in the
  server binary (`internal/webassets`, `//go:embed all:dist`) and served
  on the same listener as `/api` + `/files` — real files as-is,
  extensionless client routes fall back to `index.html`, and `/api/*`,
  `/files/*`, `/_/*` never fall back. `Dockerfile` is multi-stage
  (`web` Node → `gobuild` Go `CGO_ENABLED=0` → `runtime` Alpine, plus an
  `e2e` target for CI verification). Docker builds run **only** in GitHub
  Actions: `.github/workflows/release-image.yaml` triggers on a `v*` tag,
  runs the browser E2E suite against the built container, smoke-tests the
  `runtime` image (SPA shell, health, SQLite persistence across restart),
  enforces an image-size budget, and pushes
  `harbor.alexklingenbeck.de/my/stratofold:<version>` (ADR 0006). Repo
  secrets `HARBOR_ROBOT`/`HARBOR_TOKEN` hold the Harbor robot
  credentials; there is no local build/publish path. The cluster rollout
  lives in the separate `cloud.alexklingenbeck.de` GitOps repo and is
  deliberately not documented here. Verification: `go test
  ./internal/appserver/ -run SPA`; `npm --prefix web run build`; the
  release workflow on a `v*` tag.

## OpenSpec workflow

This repo is spec-driven via [OpenSpec](https://github.com/Fission-AI/OpenSpec)
(dev dependency in `package.json`, run with `npx openspec`):

- Required behavior lives in `openspec/specs/`; change proposals live in
  `openspec/changes/`.
- Use the repo-local skills in `.opencode/skills/` (`openspec-propose`,
  `openspec-apply-change`, `openspec-update-change`, `openspec-archive-change`,
  `openspec-sync-specs`, `openspec-explore`) instead of hand-rolling the
  workflow.
- `npx openspec validate --all --strict` is the only verification harness
  right now (plain `--strict` without an item errors when there is nothing
  targeted).
- Proposals must name the capability spec(s) they modify/create (or
  `skip_specs` for docs/tooling changes) and state explicitly whether an
  ADR is needed.

## Architecture decisions

Durable, stack-shaping decisions become ADRs in `docs/decisions/`
(copy `TEMPLATE.md`, add a row to the `README.md` index) **at the moment
they are made**, so later proposals inherit them instead of relitigating.
