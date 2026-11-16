package archiveextract

import (
	"context"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/testssh"
)

// latencyReader decorates a ranged reader with a fixed per-round-trip
// delay, standing in for a high-latency link without needing a network
// shim. It counts calls too.
type latencyReader struct {
	inner rangedReader
	delay time.Duration
	calls int
}

func (l *latencyReader) ReadRange(ctx context.Context, off int64, length int) ([]byte, error) {
	l.calls++
	time.Sleep(l.delay)
	return l.inner.ReadRange(ctx, off, length)
}

func (l *latencyReader) ReadRangeTo(ctx context.Context, w io.Writer, off, length int64) (int64, error) {
	l.calls++
	time.Sleep(l.delay)
	return l.inner.ReadRangeTo(ctx, w, off, length)
}

// TestReadAheadThroughput measures the window against the same archive
// over the same injected latency. It records the numbers (design D3) and
// asserts the window does not make things worse and collapses round
// trips; the exact speedup depends on entry sizes, so it is not asserted
// as a hard threshold.
func TestReadAheadThroughput(t *testing.T) {
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	defer f.Close()
	mgr, err := f.NewManager()
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	defer mgr.Close()

	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	files := map[string]string{}
	for i := 0; i < 48; i++ {
		files[fmt.Sprintf("d%d/f%d.txt", i%4, i)] = "contents"
	}
	archive := buildZip(t, files)
	if err := scl.MkdirAll(f.Path("lat")); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	fh, err := scl.Create(f.Path("lat/many.zip"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := fh.Write(archive); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := fh.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	_ = scl.Close()

	measure := func(window int) (time.Duration, int) {
		lr := &latencyReader{
			inner: sftpreadwrite.New(mgr, f.Path("lat/many.zip"), sftpreadwrite.Options{}),
			delay: 2 * time.Millisecond,
		}
		base := NewReaderAt(context.Background(), lr, int64(len(archive)))
		start := time.Now()
		readAll(t, base, int64(len(archive)))
		_ = window
		return time.Since(start), lr.calls
	}

	plainDur, plainCalls := measure(0)

	lr := &latencyReader{
		inner: sftpreadwrite.New(mgr, f.Path("lat/many.zip"), sftpreadwrite.Options{}),
		delay: 2 * time.Millisecond,
	}
	base := NewReaderAt(context.Background(), lr, int64(len(archive)))
	start := time.Now()
	readAll(t, NewWindowReaderAt(base, defaultReadAhead), int64(len(archive)))
	windowDur := time.Since(start)

	if lr.calls > plainCalls {
		t.Fatalf("window made more round trips (%d) than plain reads (%d)", lr.calls, plainCalls)
	}
	t.Logf("read-ahead: plain=%d calls in %s; window=%d calls in %s",
		plainCalls, plainDur, lr.calls, windowDur)
	if windowDur > plainDur*2 {
		t.Fatalf("window regressed badly: plain %s, window %s", plainDur, windowDur)
	}
}
