package sftpreadwrite_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/testssh"
)

// ReadRangeTo is the streaming ranged read behind HTTP Range responses
// (file-server design D3): byte-exact slices at nonzero offsets,
// resume-at-served-offset across injected drops, loud failure on short
// remote ranges.

func TestReadRangeToByteExactAtOffsets(t *testing.T) {
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	src := testssh.RandomBytes(42, 1<<20) // the seeded rand1m blob
	rel := "nested/deep/rand1m.bin"
	tr := sftpreadwrite.New(m, f.Path(rel), sftpreadwrite.Options{})

	for _, tc := range []struct {
		name        string
		off, length int64
	}{
		{"head", 0, 4096},
		{"middle", 512 << 10, 1 << 10},
		{"tail", 1<<20 - 10, 10},
		{"crossing-chunks", 32<<10 - 5, 64<<10 + 11},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got bytes.Buffer
			n, err := tr.ReadRangeTo(context.Background(), &got, tc.off, tc.length)
			if err != nil {
				t.Fatalf("ReadRangeTo: %v", err)
			}
			if n != tc.length {
				t.Fatalf("n = %d, want %d", n, tc.length)
			}
			wantEnd := int(tc.off + tc.length)
			if wantEnd > len(src) {
				t.Fatalf("test bug: range [%d,%d) exceeds source", tc.off, wantEnd)
			}
			if !bytes.Equal(got.Bytes(), src[tc.off:wantEnd]) {
				t.Fatalf("slice mismatch for offset %d length %d", tc.off, tc.length)
			}
		})
	}
}

func TestReadRangeToZeroLength(t *testing.T) {
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	tr := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	var got bytes.Buffer
	if n, err := tr.ReadRangeTo(context.Background(), &got, 0, 0); err != nil || n != 0 {
		t.Fatalf("zero-length range: n=%d err=%v", n, err)
	}
	if got.Len() != 0 {
		t.Fatalf("wrote %d bytes for a zero-length range", got.Len())
	}
}

func TestReadRangeToResumesAcrossKills(t *testing.T) {
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	defer f.Close()

	src := testssh.RandomBytes(42, 1<<20)
	const off, length = 100 << 10, 512 << 10
	want := src[off : off+length]

	// Kills land inside the ranged window (and beyond it — the switch
	// arms one threshold per connection, extras are no-ops).
	ks := testssh.NewKillSwitch(64<<10, 700<<10, 1<<20, 2<<20)
	m, err := f.NewManager(sshconn.WithConnWrap(ks.Wrap()))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	tr := sftpreadwrite.New(m, f.Path("nested/deep/rand1m.bin"), sftpreadwrite.Options{})
	var got bytes.Buffer
	n, err := tr.ReadRangeTo(context.Background(), &got, off, length)
	if err != nil {
		t.Fatalf("ReadRangeTo with kills: %v", err)
	}
	if n != length {
		t.Fatalf("n = %d, want %d", n, length)
	}
	if !bytes.Equal(got.Bytes(), want) {
		t.Fatalf("ranged stream corrupted across kills")
	}
}

func TestReadRangeToShortRangeFailsLoudly(t *testing.T) {
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	defer f.Close()

	m, err := f.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()

	tr := sftpreadwrite.New(m, f.Path("hello.txt"), sftpreadwrite.Options{})
	var got bytes.Buffer
	if _, err := tr.ReadRangeTo(context.Background(), &got, 0, 1<<20); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("short range error = %v, want io.ErrUnexpectedEOF", err)
	}
}
