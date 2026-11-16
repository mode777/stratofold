# Proposal

## Why

Users keep archives on their SSH hosts — a photo dump, a project snapshot,
a downloaded release bundle — and today the only way to use one is to
download it, unpack it locally, and upload every member back. That makes
Stratofold strictly worse than the Drive-like product it mimics: iOS Files
(and every other file manager) extracts an archive in place. The remote
files are already reachable through the vdir sandbox, and the streaming
primitives needed to unpack them without a host-side copy already exist
(`sftpreadwrite` ranged reads for the archive, resumable writes for each
member), so the gap is a missing operation rather than missing
infrastructure.

## What Changes

- The filesystem API gains an **archive extraction job**:
  `POST /api/sf/vdirs/{vdirId}/extract` takes a virtual path to a `.zip`
  and extracts it into an equally named folder beside the archive
  (`docs/photos.zip` → `docs/photos/`), answering `202` with a job
  identifier. `GET …/extract/{jobId}` reports progress and the terminal
  result; `DELETE …/extract/{jobId}` cancels.
- Extraction runs server-side and streams: the archive is read in place
  through ranged SFTP reads (no download), members are inflated and
  written back through the existing resumable writer, and nothing is
  buffered host-side beyond a bounded window. A dropped connection
  resumes mid-member instead of restarting.
- Publication is atomic: members are written into a hidden temporary
  directory beside the archive, and one rename produces the final folder.
  A failed, canceled, or rejected extraction publishes nothing, and a
  half-extracted folder is never browsable.
- Entry names are validated against a **strict** rule set (no traversal
  segments, no absolute paths, no backslashes, no NUL, no symlink
  entries, no encrypted entries) rather than the normalizing rules that
  guard user-typed virtual paths. A structural violation fails the whole
  archive and publishes nothing; cosmetic junk (`__MACOSX/`, `.DS_Store`,
  `Thumbs.db`) is skipped and counted. A bounded entry/uncompressed-size
  budget stops decompression bombs on a running counter, not on
  attacker-declared sizes.
- Extraction requires write access (owner or `editor` share) and never
  follows `is_public`. Consent is re-checked between entry batches, so a
  revoked share stops a running job instead of letting it write for its
  remaining duration.
- The SPA classifies archives as their own entry kind and offers
  **Extract** in the context menu for archive files to writers, with an
  explicit confirmation selecting the target folder name, a `409`
  collision path that offers an alternative name, live progress with
  cancel, and a listing refresh when the new folder appears.
- Listings stop showing Stratofold's own in-flight scratch names (the
  temporary file and directory names behind upload publication and
  extraction), so a running operation is never a browsable artifact — and
  never mistaken for the folder it is about to publish. Legitimate
  dot-prefixed remote entries keep listing.

Assumptions (recorded, not blocking): extraction tasks are shown on the
existing Uploads destination beside uploads rather than in a new
navigation destination (a nav rename stays open); the archive file itself
is kept after extraction; a zip with a single top-level directory is not
flattened, because "equally named folder" is the requested behavior and
what iOS does; job state is in-process only, matching the in-memory
upload queue and the PWA's deliberate lack of offline behavior.

## Capabilities

### New Capabilities

- `archive-extraction`: the extraction job contract — request/observation/
  cancel endpoints, job phases and states, folder naming and collision
  rules, strict entry validation, cosmetic skips, resource ceilings,
  atomic publication, retry/resumption, and cancellation semantics.

### Modified Capabilities

- `filesystem-api`: the write path gains a long-running operation, so its
  access-control requirement extends to extraction (write access, no
  `is_public` write, re-checked mid-job) and its error mapping extends to
  job creation and job observation.
- `web-ui`: the entry-kind classifier gains an archive kind, the
  context-menu requirement gains the writer-only Extract action, and a
  new requirement pins the confirmation sheet, progress/cancel surface,
  collision handling, and post-extraction listing refresh.

No delta to `upload-queue`: extraction reuses the Uploads *destination*
as a surface but not the upload manager's queue semantics (ordering,
pause, one-active-per-target), which are upload-specific.

## Impact

- Code (server): a new `internal/archiveextract` package (job registry,
  entry validation, zip reader over an SFTP `io.ReaderAt`, extraction
  driver); a small `io.ReaderAt` adapter over
  `sftpreadwrite.Transfer.ReadRange`; three routes registered in
  `internal/fsapi` alongside the existing `/api/sf/vdirs/{id}/*` routes;
  reuse of `vdir.Resolver`/`ResolveAncestor` for the archive path,
  `requestauth.AuthorizeVdir` for access, and `vdirauthz` for the
  mid-job re-check; a scratch-name filter in `readDirEntries`.
- Code (SPA): `web/src/lib/entryKind.ts` archive kind;
  `web/src/components/ContextMenu.tsx` action; a new
  `web/src/lib/extractJobs.ts` tracker plus hook, an extraction confirm
  sheet, and an extraction row in the Uploads panel/floating indicator.
- Tests: hostile-archive and entry-validation tables, job lifecycle and
  cancellation, collision, revocation mid-job, chaos/resume, memory gate
  under `SF_RUN_GATES=1`, and SPA component tests plus an E2E extraction
  flow on the verification server.
- Docs: **new ADR `docs/decisions/0017-long-running-jobs.md`** (why
  long-running operations are in-memory jobs polled over the API rather
  than synchronous responses or durable job records) added to the
  `docs/decisions/README.md` index; `docs/architecture.md` (filesystem API
  route table, job seam, non-goals note); `docs/using-stratofold.md`
  (extracting an archive, what gets skipped, why a zip may be refused);
  `docs/hosting.md` (the remote disk needs room for the unpacked tree
  beside the archive; job state is lost on restart); both `AGENTS.md`
  filesystem-API and web-UI bullets; `docs/roadmap.md` follow-on entry.
- No breaking change: existing routes, schemas, and clients are
  unaffected; a client that never calls `/extract` sees no difference.

## Non-goals

- No formats beyond `.zip` in this change. `tar`/`tar.gz`, `7z`, `rar`,
  multi-volume archives, and single-stream compressors (`.gz`, `.xz`,
  `.zst` — which produce a file, not a folder) stay out; the reader is a
  registry seam so a later change adds a format without reshaping the
  job API.
- No password-protected archives: decrypting is out of scope, and such an
  archive is refused explicitly rather than half-extracted.
- No flattening, renaming, or merging: an existing target folder is a
  `409` the client resolves, never a silent merge.
- No bulk extraction (several archives, a folder, or a selection), and no
  "extract here" alternative destination.
- No durable job queue: jobs do not survive a server restart, and no
  cross-restart resume or cleanup daemon is promised.
- No browser-side unzip and no transfer of archive bytes to the client.
- No `extract` in `@stratofold/client`; the bearer path would work but the
  client library is not extended here.
- No dynamic vdir viewing *into* an archive (a virtual folder over zip
  contents) and no remote `unzip` execution over an SSH session — the
  server keeps streaming bytes, as the architecture's non-goals require.
