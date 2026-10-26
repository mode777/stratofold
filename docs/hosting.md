# Hosting Stratofold

How to run Stratofold as a self-hosted service with the released Docker
image. For what the app does once it is running, see
[Using Stratofold](using-stratofold.md).

## What you are deploying

A single self-contained image: one process that serves the web app, the
HTTP API, and the file streaming routes on one port, keeping all
persistent state in a SQLite database inside one data directory intended
to be mounted as a volume
([deployment spec](../openspec/specs/deployment/spec.md): *"The SPA is
embedded and served by the server binary"*, *"One image, one process,
one persistent data directory"*). There is no separate static host, no
external database, no mounted asset directory.

- Image: `harbor.alexklingenbeck.de/my/stratofold` — tagged with the
  release version (`0.2.0`) and `latest` ([deployment spec](../openspec/specs/deployment/spec.md):
  *"The image is published to the project registry"*; published by CI
  from a `v*` release tag, see
  [`.github/workflows/release-image.yaml`](../.github/workflows/release-image.yaml)).
- Listens on port `8090`, data lives under `/pb_data`, and the process
  runs as a non-root user (uid/gid `1000`) ([`Dockerfile`](../Dockerfile),
  `runtime` stage: `EXPOSE 8090`, `VOLUME /pb_data`, `USER stratofold`).
- The image stays under a 100 MB size budget, enforced in CI
  ([release workflow](../.github/workflows/release-image.yaml),
  `IMAGE_SIZE_BUDGET_MB`).

## Quick start

```sh
docker volume create stratofold-data
docker run -d --name stratofold \
  -p 8090:8090 \
  -v stratofold-data:/pb_data \
  harbor.alexklingenbeck.de/my/stratofold:latest

curl -fsS http://127.0.0.1:8090/api/health
```

When the health endpoint answers, the app is up at
`http://127.0.0.1:8090/`. If you opened the browser before creating an
admin, that is fine — sign-in just has no account to accept yet.

## First-time setup

Create the first admin account (the command runs once against the same
data volume and exits; this is the exact pattern the release pipeline
smoke-tests):

```sh
docker run --rm -it -v stratofold-data:/pb_data \
  harbor.alexklingenbeck.de/my/stratofold:latest \
  --dir=/pb_data superuser upsert admin@example.com 'S3cret-Passphrase'
```

- Admins manage the instance in the embedded PocketBase admin UI at
  `http://127.0.0.1:8090/_/` (PocketBase is the embedded application
  framework — [ADR 0002](decisions/0002-pocketbase-embedded.md)).
- Regular users are created by the admin in that admin UI (users
  collection); there is no self-signup. Users then sign in at the app
  root with their email and password
  ([web-ui spec](../openspec/specs/web-ui/spec.md): *"Unauthenticated
  users see only the login screen"*).

## Production notes

- **Serve behind HTTPS.** The session cookie (`sf_session`, HttpOnly,
  `SameSite=Lax`) is marked `Secure` when the request arrived over
  HTTPS — direct TLS or a reverse proxy that sets
  `X-Forwarded-Proto: https`
  ([`internal/authbridge/cookie.go`](../internal/authbridge/cookie.go)).
  Put a TLS-terminating reverse proxy in front of the container and
  forward that header so sessions are secure and install-as-app (PWA)
  works, which requires a secure context
  ([pwa spec](../openspec/specs/pwa/spec.md)).
- **One port for everything.** `/` (web app), `/api/*`, `/files/*`, and
  `/_/` (admin UI) are all served by the same listener — nothing needs a
  second upstream.
- **State survives restarts.** Users and virtual directories live in the
  SQLite database under `/pb_data` and are still present after the
  container is stopped and started again with the same volume
  ([deployment spec](../openspec/specs/deployment/spec.md): *"State
  survives a container restart"*).
- **Temporary file links and `/s/`.** A 24-hour link is a bearer
  credential for one file: anyone who gets the URL can download it until
  it expires. The app redacts the token from its own request log, but a
  reverse proxy sees the full path — redact or disable access logging for
  `/s/`, and do not put the app behind a cache that stores those
  responses. `/s/` streams exactly like `/files/`: disable proxy
  buffering and preserve `Range` headers so seeking and long media
  playback work. Links are fixed at 24 hours; there is no server setting
  to change that today.
- **Casting.** The in-app Cast button uses the Google-hosted Web Sender
  SDK, so the sender page needs HTTPS and internet access to
  `www.gstatic.com`; the Cast device must be able to reach the Stratofold
  origin and trust its TLS certificate (a public CA, not an internal one).
  A self-hosted instance on an internal CA or a LAN-only name cannot
  cast. Casting is Chromium-only (no Safari/Firefox/iOS Chrome/AirPlay).
  There is no server-side Cast setting; links minted for a cast follow the
  24-hour `/s/` rules above.
- **Shutdown is graceful.** On `SIGTERM` the server stops accepting new
  connections and lets in-flight requests finish or fail cleanly rather
  than silently truncating them
  ([deployment spec](../openspec/specs/deployment/spec.md): *"The server
  shuts down gracefully"*) — so `docker stop`/`docker compose down` are
  safe mid-transfer.

## Upgrading

Pull the newer tag and recreate the container with the same data volume:

```sh
docker pull harbor.alexklingenbeck.de/my/stratofold:latest
docker rm -f stratofold
docker run -d --name stratofold \
  -p 8090:8090 \
  -v stratofold-data:/pb_data \
  harbor.alexklingenbeck.de/my/stratofold:latest
```

All persistent state is in the volume, so replacing the container loses
nothing. Pin a version tag (`0.2.0`) instead of `latest` if you want to
control upgrade timing yourself.

## Backup and restore

Back up the whole `/pb_data` directory (the SQLite database and any
PocketBase-managed files). The safe way is a consistent copy while the
container is stopped:

```sh
docker stop stratofold
docker run --rm -v stratofold-data:/pb_data -v "$PWD:/backup" alpine \
  cp -a /pb_data /backup/stratofold-data
docker start stratofold
```

**Why the whole directory matters:** connection secrets (SSH passwords
and private keys) are sealed at rest with a key that lives inside the
same database (`_params` table, row `sf_sealbox_key`). Losing that key —
for example by restoring a database without it — orphans every stored
secret, and there is no key rotation yet. Treat the data directory as a
single unit.

Restore is the inverse: stop the container, replace the directory from
your backup, start the container.

## Building from source

Docker builds run exclusively in the project's CI
([ADR 0006](decisions/0006-release-image-publishing.md)); this guide
intentionally does not cover building your own image. If you want to
hack on Stratofold, start with [`AGENTS.md`](../AGENTS.md) and
[`docs/architecture.md`](architecture.md).

## Fact sources

| Fact | Source |
| --- | --- |
| One image, one process, one data directory | [deployment spec](../openspec/specs/deployment/spec.md) |
| Image reference and tags | [deployment spec](../openspec/specs/deployment/spec.md) + [release workflow](../.github/workflows/release-image.yaml) |
| Port 8090, `/pb_data`, non-root uid 1000 | [`Dockerfile`](../Dockerfile) `runtime` stage |
| Health endpoint | [release workflow](../.github/workflows/release-image.yaml) smoke test |
| Superuser command | [`AGENTS.md`](../AGENTS.md) + release workflow smoke test |
| Cookie `Secure` over HTTPS / `X-Forwarded-Proto` | [`internal/authbridge/cookie.go`](../internal/authbridge/cookie.go) |
| Restart/shutdown guarantees | [deployment spec](../openspec/specs/deployment/spec.md) |
| Sealed-secrets key caveat | [`AGENTS.md`](../AGENTS.md) ("Connections & vdirs") |
