package archiveextract

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
)

// Request is one extraction, already authorized and sandbox-resolved by
// the caller: the archive exists and is a zip (content-checked), and the
// target folder does not exist.
type Request struct {
	VdirID string
	// Path and Target are the virtual paths used for reporting only.
	Path   string
	Target string

	// ArchiveRemote, ArchiveSize, and DirRemote describe the resolved
	// remote source; TargetName is the validated folder name.
	ArchiveRemote string
	ArchiveSize   int64
	DirRemote     string
	TargetName    string

	Provider sshconn.ClientProvider
	// Authorize re-checks write access between member batches. A
	// non-nil error aborts the job (design D9).
	Authorize func(context.Context) error
	Options   sftpreadwrite.Options

	// MaxBytes and MaxEntries override the package ceilings when set.
	// They exist so bounded tests (and, later, host tuning) can work
	// with small archives; zero means the package default.
	MaxBytes   int64
	MaxEntries int
}

// byteCeiling is the request's effective inflated-bytes ceiling.
func (r Request) byteCeiling() int64 {
	if r.MaxBytes > 0 {
		return r.MaxBytes
	}
	return MaxUncompressedBytes
}

// entryCeiling is the request's effective entry-count ceiling.
func (r Request) entryCeiling() int {
	if r.MaxEntries > 0 {
		return r.MaxEntries
	}
	return MaxEntries
}

// TargetRemote is the resolved remote path the folder is published at.
func (r Request) TargetRemote() string { return r.DirRemote + "/" + r.TargetName }

// SourceBase is the archive's remote file name.
func (r Request) SourceBase() string { return path.Base(r.ArchiveRemote) }

// Start registers a job for req and runs it in the background.
func Start(ctx context.Context, reg *Registry, req Request) (*Job, error) {
	if reg == nil {
		reg = Default()
	}
	temp, err := scratchName(req.DirRemote, req.SourceBase())
	if err != nil {
		return nil, err
	}
	key := req.VdirID + "\x00" + req.Path + "\x00" + req.TargetName
	snap := Snapshot{Path: req.Path, Target: req.Target}
	return reg.Start(ctx, req.VdirID, snap, key, func(jobCtx context.Context, j *Job) error {
		return run(jobCtx, req, temp, j)
	})
}

// run performs scan → extract → publish. Any failure (including
// cancellation) removes the scratch directory; a success has already
// renamed it into place, so nothing half-extracted is ever visible.
func run(ctx context.Context, req Request, temp string, j *Job) (err error) {
	defer func() {
		if err != nil {
			cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
			if rerr := removeAll(cctx, req.Provider, temp); rerr != nil {
				// Cleanup is best-effort; the job's own error is the
				// one worth reporting.
				_ = rerr
			}
		}
	}()

	tr := sftpreadwrite.New(req.Provider, req.ArchiveRemote, req.Options)
	zr, err := Open(ctx, tr, req.ArchiveSize)
	if err != nil {
		return err
	}
	members, err := scan(ctx, zr, j, req.entryCeiling())
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	if err := withRetry(ctx, req.Provider, 8, func(cl client) error {
		return cl.MkdirAll(temp)
	}); err != nil {
		return err
	}

	j.setPhase(PhaseExtracting)
	dirs := &dirCache{}
	for i, m := range members {
		if err := ctx.Err(); err != nil {
			return err
		}
		if i%64 == 0 {
			if err := checkAccess(ctx, req); err != nil {
				return err
			}
		}
		if err := extractMember(ctx, req, j, temp, dirs, m); err != nil {
			return err
		}
	}

	// Nothing was extracted at all — every entry was skipped as invalid
	// (or the archive holds nothing but cosmetic metadata): an empty
	// folder is never presented as a successful result (design D5).
	if j.Snapshot().EntriesDone == 0 {
		if reason, ok := j.dominantSkip(); ok {
			return fmt.Errorf("%w: nothing could be extracted: every entry was skipped as %s", ErrUnsupportedArchive, reason)
		}
		return fmt.Errorf("%w: nothing could be extracted: the archive contains no extractable entries", ErrUnsupportedArchive)
	}

	j.setPhase(PhasePublishing)
	if err := checkAccess(ctx, req); err != nil {
		return err
	}
	return publish(ctx, req, temp)
}

