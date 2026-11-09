# Design

## Context

See `proposal.md` for motivation. The server surface this package consumes
already exists and is pinned by specs: `POST /api/sf/vdirs/{id}/{ls,mkdir,mv,rm,upload}`,
`POST /api/sf/vdirs/{id}/links`, `GET /files/{id}/{path}`, and
`GET /api/sf/tokens/me` with header-only bearer auth (`vdir-access-tokens`,
`filesystem-api`, `file-server`, `file-links`). The SPA's own wrappers
(`web/src/lib/filesApi.ts`) already encode the endpoint shapes, upload
transport, and error classes, but they are relative-URL, cookie-oriented,
and coupled to app state, so they cannot be published as a package.

The one open server-side question is cross-origin preflight behavior for
the `/api/sf/*` custom routes: `tokens/me` and the filesystem routes carry
no explicit CORS middleware, relying on PocketBase's global CORS. That
middleware echoes the requested headers when `AllowHeaders` is empty, so
`Authorization` and `Content-Type` should pass, but no test currently
proves it. The cross-origin E2E is the proof; a gap is fixed in the server
inside this change.

## Goals / Non-Goals

**Goals:**

- One small, publish-ready package that a bundler or a `<script>` tag can
  consume, with an explicit server address and no runtime dependencies.
- A real second-origin consumer (the static test client) that exercises
  every operation and the public mode.
- A GitHub Pages deployment that never contains the maintainer's instance
  URL or token.

**Non-Goals:**

- Publishing to npm from CI, or owning/claiming the npm scope.
- Any server-embedded copy of the client (`/embed`).
- Migrating the SPA onto the package.
- Cross-origin cookie flows, OAuth, or per-visitor consent.

## Decisions

### D1 — Package layout and build: `client/` with tsc + esbuild

A standalone package at `client/` (not a root npm workspace, so the
existing `web/` install and scripts stay untouched):

- `src/index.ts` is the only entry; `tsc` emits the ESM build and `.d.ts`.
- `esbuild` bundles the same source into one IIFE file exposing the
  `Stratofold` global.
- `dist/` contains `index.js` (ESM), `stratofold.min.js` (IIFE), and
  `index.d.ts`. `package.json` declares `exports`/`types`/`files: ["dist"]`
  and no `dependencies`.
- Dev dependencies only: TypeScript, esbuild, Vitest.

*Rejected:* tsup/rollup/Vite library mode — more build config and
dependencies for a package whose only transforms are type stripping and a
bundle; npm workspaces — changes the root install shape for no benefit.

### D2 — One client instance, explicit scope, injected transport

`new StratofoldClient({ baseUrl, vdir, token?, fetch?, createXhr? })`.
`baseUrl` and `vdir` are required; there is no default or inferred server.
`token` is optional (public mode). The fetch/XHR factories exist purely as
test seams. `tokenInfo()` performs `/api/sf/tokens/me` so a caller that
knows only `baseUrl` and a token can learn its vdir and role.

*Rejected:* per-call `{ vdir, token }` arguments — noisy and easy to mix
scopes; discovering the vdir inside the constructor — a constructor with
a hidden network call, and it would break public mode.

### D3 — Transport split: fetch for JSON/read, XHR for upload

Listing, mutations, link minting, and scope discovery use `fetch` and
throw on non-2xx. `read` returns the raw `Response` so callers can stream,
copy to a blob, or read a range. Upload uses `XMLHttpRequest` because it is
the only browser transport that reports upload progress and supports
abort; the body is the request body and the target path is the query.

*Rejected:* `fetch` with a `ReadableStream` body — no progress, requires
`duplex`, and not portable; buffering then `fetch` — defeats progress and
wastes memory.

### D4 — URL construction mirrors the file server

`baseUrl` is normalized by stripping a trailing slash. JSON endpoints are
`<base>/api/sf/vdirs/<encoded vdir>/<op>`; file URLs are
`<base>/files/<encoded vdir>/<segment>/…` with each path segment
percent-encoded and empty segments dropped (the same rule as the SPA).
Link responses are relative `/s/…`, so they are resolved against
`baseUrl` before being returned. The client sends the virtual path in the
JSON body (not the URL) for filesystem operations, exactly as the server
expects.

*Rejected:* `URL`/`URLSearchParams` path joining — `URL` normalizes `..`
segments and can silently rewrite a virtual path; the server's sandbox is
the authority on resolution, so the client must not pre-normalize.

### D5 — Error model: one class, deterministic kinds, zero retries

`StratofoldError extends Error` with `kind` (`unauthorized`, `forbidden`,
`notfound`, `retryable`, `rejected`, `server`), `status`, and the server
message. Status mapping is identical to the SPA's `failureFor`. A network
failure before a status maps to `retryable` with `status: 0`. Upload
cancellation is the separate `UploadCanceled` class. Nothing retries
automatically — retries are the caller's policy, and the server's own
streaming/mutation retries are transparent.

