# Tasks

## 1. Server connection-string producer

- [x] 1.1 Add `internal/vdirtokens/connection.go` with the `sfconn_v1_` prefix, payload type, and an encoder that validates an absolute `http`/`https` base URL plus non-empty vdir and token; add `connection_test.go` round-trip and invalid-input tests. Verify with `go test ./internal/vdirtokens/ -run Connection`.
- [x] 1.2 Add request-origin derivation (TLS, first `X-Forwarded-Proto`, first `X-Forwarded-Host`, then `Host`; trim and validate; report unusable rather than guessing) with table-driven tests. Verify with `go test ./internal/vdirtokens/ -run Origin`.
- [x] 1.3 Add the optional `connection_string` field to `handleMint`, omit it when the origin is unusable, and add route tests covering the decoded facts, direct HTTPS, proxied HTTPS/forwarded host, and absent fields from list, introspection, and rejected mints. Verify with `go test ./internal/vdirtokens/`.

## 2. Client library

- [x] 2.1 Add `client/src/connectionString.ts` exporting `parseConnectionString` and its result type; enforce the prefix, base64url alphabet, JSON shape, `v === 1`, an origin-only absolute `http`/`https` base URL, and non-empty vdir/token, raising `ConfigurationError` on every malformed class. Add unit tests for a valid value and each rejection. Verify with `npm --prefix client run test`.
- [x] 2.2 Add `StratofoldClient.fromConnectionString(value, overrides?)`, export the parser and types from `client/src/index.ts`, and test base URL/vdir/token wiring, `baseUrl`/fetch/XHR overrides, no request during parsing, absence of the secret from request URLs, and the IIFE global. Verify with `npm --prefix client run test`.
- [x] 2.3 Document the connection-string flow in `client/README.md` (mint, paste, `fromConnectionString`, override, error handling) and verify the README snippets with `npm --prefix client run typecheck:readme`.

## 3. Test client

- [x] 3.1 Add a connection-string input and apply action to `client/test-client/index.html` and `main.ts`: parse through the package, fill base URL/vdir/token, save through the existing browser storage, clear the pasted value, and report an invalid value without changing the current connection. Add unit tests for success, failure, and non-persistence. Verify with `npm --prefix client/test-client run test`.
- [x] 3.2 Extend `client/test-client/e2e/client.spec.ts` to mint a token, apply the returned `connection_string`, list successfully, and assert no request URL contains the string or token. Verify on the build/verification server with `npm --prefix client/test-client run e2e`.
- [x] 3.3 Verify a production test-client build still contains no checked-in secret and refuses `VITE_SF_*` values, with `npm --prefix client/test-client run build` and a scan of `client/test-client/dist`.

## 4. Web UI

- [x] 4.1 Add optional `connection_string` to `MintedToken` and render it in the Connected apps one-time panel with its own copy state, a secret warning, distinct copy-failure text, omission when the field is absent, and clearing on dismiss. Add component tests for both values, copy success/failure, dismissal, and list absence. Verify with `npm --prefix web run test`.
- [x] 4.2 Add a browser E2E spec that signs in, mints a token under Settings → Connected apps, and asserts the one-time panel shows an `sfconn_v1_` value without exposing it in the list. Verify on the build/verification server with `npm --prefix web run e2e -- connected-apps.spec.ts`.

## 5. Documentation and ADR

- [x] 5.1 Write `docs/decisions/0016-app-connection-strings.md` from `TEMPLATE.md` covering the opaque format, origin rule, no-URL/one-time handling, and rejected alternatives, then add its row to `docs/decisions/README.md`. Verify the file structure against the template and the index link.
- [x] 5.2 Update `docs/roadmap.md` with an additive follow-on entry for this change and shift the still-unwritten connect-flow/OAuth ADR references, then update `docs/using-stratofold.md` (Connected apps offers a connection string), `docs/hosting.md` (forwarded headers shape the embedded origin; client `baseUrl` override), `docs/architecture.md` (mint response and client factory), `AGENTS.md` (app-token and client-library guidance), and the root `README.md` app-token bullet. Verify by grepping for stale token-only wording and confirming each documented command/field matches the implementation.

## 6. Integration verification

- [x] 6.1 Run the local gates: `go vet ./... && go test ./...`, `npm --prefix client run test`, `npm --prefix client run typecheck:readme`, `(cd client && node scripts/check-pack.mjs)`, `npm --prefix client/test-client run test`, `npm --prefix web run test`, and `npx openspec validate --all --strict`.
- [x] 6.2 On the build/verification server, run the Go suite with the external OpenSSH fixture mode if configured, the test-client E2E, and the Connected apps E2E; confirm a string minted by the real server parses in the package and drives a successful request.

## Workflow follow-up

- Archive the change after review confirms ADR 0016 is written and indexed.