// checkAccess runs the caller's mid-job write re-check.
func checkAccess(ctx context.Context, req Request) error {
	if req.Authorize == nil {
		return nil
	}
	if err := req.Authorize(ctx); err != nil {
		if errors.Is(err, ErrForbidden) {
			return err
		}
		return fmt.Errorf("%w: %v", ErrForbidden, err)
	}
	return nil
}

// member is one entry scheduled for extraction.
type member struct {
	f    *zip.File
	segs []string
}

// scan validates every entry, skips cosmetic metadata, computes the
// advisory totals a job reports before extraction starts (design D7), and
// — since invalid entries skip instead of failing the job — records one
// skip per refused entry (design D2). The declared sizes are only a
// pre-flight warning: enforcement happens on inflated bytes.
func scan(ctx context.Context, zr *zip.Reader, j *Job, entryCeiling int) ([]member, error) {
	out := make([]member, 0, len(zr.File))
	var declared int64
	skipped := 0
	entries := 0
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// Every central-directory record counts toward the ceiling
		// before validation (design D6): an archive made of invalid
		// entries cannot dodge the scan bound.
		entries++
		if entries > entryCeiling {
			return nil, fmt.Errorf("%w: archive has more than %d entries", ErrBudget, entryCeiling)
		}
		if segs, err := ValidateEntryName(f.Name); err != nil {
			j.skipInvalid(f.Name, skipReason(err))
			continue
		} else if err := CheckSupported(f); err != nil {
			j.skipInvalid(f.Name, skipReason(err))
			continue
		} else if IsCosmetic(segs) {
			skipped++
			continue
		} else {
			// The declared size only feeds the advisory totals the
			// job reports; the enforced ceiling counts bytes actually
			// inflated (design D7), because a declared size is
			// attacker-controlled.
			declared += int64(f.UncompressedSize64)
			out = append(out, member{f: f, segs: segs})
		}
	}
	j.setTotals(len(out), declared)
	j.setSkipped(skipped)
	return out, nil
}

// skipReason maps an entry validation error to its skip reason (design
// D2's closed vocabulary); anything unclassified is a name rule.
func skipReason(err error) SkipReason {
	switch {
	case errors.Is(err, errEntryDepth):
		return ReasonDepth
	case errors.Is(err, errSymlink):
		return ReasonSymlink
	case errors.Is(err, errEncrypted):
		return ReasonEncrypted
	case errors.Is(err, errCompress):
		return ReasonUnsupportedCompression
	default:
		return ReasonUnsafeName
	}
}

// extractMember writes one member into the scratch directory. A member's
// bytes go through the budget reader into the resumable transfer, so an
// entry that inflates past the ceiling fails instead of filling the
// remote disk. A member whose own bytes cannot be read (checksum
// mismatch, broken stream) is skipped: its partial output is removed and
// the extraction continues (design D4) — no truncated member is ever
// published.
func extractMember(ctx context.Context, req Request, j *Job, temp string, dirs *dirCache, m member) error {
	j.entryStarted(m.f.Name)
	target := temp + "/" + strings.Join(m.segs, "/")

	if m.f.FileInfo().IsDir() {
		if err := dirs.ensure(ctx, req.Provider, target); err != nil {
			return err
		}
		j.entryDone(0)
		return nil
	}
	if err := dirs.ensure(ctx, req.Provider, temp+"/"+strings.Join(m.segs[:len(m.segs)-1], "/")); err != nil {
		return err
	}

	rc, err := m.f.Open()
	if err != nil {
		// The member's own data cannot even be opened — an
		// entry-quality failure like a broken stream, not a connection
		// problem: skip it (design D4).
		j.skipInvalid(m.f.Name, ReasonCorrupt)
		return nil
	}
	defer func() { _ = rc.Close() }()

	remaining := req.byteCeiling() - j.Snapshot().BytesDone
	if remaining <= 0 {
		return fmt.Errorf("%w: extraction reached %d bytes", ErrBudget, req.byteCeiling())
	}
	tr := sftpreadwrite.New(req.Provider, target, memberOptions(req.Options))
	n, err := tr.WriteAll(ctx, newBudgetReader(rc, remaining), -1)
	if err != nil {
		var readErr *memberReadError
		if errors.As(err, &readErr) {
			if errors.Is(err, ErrBudget) {
				return fmt.Errorf("%w: extraction would exceed %d bytes", ErrBudget, req.byteCeiling())
			}
			// The member's stored bytes are unreadable (checksum
			// mismatch, broken stream). Remove the partial file so no
			// truncated member can be published with the folder, then
			// skip and continue (design D4). A removal that itself
			// fails must fail the job: publishing a truncated member
			// is worse than losing the extraction.
			if rerr := withRetry(ctx, req.Provider, 8, func(cl client) error {
				return cl.Remove(target)
			}); rerr != nil {
				return fmt.Errorf("archiveextract: remove partial member %q after %v: %w", m.f.Name, readErr, rerr)
			}
			j.skipInvalid(m.f.Name, ReasonCorrupt)
			return nil
		}
		return err
	}
	applyMeta(ctx, req.Provider, target, m.f)
	j.entryDone(n)
	return nil
}