*Rejected:* leaking `Response` objects for every failure — callers would
re-implement mapping; per-endpoint error types — the SPA already proved
one discriminated kind is enough.

### D6 — Public mode is the absence of a token

With no token, requests carry no `Authorization` header, so anonymous
public-vdir reads work through the same code path. `fileUrl` is a pure URL
builder and is always available. `temporaryUrl` and scope discovery require
a token; `temporaryUrl` rejects locally with `unauthorized` without a
request (minting is never anonymous), while mutations are still attempted
and the server's `401/403` decides — the client does not guess the
caller's role.

*Rejected:* a separate `PublicClient` type — duplicates the API and makes
`fileUrl` awkward; local write gating based on `tokenInfo` — stale and
still not the authority.

### D7 — Test client: private Vite app in `client/test-client/`

A single-page app (no router) with a connection form (base URL, token,
optional vdir id for public mode), an operation panel, and a result/error
log. It consumes the **built** package (`@stratofold/client` resolved to
`../dist`) so the E2E exercises the artifact, not the source. The token is
kept in `sessionStorage`, the base URL and last vdir in `localStorage`.
Local development can prefill from `VITE_SF_BASE_URL` / `VITE_SF_TOKEN` /
`VITE_SF_VDIR` in a gitignored `.env.local`, read only when
`import.meta.env.DEV` is true; the Vite config refuses a production build
when any of those variables is set, so a local build can never embed the
maintainer's instance or token.

*Rejected:* reusing the SPA as the test client — it is cookie-first and
would not prove the bearer/cross-origin path; auto-loading a demo token —
the only token available is a real one, and publishing it is a leak.

### D8 — Pages deployment via the official actions, from `main`

`.github/workflows/client-pages.yaml` runs on pushes to `main` touching
`client/**` (plus `workflow_dispatch`), builds the package and then the
test client with `base=/stratofold/`, uploads the static artifact, and
deploys with `actions/deploy-pages`. Permissions are `contents: read`,
`pages: write`, `id-token: write`; no repository secrets are used.

*Rejected:* committing a `gh-pages` branch — build artifacts in git;
publishing only on release tags — the test client should track the API
surface on `main`.

### D9 — Cross-origin E2E reuses the existing Go harness

The Playwright spec starts the existing `cmd/stratofold-e2e` stack
(unchanged) on `127.0.0.1:8090` and the test-client Vite server on
`127.0.0.1:5174` — two real origins. Setup is done through Playwright's
request context: authenticate as the seeded owner
(`/api/sf/auth` cookie, or the users auth endpoint for record reads), list
vdirs to pick the private and public ids, mint a `viewer` token through
`POST /api/sf/tokens`, then fill the UI and assert the in-page
cross-origin flows. Like the SPA suite, this runs only on the
build/verification server (`SF_E2E_EXECUTABLE` points at
chrome-headless-shell).

*Rejected:* a hand-written second-origin HTML fixture — it would duplicate
the UI the test client already is; proxying through Vite — it would hide
CORS instead of testing it.

### D10 — ADR 0013 records distribution, not the package internals

The durable decision is the delivery channel: **npm is the source of
truth; no instance-hosted embed; a static GitHub Pages test client is a
verification artifact, not a product feature.** The API shape and build
tooling stay in this design and can change without an ADR.

## Risks / Trade-offs

- [PocketBase's global CORS does not cover a preflighted custom route] →
  D9 asserts preflight for bearer JSON and upload; if it fails, add an
  explicit CORS middleware/header exposure to the `/api/sf/vdirs/*` group
  and keep the assertion.
- [Someone builds the Pages site locally with `.env.local` and deploys it,
  leaking the token] → the Vite config hard-fails a production build when
  any `VITE_SF_*` secret is present; the env file is gitignored; CI never
  has it.
- [A token embedded in the public Pages bundle by future changes] → the
  spec forbids it and the E2E asserts the token never appears in a URL;
  add a bundle scan for `sf_v1_` in the Pages build step.
- [Uploads restart from byte zero after a browser-level failure] → same
  limitation as the SPA (the server resumes within a request); documented
  in `client/README.md`.
- [The npm scope is not owned/claimed yet] → publication is a follow-on;
  package name and metadata are prepared but no CI publish step exists.
- [Test client drifts from the package API] → it imports the built
  package and the E2E exercises every operation; type-checking fails on
  drift.
- [The artifact is larger than expected for a "small" package] → the IIFE
  build is minified; the ESM build stays unbundled and tree-shakeable.

## Migration Plan

Purely additive: no data, schema, API, or server-image change. Rollback is
deleting `client/`, the Pages workflow, and the ADR/docs rows; nothing else
depends on them. Enabling Pages for the repository (Settings → Pages →
GitHub Actions) is a one-time manual step outside the code.
