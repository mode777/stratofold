# Tasks

## 1. Design foundation

- [x] 1.1 Add the iOS design tokens (system font stack, system palette, grouped-surface radii, safe-area insets) to `web/src/index.css` via Tailwind v4 `@theme`; verify `npm --prefix web run build` succeeds and tokens are available as utilities.
- [x] 1.2 Add the inline SVG icon set in `web/src/components/icons.tsx` (folder, doc, film, music, image, chevrons, plus, ellipsis, trash, pencil, tray, gear, lock, wifi, warning, check, person); verify a component test renders each icon with an accessible label.
- [x] 1.3 Refactor `web/src/components/Dialog.tsx` into `Sheet` and `Alert` primitives (portal, grabber, focus trap, Escape/backdrop dismiss) and verify their tests cover open/close, Escape, and focus return.
- [x] 1.4 Write ADR `docs/decisions/0008-ios-mobile-spa-shell.md` (mobile-first iOS shell, tab-bar/sidebar adaptation, client-derived metadata, no embedded player) and add its row to `docs/decisions/README.md`; verify the index links resolve and the ADR matches `TEMPLATE.md`.

## 2. App shell and routing

- [x] 2.1 Build the responsive `AppShell` (bottom tab bar below `md`, persistent sidebar at `md`+) with Files / Uploads / Settings destinations and active-state indication; verify a component test asserts the active destination at mobile and wide viewports.
- [x] 2.2 Add the destination route map (`/`→`/files`, `/uploads`, `/settings`, pushed `/settings/*`, `/v/:vdirId/view/<path>`, unknown→not-found) and verify routing tests cover each destination and the redirect.
- [x] 2.3 Render the Uploads active count on the tab/sidebar and mount `FloatingUploadIndicator` on non-Uploads destinations while uploads are active; verify a test shows the badge/indicator only when the queue is active.
- [x] 2.4 Update `AGENTS.md`'s web-UI section to describe the iOS shell and tab destinations; verify the described routes match the implemented route map.

## 3. Login

- [x] 3.1 Restyle `LoginPage` to the iOS full-screen card (app mark, inset credential rows, password eye toggle, error banner, busy state); verify `web/src/pages/LoginPage.test.tsx` passes with the new structure and existing error scenarios.

## 4. Files tab: Locations

- [x] 4.1 Replace `VdirSwitcher` with the Files-tab Locations root ("My vdirs" / "Shared with me" groups, public pills, "Manage vdirs" link); verify tests cover own/shared grouping, public marking, empty states, and no connection exposure to grantees.
- [x] 4.2 Make selecting a vdir push the browse view and make `/` land on Locations; verify a test navigates from Locations into `/v/:vdirId`.

## 5. Browse, context menu, preview

- [x] 5.1 Rebuild the browse view as iOS list and 3-column grid with folder-first sorting, per-type tinted icons, middle-truncated names, and the compact toolbar (sort, list/grid toggle, writer-only New/Upload); verify `BrowsePage.test.tsx` covers list/grid switching, sorting, and role-gated toolbar visibility.
- [x] 5.2 Keep TanStack Virtual with iOS row/cell sizing; verify the existing 10k-entry virtualization test still passes for both views.
- [x] 5.3 Add back-chevron navigation plus the tappable breadcrumb path; verify tests cover entering a subdirectory, breadcrumb-to-ancestor, and back-to-parent/at-root-to-Files.
- [x] 5.4 Add the long-press context menu with role-gated actions and a keyboard/focus affordance; verify tests cover writer vs viewer menus and keyboard activation.
- [x] 5.5 Add the non-media preview route/screen (name, size, modified, download) while media keeps opening in a new tab; verify tests cover preview metadata and that media entries still open `/files` in a new tab.

## 6. File-operation overlays

- [x] 6.1 Implement New Folder and Rename as `Sheet`s, Delete as an `Alert`, and Move as a pushed folder-tree picker; verify `FileOpsDialogs` tests cover success, validation, and the delete confirmation gate.
- [x] 6.2 Wire each operation to the existing `filesApi` wrappers and refresh the listing on success; verify tests assert the listing updates and `404` surfaces the not-found state.

## 7. Uploads destination

- [x] 7.1 Move the queue UI into the Uploads destination with Pause All / Resume All, per-item progress and lifecycle state, cancel and retry; verify `UploadPanel.test.tsx` (re-pointed) covers all six states and the controls.
- [x] 7.2 Keep `uploadQueue.ts` / `useUploadQueue` unchanged and wire the destination plus `FloatingUploadIndicator` to it; verify `uploadQueue.test.ts` and `useUploadQueue.test.tsx` pass unmodified.

## 8. Settings and Connections

- [x] 8.1 Build the Settings destination (account section with email/name and sign-out-on-all-devices, Connections and Virtual Directories rows with counts); verify a test covers sign-out confirmation and navigation into each section.
- [x] 8.2 Restyle the Connections list and the full-height Connection form (password/private-key segmented control, write-only secret placeholders, host-key TOFU hint, remote directory, delete row); verify `ConnectionsPage.test.tsx` covers create/edit/delete and the secret-placeholder behavior.

## 9. Virtual directories and Sharing

- [x] 9.1 Restyle the Vdirs list and the vdir form (connection picker with remote-dir default, public switch with footer, sharing entry, delete row); verify `VdirsPage.test.tsx` covers create/edit/delete, public toggle, and own-connections-only binding.
- [x] 9.2 Restyle Sharing as a pushed screen (invite by email with Viewer/Editor role rows, people list with role change/revoke, self-share guard, duplicate error); verify `ShareDialog.test.tsx` (re-pointed) covers grant, role change, revoke, self-share, and duplicate rejection.

## 10. Error, empty, and not-found states

- [x] 10.1 Restyle the loading/empty and four API error states (not-found, forbidden, retryable-with-retry, generic) and add the Page Not Found screen; verify `ErrorStates.test.tsx` covers each state and that retry appears only for retryable failures.

## 11. Integration verification

- [x] 11.1 Re-point the Playwright suite (`web/e2e/`) at the new selectors and run it on the build/verification server (`npm --prefix web run e2e`); verify login → browse → download, upload (small + large, navigate-away), mutations, role gating, and not-found all pass.
- [x] 11.2 Run the full local gates `npm --prefix web run test`, `npm --prefix web run build`, and `npx openspec validate --all --strict`; verify all pass.
