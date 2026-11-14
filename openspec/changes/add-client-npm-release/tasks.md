# Tasks

## 1. Client release workflow

- [x] 1.1 Add `.github/workflows/release-client.yaml` with the `v*` tag
      trigger, a `workflow_dispatch` re-run path, `contents: read` plus
      `id-token: write`, no dependency cache, and a
      `release-client-${{ github.ref }}` concurrency group. Verify the
      file parses with
      `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'
      .github/workflows/release-client.yaml` and that the trigger,
      permissions, and concurrency match `design.md`.
- [x] 1.2 Add the pre-publish guards: reject non-tag refs, derive the
      version from `GITHUB_REF_NAME`, compare it with
      `client/package.json`, assert `npm --version` is at least 11.5.1,
      and assert `repository.url` normalizes to
      `https://github.com/${GITHUB_REPOSITORY}`. Verify each guard fails
      with a non-zero exit for a deliberately wrong input in a local
      shell copy of the step, and that no version is rewritten.
- [x] 1.3 Add the early duplicate check: query
      `npm view "@stratofold/client@$VERSION" version`, skip with a
      success notice when the version exists, and continue when the
      registry has no such version (including the not-yet-published
      package). Verify the step's shell exits `0` on the skip path and
      that `npm publish` is not reached on that path.
- [x] 1.4 Add `client/scripts/check-pack.mjs`: run
      `npm pack --dry-run --json`, fail if any entry is outside
      `dist/**`, `README.md`, or `package.json`, fail if `dist/index.js`
      or the type declarations are missing, and fail if
      `dependencies`, `optionalDependencies`, `peerDependencies`, or
      `bundledDependencies` are non-empty. Add the `npm ci`,
      `npm test`, `npm run typecheck:readme`, and
      `node scripts/check-pack.mjs` steps to the workflow. Verify from
      `client/` that `npm ci && npm test && npm run typecheck:readme &&
      node scripts/check-pack.mjs` succeeds and that a temporarily
      widened `files` entry makes the script exit non-zero.
- [x] 1.5 Add the publish step: `npm publish --access public` from
      `client/` with no `NPM_TOKEN`/`NODE_AUTH_TOKEN` reference and no
      `--provenance` flag (trusted publishing attaches provenance).
      Verify a repository-wide search finds no npm credential reference
      in the workflow, and that `id-token: write` is present exactly
      where OIDC needs it.

## 2. Documentation and decision record

- [x] 2.1 Write `docs/decisions/0014-client-npm-release.md` from
      `docs/decisions/TEMPLATE.md` covering the tag lockstep, the separate
      OIDC workflow, the bootstrap, and the rejected alternatives; add
      its row to `docs/decisions/README.md`. Amend ADR 0013's stale
      "does not automate publishing" consequence to point at 0014.
      Verify the index row resolves, the ADR sections match the template,
      and ADR 0013 no longer claims publishing is manual without naming
      0014.
- [x] 2.2 Rewrite the `client/README.md` Publishing section: remove
      "Publishing is not automated", document the version-bump-then-tag
      flow, the trusted-publisher setup (repository, `release-client.yaml`,
      and the direct `npm publish` permission), the manual first-publish
      bootstrap, npm's two-day validation window, and the re-run no-op.
      Replace the broken `npm --prefix client pack --dry-run` command with
      a command that runs in `client/`. Verify the documented commands run
      as written and `node scripts/check-pack.mjs` accepts the current
      tarball.
- [x] 2.3 Update `AGENTS.md`'s browser-client section with the release
      workflow, the tag/package version lockstep, and the trusted-publishing
      requirement. Update `docs/roadmap.md` change 11 to drop "npm
      publishing from CI" from its out-of-scope list and renumber the
      unscheduled follow-ons' provisional ADRs (0014/0015 → 0015/0016).
      Verify every referenced path and workflow filename exists and
      `rg "npm publishing from CI|Publishing is not automated"
      client/README.md AGENTS.md docs/roadmap.md docs/decisions` finds no
      stale text.

## 3. Verification

- [x] 3.1 Run `npx openspec validate --all --strict` and confirm the
      change and all specs validate.
- [x] 3.2 Run the package gates the workflow uses:
      `npm --prefix client run test`,
      `npm --prefix client run typecheck:readme`, and from `client/`
      `node scripts/check-pack.mjs`. Confirm the workflow runs the same
      commands from `client/` and not through `--prefix`.
- [x] 3.3 Confirm the release pipelines stay independent: the client
      workflow has its own trigger/concurrency and does not reference the
      image workflow, and `release-image.yaml` is unchanged. Verify by
      diffing the workflows and inspecting their `on` blocks.
- [ ] 3.4 After merge, perform the operator bootstrap: publish a
      bootstrap version manually (the current version is acceptable, or
      the next planned version), add the npm trusted publisher for
      `mode777/stratofold` with `release-client.yaml` and the direct
      `npm publish` permission, then bump `client/package.json` to a new
      version and push the matching `v*` tag within npm's two-day window.
      Verify the workflow succeeds through OIDC,
      `npm view @stratofold/client@<version>` reports the tag version,
      and the npm package page shows a provenance statement.
