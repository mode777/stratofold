# Proposal

## Why

Extraction fails on archives that are fine. Every zip tool marks directory
entries with a trailing slash (`POLY_SurvivalWorkshop/`), and the strict
entry validator splits that slash into an empty segment, classifies the
entry as unsafe, and fails the whole job — so virtually every real-world
archive with explicit directory entries (Windows Explorer, 7-Zip, most
tools) is refused outright. Beyond that bug, the fail-the-whole-archive
policy is too blunt: one genuinely bad entry (a traversal name, a symlink,
an encrypted or corrupt member) destroys the utility of extracting the
other thousands of entries.

## What Changes

- Fix the name validator: an entry ending in exactly one `/` is the zip
  convention for a directory entry and is accepted (the slash is stripped
  before segment validation). This alone un-breaks normal archives such as
  the reported `POLY_SurvivalWorkshop/` case.
- Replace the fatal entry policy with skip-and-count: a per-entry problem —
  unsafe name (traversal, dotted/empty segments, absolute, backslash, NUL,
  invalid UTF-8), over-depth entry, symlink entry, encrypted entry,
  unsupported compression method, or member data that fails to decode
  (checksum mismatch, unreadable data) — skips that entry and continues;
  the job completes with everything else.
- A skipped invalid entry is never written and never rewritten to another
  path (no normalization — the strict validator stays strict, only the
  consequence changes from job failure to entry refusal).
- A member that fails mid-write has its partial scratch file removed before
  the job continues, so no truncated member is ever published.
- Job reporting distinguishes the two skip kinds: the existing `skipped`
  count keeps counting cosmetic metadata, a new count reports invalid
  entries, and the terminal snapshot carries a bounded list of skipped
  invalid entry names with a reason class so users can act on them.
- Guard against degenerate outcomes: if no member was extracted (every
  non-cosmetic entry was skipped), the job fails with an explicit error
  naming the dominant reason instead of publishing an empty folder as
  success.
- Global failures remain fatal and unchanged: not-a-zip / corrupt central
  directory, resource ceilings (entry count, total inflated bytes), lost
  connections beyond the retry budget, revoked access, target conflicts,
  and cancellation.
- The web UI surfaces the invalid-skip count (Uploads progress row, the
  extract sheet's result state) alongside the existing metadata-skip count.

Not a **BREAKING** change at the API shape level (the job snapshot only
gains a field), but observable behavior changes: archives that previously
failed now succeed with skips counted.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `archive-extraction`: the requirement "Entry paths are validated strictly
  and unsafe archives are refused" becomes "unsafe entries are skipped, not
  extracted" — per-entry refusal with skip-and-count semantics, the
  trailing-slash directory-entry convention accepted, corrupt members
  skipped with partial-output cleanup, and an all-skipped guard. The
  ceilings requirement's depth scenario moves from job failure to entry
  skip. The progress/result requirement gains the invalid-skip count and
  bounded skip details.

## Impact

- Code: `internal/archiveextract` (entry validation, scan, member
  extraction, job snapshot), `internal/fsapi` extract routes (no route
  changes; snapshot JSON gains a field), `web/src/lib/filesApi.ts` +
  `web/src/lib/extractJobs.ts` + `web/src/components/ExtractSheet.tsx` /
  `UploadPanel` (surface the new count).
- Docs: `docs/using-stratofold.md` and `docs/hosting.md` (the "refused as
  a whole" paragraphs), `AGENTS.md` (archive-extraction section), the
  archive-extraction spec. No ADR — this adjusts one capability's
  entry-disposition policy inside the existing ADR 0017 job model; no
  cross-cutting invariant changes, and the security posture (nothing
  unsafe is ever written, nothing normalized) is unchanged.

## Non-goals

- No normalization or rewriting of unsafe entry names to "recover" them —
  a refused entry is skipped, never relocated.
- No change to the cosmetic-metadata skip set (`__MACOSX/`, `._*`,
  `.DS_Store`, `Thumbs.db`) or to its counting.
- No new ceilings, no per-entry skip quota, and no partial/quarantine
  reporting beyond the bounded skip list; the entry-count ceiling already
  bounds scan cost.
- No extraction for formats other than zip, no password/encrypted-archive
  support (encrypted entries stay undecodable — now skipped rather than
  fatal), and no client-library (`client/`) changes (it does not wrap
  extract).
