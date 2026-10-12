<p align="center">
  <img src="web/public/icons/icon.svg" width="120" alt="Stratofold logo">
</p>

<h1 align="center">Stratofold</h1>

<p align="center">
  Your SSH hosts, as easy as a cloud drive.
</p>

Stratofold is a self-hosted cloud file manager: it turns SSH/SFTP hosts
you already have into something that works like Google Drive or Dropbox.
Files stay on your machines — Stratofold makes them browsable,
shareable, and streamable through the web, streaming directly between
the browser and the SSH source without caching anything server-side, so
multi-gigabyte transfers are ordinary.

- **Virtual directories** — pick a folder on any SSH host and it becomes
  one clean, browsable root in the app.
- **Sharing** — grant another user read (`viewer`) or write (`editor`)
  access per directory, or make a directory public for anyone with its
  link. Access is re-checked on every request; revocation is immediate.
- **Stream, don't cache** — downloads, media playback, and uploads all
  stream to and from the SSH source; uploads publish atomically and
  survive connection drops.
- **A real file server** — range requests, resumable downloads, and
  in-app previews for audio, images, and video.
- **One self-contained image** — the Go server embeds the web app; one
  process, one port, one data volume. Installable as a PWA.

## Quick start

```sh
docker volume create stratofold-data
docker run -d --name stratofold \
  -p 8090:8090 -v stratofold-data:/pb_data \
  harbor.alexklingenbeck.de/my/stratofold:latest

docker run --rm -it -v stratofold-data:/pb_data \
  harbor.alexklingenbeck.de/my/stratofold:latest \
  --dir=/pb_data superuser upsert admin@example.com 'S3cret-Passphrase'
```

Then open `http://127.0.0.1:8090/`, sign in as that admin, create users
under `/_/`, and connect your first SSH host. Serve it behind HTTPS in
production — the full walkthrough, including reverse-proxy notes,
upgrades, and backups, is in the
[hosting guide](docs/hosting.md).

## Documentation

- [Using Stratofold](docs/using-stratofold.md) — the end-user guide:
  accounts, connections, virtual directories, uploads, sharing, and the
  installed app.
- [Hosting Stratofold](docs/hosting.md) — the hosting guide: running
  the image, first-time setup, HTTPS, upgrading, and backup.

## For contributors

Start with [AGENTS.md](AGENTS.md) — it maps the repo and the OpenSpec
workflow. Architecture lives in
[docs/architecture.md](docs/architecture.md), durable decisions in the
[ADR index](docs/decisions/README.md), and required behavior in
[`openspec/specs/`](openspec/specs/).
