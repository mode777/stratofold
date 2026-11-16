package archiveextract

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
)

// client is the slice of *sftp.Client this package drives, so the retry
// and cleanup helpers stay testable with a fake.
type client interface {
	Lstat(path string) (os.FileInfo, error)
	ReadDir(path string) ([]os.FileInfo, error)
	MkdirAll(path string) error
	Remove(path string) error
	RemoveDirectory(path string) error
	Rename(oldname, newname string) error
	PosixRename(oldname, newname string) error
}

// errNotExist is a local alias so the helpers read the same as fsapi's.
var errNotExist = os.ErrNotExist

// withRetry runs fn against a client from p and re-runs it on retryable
// failures (the filesystem API's retry model): the client is invalidated
// and fn runs again against the re-established connection. Permanent
// failures return immediately; exhausted budgets return
// ErrRetriesExhausted.
func withRetry(ctx context.Context, p sshconn.ClientProvider, maxAttempts int, fn func(cl client) error) error {
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
		if ssherr.Classify(opErr) == ssherr.Permanent || ctx.Err() != nil {
			return opErr
		}
		p.Invalidate(cl)
		if attempt >= maxAttempts {
			return fmt.Errorf("%w: %w", ErrRetriesExhausted, opErr)
		}
	}
}

// removeAll deletes a tree with Lstat semantics: symlinks are removed as
// links, never followed, and an already-missing component counts as
// deleted so a retried cleanup converges.
func removeAll(ctx context.Context, p sshconn.ClientProvider, root string) error {
	return withRetry(ctx, p, 8, func(cl client) error {
		return removeAllAt(cl, root)
	})
}

func removeAllAt(cl client, path string) error {
	fi, err := cl.Lstat(path)
	if err != nil {
		if errors.Is(err, errNotExist) {
			return nil
		}
		return err
	}
	if !fi.IsDir() {
		return cl.Remove(path)
	}
	entries, err := cl.ReadDir(path)
	if err != nil {
		if errors.Is(err, errNotExist) {
			return nil
		}
		return err
	}
	for _, en := range entries {
		if err := removeAllAt(cl, path+"/"+en.Name()); err != nil {
			return err
		}
	}
	if err := cl.RemoveDirectory(path); err != nil && !errors.Is(err, errNotExist) {
		return err
	}
	return nil
}
