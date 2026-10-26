# Architecture decisions

Short, numbered records of durable architecture decisions — the **why**
behind invariants that span multiple modules, formats, or milestones.
Behavior requirements live in `openspec/specs/`; the per-change process
records (proposals, full design docs) live in `openspec/changes/`; this
directory holds only what stays true after a change is archived.

## Index

| # | Status | Decision |
| - | ------ | -------- |
| 0001 | Accepted | The server is a single Go binary |
| 0002 | Accepted | PocketBase is the embedded application framework |
| 0003 | Accepted | SSH/SFTP via golang.org/x/crypto/ssh + github.com/pkg/sftp |
| 0004 | Accepted | One Docker image; SPA embedded via go:embed |
| 0005 | Accepted | SPA: React + Vite + TypeScript + Tailwind |
| 0006 | Accepted | Release images build in CI on `v*` tags and publish to Harbor |
| 0007 | Accepted | Optional pinned host key with trust on first use |
| 0008 | Accepted | iOS-style mobile-first SPA shell and design system |
| 0009 | Accepted | Installable PWA with no offline capability |
| 0010 | Accepted | Expiring capability links for session-less file access |
| 0011 | Accepted | Chromecast via the Web Sender SDK and the Default Media Receiver |

## Adding a decision

Copy [`TEMPLATE.md`](TEMPLATE.md) to `NNNN-short-slug.md`, fill it in,
and add a row to the index. Keep it short — context, decision,
consequences, rejected alternatives. Do not restate behavior that
`openspec/specs/` already pins down; link instead. Supersede by marking
the old entry Superseded and linking forward; do not delete accepted
records.
