// Operation-layer primitives for the filesystem API: the retry loop,
// error classification → HTTP mapping, and the remote operation
// bodies (recursive delete, parent-creating mkdir, rename with
// already-applied detection, atomic upload publication). The package
// and route documentation lives in fsapi.go.
package fsapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
	"github.com/mode777/stratofold/internal/vdir"
	"github.com/mode777/stratofold/internal/vdirpath"
)

// MaxAttempts bounds reconnect cycles per logical operation (the
// upload transfer has its own budget in sftpreadwrite). A var so the
// kill-storm tests can shrink it.
var MaxAttempts = 8

var (
	// errBadRequest reports an invalid request shape (design D6).
	errBadRequest = errors.New("fsapi: invalid request")
	// errNotADirectory reports a target that exists where a directory
	// is required — mapped 404 ("does not resolve to a remote
	// directory"), never retried.
	errNotADirectory = errors.New("fsapi: not a directory")
	// errConflict reports a remote-state conflict that can never
	// succeed by retrying (e.g. a regular file in mkdir's way).
	errConflict = errors.New("fsapi: conflicting remote state")
	// ErrRetriesExhausted reports retryable failures that used up the
	// attempt budget (design D6: mapped 503).
	ErrRetriesExhausted = errors.New("fsapi: operation failed after exhausting the retry budget")
)

// classify augments ssherr with this package's own permanent
// sentinels; unknown errors stay conservatively retryable (ssherr's
// contract) and the attempt bound still fails them loudly.
func classify(err error) ssherr.Class {
	switch {
	case errors.Is(err, errNotADirectory), errors.Is(err, errConflict):
		return ssherr.Permanent
	default:
		return ssherr.Classify(err)
	}
}

// withRetry runs fn against a client from p and re-runs it on
// retryable failures (design D3): the client is invalidated and fn
// runs again against the re-established connection, observing
// whatever state earlier attempts left behind — each operation's
// already-applied semantics live inside its fn, so a retried
// operation converges to the same final state as a single
// application. Permanent errors return immediately; retryable
// failures exhausting MaxAttempts return ErrRetriesExhausted.
func withRetry(ctx context.Context, p sshconn.ClientProvider, maxAttempts int, fn func(cl *sftp.Client) error) error {
	for attempt := 1; ; attempt++ {
		cl, release, err := p.Client(ctx)
		if err != nil {
			return err
		}
		opErr := fn(cl)
		release()
		if opErr == nil {
			return nil
		}
		if classify(opErr) == ssherr.Permanent || ctx.Err() != nil {
			return opErr
		}
		p.Invalidate(cl)
		if attempt >= maxAttempts {
			return fmt.Errorf("%w: %w", ErrRetriesExhausted, opErr)
		}
	}
}

// httpStatus maps a final operation error to its deterministic HTTP
// status (design D6): sandbox rejections, unknown records, and
// not-found targets → 404; permission denied → 403; invalid request
// shape → 400; retryable-class (including exhausted budgets and
// unreachable hosts) → 503; everything else → 500.
func httpStatus(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
	case errors.Is(err, errBadRequest):
		return http.StatusBadRequest
	case errors.Is(err, ErrRetriesExhausted):
		return http.StatusServiceUnavailable
	case errors.Is(err, vdir.ErrEscape),
		errors.Is(err, vdir.ErrInvalidConfig),
		errors.Is(err, vdir.ErrNotADirectory),
		errors.Is(err, vdirpath.ErrOutsideRoot),
		errors.Is(err, vdirpath.ErrInvalidPath),
		errors.Is(err, errNotADirectory),
		errors.Is(err, sql.ErrNoRows),
		errors.Is(err, os.ErrNotExist),
		errors.Is(err, sftp.ErrSSHFxNoSuchFile):
		return http.StatusNotFound
	case errors.Is(err, os.ErrPermission),
		errors.Is(err, fs.ErrPermission),
		errors.Is(err, sftp.ErrSSHFxPermissionDenied):
		return http.StatusForbidden
	}

	var statusErr *sftp.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.FxCode() {
		case sftp.ErrSSHFxNoSuchFile:
			return http.StatusNotFound
		case sftp.ErrSSHFxPermissionDenied:
			return http.StatusForbidden
		}
	}

	if classify(err) == ssherr.Retryable {
		return http.StatusServiceUnavailable
	}
	return http.StatusInternalServerError
}

