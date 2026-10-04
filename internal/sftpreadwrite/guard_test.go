package sftpreadwrite

import (
	"context"
	"errors"
	"testing"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/ssherr"
	"github.com/mode777/stratofold/internal/testssh"
)

func writeGuardFile(t *testing.T, f *testssh.Fixture, rel string, data []byte) {
	t.Helper()
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatal(err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatal(err)
	}
	defer scl.Close()
	fp, err := scl.Create(f.Path(rel))
	if err != nil {
		t.Fatal(err)
	}
	defer fp.Close()
	if _, err := fp.Write(data); err != nil {
		t.Fatal(err)
	}
}

// TestResumeGuardRejectsShrunkenFile: a remote file that shrank below
// the resume offset fails loudly with ErrResumeImpossible instead of
// silently corrupting the target (spec: sftp-streaming, unresumable
// transfers). Deterministic: drives guard() directly against the
// fixture.
func TestResumeGuardRejectsShrunkenFile(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	ctx := context.Background()
	const resumeOff = int64(128 * 1024)

	// Remote file smaller than the resume offset.
	writeGuardFile(t, f, "guard-small.bin", make([]byte, 100))
	tr := New(m, f.Path("guard-small.bin"), Options{})
	_, err = tr.WriteChunkAt(ctx, resumeOff, []byte("patch"))
	if !errors.Is(err, ssherr.ErrResumeImpossible) {
		t.Fatalf("small file: err = %v, want ErrResumeImpossible", err)
	}

	// Missing remote file.
	tr2 := New(m, f.Path("guard-missing.bin"), Options{})
	_, err = tr2.WriteChunkAt(ctx, resumeOff, []byte("patch"))
	if err == nil {
		t.Fatal("missing file: expected error")
	}

	// Remote file still covering the offset: guard passes.
	writeGuardFile(t, f, "guard-ok.bin", make([]byte, resumeOff+1024))
	tr3 := New(m, f.Path("guard-ok.bin"), Options{})
	if _, err := tr3.WriteChunkAt(ctx, resumeOff, []byte("patch")); err != nil {
		t.Fatalf("covered offset: %v", err)
	}
	// The patch landed at exactly the offset.
	got, err := tr3.ReadRange(ctx, resumeOff, 5)
	if err != nil || string(got) != "patch" {
		t.Fatalf("patch bytes = %q err=%v", got, err)
	}
}
