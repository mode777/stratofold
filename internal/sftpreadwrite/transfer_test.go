package sftpreadwrite_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
	"github.com/mode777/stratofold/internal/testssh"
)

// writeDirect seeds a file via a plain SFTP client (bypasses the code
// under test).
func writeDirect(t *testing.T, f *testssh.Fixture, rel string, data []byte) {
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

func randomBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

func remoteSHA256(t *testing.T, f *testssh.Fixture, rel string) string {
	t.Helper()
	out, err := f.Exec("sha256sum " + f.Path(rel))
	if err != nil {
		t.Fatalf("sha256sum: %v (%s)", err, out)
	}
	return strings.Fields(out)[0]
}

func localSHA256(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestOffsetReadsByteExact: reads at offsets return exactly the
// requested byte range (spec: sftp-streaming).
func TestOffsetReadsByteExact(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	src := testssh.RandomBytes(3, 256*1024+7)
	writeDirect(t, f, "src.bin", src)
	tr := sftpreadwrite.New(m, f.Path("src.bin"), sftpreadwrite.Options{})

	cases := []struct {
		off int64
		len int
	}{
		{0, 1024},
		{1000, 50000},
		{int64(len(src)) - 8, 8},    // tail
		{int64(len(src)) / 2, 4096}, // middle
		{0, len(src)},               // whole file via range
	}
	for _, c := range cases {
		got, err := tr.ReadRange(context.Background(), c.off, c.len)
		if err != nil {
			t.Fatalf("ReadRange(%d,%d): %v", c.off, c.len, err)
		}
		if !bytes.Equal(got, src[c.off:int64(c.off)+int64(c.len)]) {
			t.Fatalf("ReadRange(%d,%d): byte mismatch", c.off, c.len)
		}
	}

	// Short remote file: reading past EOF fails loudly.
	if _, err := tr.ReadRange(context.Background(), int64(len(src))-4, 100); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("past-EOF err = %v, want ErrUnexpectedEOF", err)
	}
}

// TestOffsetWritePatchesBytes: WriteChunkAt replaces bytes O..O+M-1 and
// leaves the rest untouched (spec: sftp-streaming, write at offset).
func TestOffsetWritePatchesBytes(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	base := testssh.RandomBytes(4, 128*1024)
	writeDirect(t, f, "base.bin", base)
	tr := sftpreadwrite.New(m, f.Path("base.bin"), sftpreadwrite.Options{})

	patch := []byte("PATCHED-PATCHED-PATCHED")
	off := int64(1000)
	if _, err := tr.WriteChunkAt(context.Background(), off, patch); err != nil {
		t.Fatal(err)
	}

	// Verify remotely, byte for byte, via independent reads.
	got, err := tr.ReadRange(context.Background(), 0, len(base))
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte{}, base...)
	copy(want[off:], patch)
	if !bytes.Equal(got, want) {
		t.Fatal("patched file differs from expected result")
	}
}

// TestFullFileIntegrity: checksums match after the read and the write
// path (spec: sftp-streaming).
func TestFullFileIntegrity(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	src := randomBytes(t, 5*1024*1024+13)

	// Write path.
	tr := sftpreadwrite.New(m, f.Path("full.bin"), sftpreadwrite.Options{})
	if n, err := tr.WriteAll(context.Background(), bytes.NewReader(src), int64(len(src))); err != nil || n != int64(len(src)) {
		t.Fatalf("WriteAll: n=%d err=%v", n, err)
	}
	if got := remoteSHA256(t, f, "full.bin"); got != localSHA256(src) {
		t.Fatal("remote file checksum differs after WriteAll")
	}

	// Read path.
	var out bytes.Buffer
	rd := sftpreadwrite.New(m, f.Path("full.bin"), sftpreadwrite.Options{})
	if n, err := rd.ReadAll(context.Background(), &out); err != nil || n != int64(len(src)) {
		t.Fatalf("ReadAll: n=%d err=%v", n, err)
	}
	if localSHA256(out.Bytes()) != localSHA256(src) {
		t.Fatal("read-back checksum differs")
	}
}

// TestPermanentErrorsNotRetried: permission denied and missing files
// fail immediately — exactly one dial, no retries.
func TestPermanentErrorsNotRetried(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	var dials atomic.Int64
	m, err := f.NewManager(sshconn.WithDialHook(func() { dials.Add(1) }))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	ctx := context.Background()

	// Missing file.
	tr := sftpreadwrite.New(m, f.Path("definitely-missing.bin"), sftpreadwrite.Options{})
	if _, err := tr.ReadAll(ctx, io.Discard); err == nil {
		t.Fatal("expected error for missing file")
	} else if ssherr.Classify(errors.Unwrap(err)) == ssherr.Retryable && !strings.Contains(err.Error(), "no such") {
		t.Fatalf("unexpected error class for missing file: %v", err)
	}
	if n := dials.Load(); n != 1 {
		t.Fatalf("missing file: dial count = %d, want 1 (no retry)", n)
	}

	// Permission denied (seeded secret.bin is chmod 000): the healthy
	// connection is reused and the error is never retried.
	tr2 := sftpreadwrite.New(m, f.Path("secret.bin"), sftpreadwrite.Options{})
	if _, err := tr2.ReadAll(ctx, io.Discard); err == nil {
		t.Fatal("expected permission error")
	}
	if n := dials.Load(); n != 1 {
		t.Fatalf("permission denied: dial count = %d, want 1 (reused conn, no retry reconnects)", n)
	}
}

// mutateProvider decorates a ClientProvider and runs a hook before the
// Nth Client call (deterministic remote mutation between attempts).
type mutateProvider struct {
	inner     sshconn.ClientProvider
	beforeNth int
	hook      func()
	seen      atomic.Int64
}

func (p *mutateProvider) Client(ctx context.Context) (*sftp.Client, sshconn.Release, error) {
	n := p.seen.Add(1)
	if n == int64(p.beforeNth) && p.hook != nil {
		p.hook()
	}
	return p.inner.Client(ctx)
}

func (p *mutateProvider) Invalidate(c *sftp.Client) { p.inner.Invalidate(c) }

// TestTransferFailsLoudlyAfterAttempts: a transfer whose every attempt
// dies mid-flight exhausts MaxAttempts and returns an error (never
// silent corruption).
func TestTransferFailsLoudlyAfterAttempts(t *testing.T) {
	f := testssh.Start(t, testssh.Options{})
	defer f.Close()

	// Kill every connection early — the transfer can never finish.
	kill := testssh.NewKillSwitch(64*1024, 64*1024, 64*1024)
	m, err := f.NewManager(sshconn.WithConnWrap(kill.Wrap()))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	tr := sftpreadwrite.New(m, f.Path("stuck.bin"), sftpreadwrite.Options{MaxAttempts: 3})
	src := testssh.RandomBytes(6, 4*1024*1024)
	_, err = tr.WriteAll(context.Background(), bytes.NewReader(src), int64(len(src)))
	if err == nil {
		t.Fatal("expected loud failure")
	}
	if !strings.Contains(err.Error(), "3 attempts") {
		t.Fatalf("err = %v, want attempts-exhausted error", err)
	}
	// The interrupted upload never reported success; the target must
	// not be presented as complete.
	if got := remoteSHA256(t, f, "stuck.bin"); got == localSHA256(src) {
		t.Fatal("target unexpectedly complete while transfer reported failure")
	}
}