// memberOptions makes the member reader's own failures permanent for the
// transfer: a ceiling breach and a checksum mismatch are facts about the
// archive, not a flaky connection, so the writer must report them instead
// of retrying them against the host.
func memberOptions(base sftpreadwrite.Options) sftpreadwrite.Options {
	prev := base.Classifier
	base.Classifier = func(err error) ssherr.Class {
		var readErr *memberReadError
		if errors.As(err, &readErr) {
			return ssherr.Permanent
		}
		if prev != nil {
			return prev(err)
		}
		return ssherr.Classify(err)
	}
	return base
}

// applyMeta applies the entry's mode and modification time best-effort:
// neither is worth failing an otherwise complete extraction over.
func applyMeta(ctx context.Context, p sshconn.ClientProvider, target string, f *zip.File) {
	mode := f.Mode()
	if mode == 0 && f.Modified.IsZero() {
		return
	}
	cl, release, err := p.Client(ctx)
	if err != nil {
		return
	}
	defer release()
	if mode != 0 {
		_ = cl.Chmod(target, mode.Perm())
	}
	if !f.Modified.IsZero() {
		_ = cl.Chtimes(target, f.Modified, f.Modified)
	}
}

// publish renames the scratch directory into place (design D6), after a
// pre-flight existence check so an existing folder is a conflict rather
// than a merge. PosixRename is tried first — it is atomic and reliable
// about a non-empty target — with a plain rename as the fallback for
// servers without the extension.
func publish(ctx context.Context, req Request, temp string) error {
	target := req.TargetRemote()
	return withRetry(ctx, req.Provider, 8, func(cl client) error {
		if _, err := cl.Lstat(target); err == nil {
			// An earlier attempt may already have renamed and then
			// lost the connection: a missing scratch and an existing
			// target mean this attempt's work is done.
			if _, terr := cl.Lstat(temp); errors.Is(terr, errNotExist) {
				return nil
			}
			return fmt.Errorf("%w: %s", ErrTargetExists, target)
		} else if !errors.Is(err, errNotExist) {
			return err
		}
		if err := cl.PosixRename(temp, target); err == nil {
			return nil
		}
		return cl.Rename(temp, target)
	})
}

// scratchName builds the hidden scratch directory name beside the
// archive: .<archive>.sfext-<hex>. The listing filter hides exactly this
// shape (and the upload equivalent), so a running operation is never a
// browsable artifact.
func scratchName(dir, archiveBase string) (string, error) {
	var rnd [8]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return "", fmt.Errorf("archiveextract: scratch name: %w", err)
	}
	return dir + "/." + archiveBase + ".sfext-" + hex.EncodeToString(rnd[:]), nil
}

// dirCache remembers which directories of the scratch tree already
// exist, so one member per directory does not re-create it. It is
// bounded: a pathological archive cannot grow it without limit.
type dirCache struct {
	seen map[string]bool
}

func (d *dirCache) ensure(ctx context.Context, p sshconn.ClientProvider, dir string) error {
	if d.seen == nil {
		d.seen = make(map[string]bool, 64)
	}
	if d.seen[dir] {
		return nil
	}
	if len(d.seen) >= 8192 {
		d.seen = make(map[string]bool, 64)
	}
	if err := withRetry(ctx, p, 8, func(cl client) error {
		return cl.MkdirAll(dir)
	}); err != nil {
		return err
	}
	d.seen[dir] = true
	return nil
}
