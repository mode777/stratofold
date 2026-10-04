package fsapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/ssherr"
	"github.com/mode777/stratofold/internal/testssh"
	"github.com/mode777/stratofold/internal/vdir"
	"github.com/mode777/stratofold/internal/vdirpath"
)

// The operation-layer unit rows (tasks 1.1/1.2): the retry loop's
// retryable/permanent/exhaustion behavior over the SSH fixture, and
// the deterministic error→status table.

func newFixtureProvider(t *testing.T) *testssh.Fixture {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	t.Cleanup(f.Close)
	return f
}

func TestWithRetryRetriesRetryableToSuccess(t *testing.T) {
	f := newFixtureProvider(t)
	mgr, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	attempts := 0
	err = withRetry(context.Background(), mgr, MaxAttempts, func(cl *sftp.Client) error {
		attempts++
		if attempts == 1 {
			// Unknown errors are conservatively retryable.
			return fmt.Errorf("transient churn")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("withRetry = %v, want nil", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2 (one retryable failure, one success)", attempts)
	}
}

func TestWithRetryReturnsPermanentImmediately(t *testing.T) {
	f := newFixtureProvider(t)
	mgr, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	attempts := 0
	want := fmt.Errorf("gone: %w", os.ErrNotExist)
	err = withRetry(context.Background(), mgr, MaxAttempts, func(cl *sftp.Client) error {
		attempts++
		return want
	})
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v, want the permanent error returned", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1 (permanent errors are never retried)", attempts)
	}
}

func TestWithRetryExhaustsBudget(t *testing.T) {
	f := newFixtureProvider(t)
	mgr, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	attempts := 0
	err = withRetry(context.Background(), mgr, 3, func(cl *sftp.Client) error {
		attempts++
		return fmt.Errorf("still broken")
	})
	if !errors.Is(err, ErrRetriesExhausted) {
		t.Fatalf("err = %v, want ErrRetriesExhausted", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3 (the whole budget)", attempts)
	}
}

func TestHTTPStatusMapping(t *testing.T) {
	rows := []struct {
		name string
		err  error
		want int
	}{
		{"nil", nil, 200},
		{"bad request", fmt.Errorf("wrap: %w", errBadRequest), 400},
		{"retries exhausted", fmt.Errorf("wrap: %w", ErrRetriesExhausted), 503},
		{"vdir escape", fmt.Errorf("wrap: %w", vdir.ErrEscape), 404},
		{"vdir invalid config", fmt.Errorf("wrap: %w", vdir.ErrInvalidConfig), 404},
		{"vdir not a directory", fmt.Errorf("wrap: %w", vdir.ErrNotADirectory), 404},
		{"lexical outside root", fmt.Errorf("wrap: %w", vdirpath.ErrOutsideRoot), 404},
		{"lexical invalid path", fmt.Errorf("wrap: %w", vdirpath.ErrInvalidPath), 404},
		{"fsapi not a directory", fmt.Errorf("wrap: %w", errNotADirectory), 404},
		{"record missing", fmt.Errorf("wrap: %w", sql.ErrNoRows), 404},
		{"os not exist", fmt.Errorf("wrap: %w", os.ErrNotExist), 404},
		{"sftp no such file", sftp.ErrSSHFxNoSuchFile, 404},
		{"os permission", fmt.Errorf("wrap: %w", os.ErrPermission), 403},
		{"sftp permission denied", sftp.ErrSSHFxPermissionDenied, 403},
		{"conflict is permanent 500", fmt.Errorf("wrap: %w", errConflict), 500},
		{"unresumable resume guard is permanent 500", fmt.Errorf("wrap: %w", ssherr.ErrResumeImpossible), 500},
		{"host key mismatch is permanent 500", ssherr.ErrHostKeyMismatch, 500},
		{"unknown is retryable 503", errors.New("mystery"), 503},
	}
	for _, row := range rows {
		if got := httpStatus(row.err); got != row.want {
			t.Errorf("%s: httpStatus = %d, want %d", row.name, got, row.want)
		}
	}
}

// remoteMv's already-applied semantics, deterministic over the
// fixture client (a disconnect between apply and ack cannot be aimed
// at the microsecond window; the states it must distinguish can).
func TestRemoteMvAlreadyAppliedStates(t *testing.T) {
	f := newFixtureProvider(t)
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatal(err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatal(err)
	}
	defer scl.Close()

	root := f.Path("mvstates")
	if err := scl.MkdirAll(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = f.Exec("rm -rf " + root) })

	write := func(name, content string) {
		t.Helper()
		fp, err := scl.Create(root + "/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fp.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
		if err := fp.Close(); err != nil {
			t.Fatal(err)
		}
	}

	// Applied but unacknowledged: source gone, target present → success.
	write("src", "payload\n")
	if err := remoteMv(scl, root+"/src", root+"/dst"); err != nil {
		t.Fatalf("fresh mv: %v", err)
	}
	if err := remoteMv(scl, root+"/src", root+"/dst"); err != nil {
		t.Fatalf("already-applied mv = %v, want nil", err)
	}

	// Both gone: permanent not-found.
	if err := scl.Remove(root + "/dst"); err != nil {
		t.Fatal(err)
	}
	err = remoteMv(scl, root+"/src", root+"/dst")
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("both-gone mv = %v, want permanent not-exist", err)
	}
}
