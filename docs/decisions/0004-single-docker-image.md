# 0004 — One Docker image; SPA embedded via go:embed

Status: Accepted (2026-10)

## Context

The vision pins distribution to a single Docker image containing frontend
and backend. A separate static host/CDN would contradict the
single-artifact goal.

## Decision

The Vite production build of the SPA is embedded into the server binary
with `go:embed` and served from it. The multi-stage Dockerfile builds the
SPA with Node, builds the Go binary with `CGO_ENABLED=0`, and the runtime
image (Alpine) contains only the binary. One process, one HTTP port,
SQLite on a mounted volume.

## Consequences

Deployment is `docker run` with one volume; no reverse-proxy coupling to
static hosting. Accepted costs: frontend changes always produce a backend
release, and scaling is single-node only (SQLite) — horizontal scaling is
explicitly out of scope for now.

## Rejected alternatives

- Separate frontend deployment (object storage/CDN): two artifacts to
  operate, CORS and auth-cookie plumbing across origins.
- Mounting the SPA into the container as a volume: version drift between
  image and assets.
