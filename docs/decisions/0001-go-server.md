# 0001 — The server is a single Go binary

Status: Accepted (2026-10)

## Context

The vision prioritizes binary size and low memory footprint (always-on
streaming of tens-of-gigabyte transfers) and single-artifact distribution.
PocketBase — a Go framework — was a candidate, which effectively presupposes
Go. All server concerns (auth/users, REST API, file server, SSH connection
manager) must live in one process.

## Decision

The server is written in Go (stable toolchain, CGO-free) and shipped as one
static binary containing the PocketBase core, the custom REST API, the
streaming file server, and the SSH connection manager. SQLite is the only
database.

## Consequences

Goroutine-based streaming with no per-connection memory overhead;
`go:embed` gives single-binary packaging; PocketBase's pure-Go SQLite
driver keeps `CGO_ENABLED=0` cross-compilation possible. The project is
committed to Go for all server work — no polyglot backend.

## Rejected alternatives

- Node/TypeScript: bigger runtime memory footprint and distribution
  (runtime + node_modules vs one binary).
- Rust: smallest footprint, but slower iteration and no equivalent of
  PocketBase's batteries-included users/admin/REST.
- JVM languages: unacceptable footprint for a self-hosted file manager.
