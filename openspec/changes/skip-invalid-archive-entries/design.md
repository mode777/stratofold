# Design

## Context

`internal/archiveextract` implements the archive-extraction spec: a scan
pass walks the zip central directory (`run.scan`) validating each entry
(`entry.ValidateEntryName`, `zip.CheckSupported`), then an extract pass
writes members into a hidden scratch directory and publishes it with one
rename. Today any per-entry validation failure aborts the whole job
(design D4 of the original change: fail-closed, "intent refused rather
than erased").

The reported failure exposes two problems at once:

1. `ValidateEntryName` splits `POLY_SurvivalWorkshop/` into
   `["POLY_SurvivalWorkshop", ""]` — the trailing slash that the zip
   format uses to mark directory entries is misread as an empty segment.
   Test fixtures only ever create file entries (`w.Create(name)`), so the
   convention was never covered. Nearly every archive made by a real tool
   (Windows Explorer, 7-Zip, WinRAR, …) carries such entries.
2. Even for genuinely bad entries, one bad name destroys a potentially
   100k-entry extraction.

See proposal.md for the agreed policy: all per-entry problems skip;
corrupt member data skips with cleanup; an all-skipped extraction fails.

## Goals / Non-Goals

**Goals:**

- Keep the strict, non-normalizing validator — only the *consequence* of
  refusal changes (job failure → entry skip).
- Keep every global failure fatal: zip parse/sniff, byte and entry
  ceilings, retry-exhausted connections, revoked access, target conflict,
  cancellation.
- Keep the job snapshot the single observable surface: skip outcomes are
  data there, not new error classes.

**Non-Goals:**

- No config flag to restore fail-closed behavior, no per-reason counters,
  no translation of reason strings.
- No recovery/rewriting of unsafe names (no normalization, ever).
- No change to the cosmetic skip set or its counting.

## Decisions

**D1 — Accept the trailing-slash directory convention in the validator.**
`ValidateEntryName` strips exactly one trailing `/` before splitting;
`POLY_SurvivalWorkshop/` → `["POLY_SurvivalWorkshop"]`, `docs/2026/` →
`["docs", "2026"]`. A name that is only `/` or ends `//` still yields an
empty segment and is refused. Rejected: special-casing in `scan` via
`f.FileInfo().IsDir()` — Go derives `IsDir` from the same trailing slash,
so trimming in the validator is the identical fact in one pure, exported,
unit-tested place.

**D2 — Classify skips at the two points where entries die.** Scan-time
rejections (name rules, depth, symlink, encrypted, unsupported
compression) and extraction-time decode failures (the existing
`memberReadError` wrapping member reads: checksum mismatch, unreadable
data) both record one skip record and continue. No extra pass over the
directory. A skip record is `{name, reason}` with a closed reason
vocabulary: `unsafe-name`, `depth`, `symlink`, `encrypted`,
`unsupported-compression`, `corrupt`. Rejected: a separate validation
sweep before scan — it would re-read the central directory for no benefit.

**D3 — Reporting: one new count plus a bounded sample.** `Snapshot` keeps
`skipped` (cosmetic only, as today) and gains `skippedInvalid int` and
`skippedDetails []{name, reason}` capped at the first 16 records; the
count keeps the true total. The cap bounds snapshot JSON for hostile
archives. Rejected: one counter per reason class (counters multiply and
the sample already tells the user what to do); rejected reporting skips
only in logs (the job snapshot is the only surface the UI polls).

**D4 — Corrupt-member skip removes the partial file.** `extractMember`
already wraps member reads in `memberReadError`, and `memberOptions`
already classifies those Permanent — so `WriteAll` never retries them
against the host. On a `memberReadError`, remove the member's partially
written scratch file (`withRetry` + `cl.Remove`), record a `corrupt` skip,
and continue. If the removal itself fails, fail the job: continuing would
risk publishing a truncated member once the scratch directory is renamed
into place. `ErrBudget` from the budget reader stays fatal — it is a
global ceiling, not an entry-quality fact.

**D5 — All-skipped guard fires after extraction, before publish.** If the
member loop finishes with `entriesDone == 0` (no file or directory member
extracted — every non-cosmetic entry skipped, or the archive held only
cosmetic metadata), fail with the unsupported-archive class (HTTP 400)
naming the dominant reason (the most frequent skip reason, or "the
archive contains no extractable entries" when there was nothing to
extract). Deciding at the end rather than in scan is required: an
extraction-time `corrupt` skip can be the reason nothing was extracted.
Deliberate edge tightenings, settled during apply: a cosmetic-only
archive previously "succeeded" publishing an empty folder, and a
0-entry archive did the same; both now fail explicitly (an empty folder
is never a result). Rejected: publishing the empty folder as success
(user decision — misleading); rejected failing at scan time (wrong for
the corrupt-single-member case).

**D6 — Every central-directory record counts toward the entry ceiling.**
`scan` increments its entry counter *before* validation, so an archive
made entirely of invalid entries cannot dodge the scan bound. The byte
ceiling is unchanged: it counts inflated bytes of members actually
written; skipped entries never inflate.

**D7 — Web surface mirrors the snapshot.** `ExtractJobJson` in
`web/src/lib/filesApi.ts` gains optional `skippedInvalid` and
`skippedDetails`; the Uploads progress row renders the split ("2 skipped:
1 invalid, 1 metadata") and the bounded sample names with short labels
(`skipSummary`/`skipNames`/`skipLabel` in `web/src/lib/extractJobs.ts`)
for terminal jobs of any state. `skipped` keeps its meaning, so existing
renderings stay correct. Settled during apply: the ExtractSheet itself
renders nothing — it closes on the 202 and never observes terminal state,
so the Uploads row is the sole result surface for skip reporting (the
planning note that named "the ExtractSheet result state" misread the
component's role). Rejected: merging both kinds into one number (users
could not tell junk metadata from lost content).

**D8 — Tests flip from refusal to skip, and the fixtures learn directory
entries.** `buildZip` gains the ability to emit real directory entries
(`FileHeader` with trailing-slash names), including the regression shape
`POLY_SurvivalWorkshop/`. `TestExtractRefusesUnsafeEntries`, the symlink
and encrypted tests become the skip matrix: state `succeeded`, target
published without the offending path, `skippedInvalid`/`skippedDetails`
asserted; new cases cover the all-skipped guard, the checksum-broken
member (requires a fixture that writes a member then corrupts its stored
CRC/data bytes), the partial-file removal, and depth-skip.

## Risks / Trade-offs

- [Skip-and-count could mask a hostile archive behind a "success"] → the
  terminal snapshot always carries the invalid count and named sample;
  nothing unsafe is ever written, and no name is ever normalized — the
  original security posture (refuse, don't rewrite) is intact.
- [A fully encrypted archive now scans fully instead of failing fast] →
  the scan is directory-only and bounded by the entry ceiling; the
  all-skipped guard still refuses before any publish.
- [Remove of a partial file adds a failure point mid-extraction] → if the
  removal fails the job fails and the whole scratch directory is deleted
  (existing failure path); no truncated member can be published.
- [Cosmetic-only archives now fail] → deliberate (D5); documented in the
  user guide so nobody hunts for a regression.
- [Snapshot JSON grows] → bounded by the 16-record sample; the count is a
  single integer.

## Migration Plan

Single deploy; no schema or on-disk format changes. In-flight jobs die
with the old process per ADR 0017 regardless. Rollback is redeploying the
previous image; jobs are in-memory and a rollback mid-extraction abandons
scratch directories that the next extraction in that folder sweeps
(existing behavior). Clients that only read `skipped` keep working — new
fields are additive.
