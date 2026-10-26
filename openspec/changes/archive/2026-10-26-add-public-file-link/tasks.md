# Tasks

## 1. Copy action in the entry context menu

- [x] 1.1 Add an `isPublic` prop and a **Copy public link** row to `web/src/components/ContextMenu.tsx` (D1, D3, D5): render it only for `!entry.dir` and `isPublic`, place it after Download and before the writer actions, and reuse `LinkIcon`.
- [x] 1.2 Implement the clipboard write with local "Copied" feedback (D2, D4): copy `window.location.origin + filesUrl(vdirId, path)`, catch a rejected/unavailable `navigator.clipboard.writeText`, and claim success only on resolve; verify `web/src/components/ContextMenu.test.tsx` covers the copied URL (read back via user-event's clipboard stub), the non-public case, the directory case, and a rejected clipboard write.
- [x] 1.3 Wire publicness through `web/src/pages/BrowsePage.tsx`: pass `isPublic={publicMode || vdir?.is_public === true}` into `ContextMenu`; verify `web/src/pages/BrowsePage.test.tsx` covers a public vdir (signed-in and anonymous public mode) showing the action and a non-public vdir not showing it.

## 2. Documentation

- [x] 2.1 Document the action in `docs/using-stratofold.md` under "Public browsing" (and the sharing section if it reads better there): a file's context menu copies its direct public link, no token, revoked by un-publishing; verify the text matches the `web-ui` delta's scenarios.
- [x] 2.2 Update the `AGENTS.md` "Web UI" bullet to mention the context menu's Copy public link action; verify the bullet still matches the implementation.

## 3. Verification

- [x] 3.1 Run `npx openspec validate --all --strict` and confirm the change validates.
- [x] 3.2 Run `npm --prefix web run test` and confirm the component and browse-page suites pass.
- [x] 3.3 Run `npm --prefix web run e2e -- public-browsing` on the build/verification server, adding an assertion that the anonymous public browse context menu offers Copy public link and that the copied URL downloads the file.
