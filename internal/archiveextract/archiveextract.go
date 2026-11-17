// Package archiveextract extracts a remote zip archive into an equally
// named folder beside it without downloading it (the archive-extraction
// spec): the archive is read through ranged, retried SFTP reads and each
// member is written back through the resumable transfer, so nothing is
// buffered host-side and a dropped connection resumes mid-member.
//
// The work runs as an in-memory job (ADR 0017): Start registers a job and
// returns immediately, the caller observes it by polling a snapshot, and
// a DELETE-equivalent cancel stops it. Jobs do not survive a restart.
//
// Publication is atomic: members are written into a hidden scratch
// directory beside the archive and published with one rename, so a
// partially extracted folder is never browsable and a failed job leaves
// nothing behind.
package archiveextract

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"time"

	"github.com/mode777/stratofold/internal/ssherr"
)

// Resource ceilings (the archive-extraction spec's "resource ceilings"
// requirement). They are enforced on inflated bytes and created entries,
// never on sizes an archive declares about itself; the declared totals are
// only used for the advisory pre-flight refusal in scan.
//
// This block is the single documented location for the limits.
const (
	// MaxEntries bounds how many archive members one extraction may
	// create.
	MaxEntries = 100_000
	// MaxDepth bounds the number of path segments of one member.
	MaxDepth = 64
	// MaxUncompressedBytes bounds the total inflated size of one
	// extraction.
	MaxUncompressedBytes int64 = 50 << 30 // 50 GiB
)

// Tunables that tests shrink. They are vars for the same reason
// fsapi.MaxAttempts is.
var (
	// MaxConcurrentJobs bounds how many jobs run at once server-wide;
	// beyond it Start refuses with ErrBusy rather than queueing.
	MaxConcurrentJobs = 4
	// JobRetention is how long a terminal job stays observable.
	JobRetention = 10 * time.Minute
)

// Extraction errors. Each maps to a deterministic HTTP status through
// Status, so the API's error classes stay one taxonomy (the
// filesystem-api spec's "Extraction failures use the filesystem API's
// error classes" requirement).
var (
	// ErrUnsafeEntry reports an archive member whose name or metadata
	// cannot be extracted safely. Never retried.
	ErrUnsafeEntry = errors.New("archiveextract: unsafe archive entry")
	// ErrUnsupportedArchive reports a source that is not a zip, uses an
	// unsupported method, is encrypted, or exceeds a ceiling. Never
	// retried.
	ErrUnsupportedArchive = errors.New("archiveextract: unsupported archive")
	// ErrBudget reports an archive that would exceed a resource ceiling
	// while actually inflating. Never retried.
	ErrBudget = errors.New("archiveextract: resource ceiling exceeded")
	// ErrTargetExists reports an existing target folder; the caller
	// resolves it by choosing another name. Never retried.
	ErrTargetExists = errors.New("archiveextract: target folder exists")
	// ErrAlreadyRunning reports a second extraction of the same archive
	// and target while one is running. Never retried.
	ErrAlreadyRunning = errors.New("archiveextract: extraction already running")
	// ErrForbidden reports access withdrawn while the job was running.
	ErrForbidden = errors.New("archiveextract: write access withdrawn")
	// ErrBusy reports the concurrency budget being exhausted. Retryable.
	ErrBusy = errors.New("archiveextract: too many extractions running")
	// ErrRetriesExhausted reports recovery attempts running out.
	ErrRetriesExhausted = errors.New("archiveextract: operation failed after exhausting the retry budget")
)

// Classification sentinels distinguish which rule an entry broke, so scan
// can record a skip reason (design D2) without changing the public error
// taxonomy: every sentinel below still wraps its owning error above.
var (
	errUnsafeName = errors.New("unsafe entry name")
	errEntryDepth = errors.New("entry too deep")
	errSymlink    = errors.New("symbolic link entry")
	errEncrypted  = errors.New("encrypted entry")
	errCompress   = errors.New("unsupported compression method")
)

// Status maps an extraction error to the HTTP status the API reports for
// it. ok is false for errors this package does not classify, letting the
// API layer apply its own mapping.
func Status(err error) (int, bool) {
	switch {
	case err == nil:
		return http.StatusOK, true
	case errors.Is(err, ErrUnsafeEntry),
		errors.Is(err, ErrUnsupportedArchive),
		errors.Is(err, ErrBudget):
		return http.StatusBadRequest, true
	case errors.Is(err, ErrTargetExists), errors.Is(err, ErrAlreadyRunning):
		return http.StatusConflict, true
	case errors.Is(err, ErrForbidden),
		errors.Is(err, os.ErrPermission),
		errors.Is(err, fs.ErrPermission):
		return http.StatusForbidden, true
	case errors.Is(err, ErrBusy), errors.Is(err, ErrRetriesExhausted):
		return http.StatusServiceUnavailable, true
	case errors.Is(err, os.ErrNotExist):
		return http.StatusNotFound, true
	}
	var readErr *memberReadError
	if errors.As(err, &readErr) {
		return http.StatusBadRequest, true
	}
	return 0, false
}

// jobStatus is the status a terminal job records for err: the owned
// classes above, otherwise the transfer's retryable class as 503 and
// everything else as 500.
func jobStatus(err error) int {
	if status, ok := Status(err); ok {
		return status
	}
	if ssherr.Classify(err) == ssherr.Retryable {
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}