// respondErr writes the mapped error as a PocketBase API error body.
func respondErr(e *core.RequestEvent, err error) error {
	switch httpStatus(err) {
	case http.StatusBadRequest:
		return e.BadRequestError("Invalid request", err) // TEMP debug
	case http.StatusNotFound:
		return e.NotFoundError("Not found", nil)
	case http.StatusForbidden:
		return e.ForbiddenError("Forbidden", nil)
	case http.StatusServiceUnavailable:
		return e.Error(http.StatusServiceUnavailable, "Remote host unavailable", nil)
	default:
		return e.InternalServerError("Internal error", nil)
	}
}

// remoteRemoveAll deletes path recursively with Lstat semantics
// (design D4): symlinks are removed as links — never followed, so the
// walk cannot leak out of the tree — and any component that is
// already gone counts as deleted, making a retry after a mid-walk
// connection drop converge to the fully deleted state (design D3).
func remoteRemoveAll(cl *sftp.Client, path string) error {
	fi, err := cl.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !fi.IsDir() {
		return cl.Remove(path)
	}
	entries, err := cl.ReadDir(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, en := range entries {
		if err := remoteRemoveAll(cl, path+"/"+en.Name()); err != nil {
			return err
		}
	}
	return cl.RemoveDirectory(path)
}

// remoteMkdirAll creates the remaining components one by one under the
// resolved anchor dir (design D3): an already-existing directory
// counts as success (earlier retry attempt or concurrent creator),
// anything else in the way is a conflict that no retry can fix.
func remoteMkdirAll(cl *sftp.Client, dir string, comps []string) error {
	cur := dir
	for _, comp := range comps {
		cur += "/" + comp
		err := cl.Mkdir(cur)
		if err == nil {
			continue
		}
		fi, lerr := cl.Lstat(cur)
		if lerr == nil {
			if fi.IsDir() {
				continue
			}
			return fmt.Errorf("%w: %s exists and is not a directory", errConflict, cur)
		}
		return err
	}
	return nil
}

// mkdirExistsDir verifies the mkdir target itself when it already
// exists (no remaining components): an existing directory is success,
// anything else is a conflict.
func mkdirExistsDir(cl *sftp.Client, dir string) error {
	fi, err := cl.Lstat(dir)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		return fmt.Errorf("%w: %s exists and is not a directory", errConflict, dir)
	}
	return nil
}

// remoteMv renames src to dst with already-applied detection (design
// D3): source present → rename (PosixRename replaces an existing
// target); source gone and target present → this mv already applied,
// success; both gone → the source vanished for good, permanent
// not-found. Replacing a directory with a file can never succeed and
// is surfaced as a conflict instead of a retry loop.
func remoteMv(cl *sftp.Client, src, dst string) error {
	if fi, err := cl.Lstat(dst); err == nil && fi.IsDir() {
		if sfi, serr := cl.Lstat(src); serr == nil && !sfi.IsDir() {
			return fmt.Errorf("%w: %s is a directory", errConflict, dst)
		}
	}
	_, err := cl.Lstat(src)
	if err == nil {
		return cl.PosixRename(src, dst)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// The source is gone: either this mv already applied, or it can
	// never apply.
	if _, terr := cl.Lstat(dst); terr == nil {
		return nil
	}
	return fmt.Errorf("fsapi: mv: neither %s nor %s exists: %w", src, dst, os.ErrNotExist)
}

// publish replaces target with the completed temp file (design D5).
// PosixRename is the atomic replace; a vanished temp with the target
// in place means an earlier attempt already published (apply/ack
// lost) — success. A directory at the target can never be replaced by
// a file and is a conflict.
func publish(cl *sftp.Client, temp, target string) error {
	if fi, err := cl.Lstat(target); err == nil && fi.IsDir() {
		return fmt.Errorf("%w: %s is a directory", errConflict, target)
	}
	err := cl.PosixRename(temp, target)
	if err == nil {
		return nil
	}
	if errors.Is(err, os.ErrNotExist) {
		if _, lerr := cl.Lstat(target); lerr == nil {
			return nil // already published by an earlier attempt
		}
	}
	return err
}
