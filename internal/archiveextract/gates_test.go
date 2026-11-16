package archiveextract

// The risk gate (roadmap R5 applied to extraction): inflating a
// multi-gigabyte archive keeps host memory flat. Long-running: enable with
// SF_RUN_GATES=1.

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func gatesEnabled() bool { return os.Getenv("SF_RUN_GATES") == "1" }

// repeatReader yields block until total bytes have been produced, so a
// member can inflate to gigabytes without the compressed archive (or the
// test) ever holding them.
type repeatReader struct {
	block []byte
	left  int64
}

func (r *repeatReader) Read(p []byte) (int, error) {
	if r.left <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > r.left {
		p = p[:r.left]
	}
	n := 0
	for n < len(p) {
		c := copy(p[n:], r.block)
		n += c
	}
	r.left -= int64(n)
	return n, nil
}

// vmHWMBytes is the process's peak resident set size (Linux).
func vmHWMBytes(t *testing.T) int64 {
	t.Helper()
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		t.Skip("no /proc/self/status")
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmHWM:") {
			fields := strings.Fields(line)
			kb, _ := strconv.ParseInt(fields[1], 10, 64)
			return kb << 10
		}
	}
	t.Skip("VmHWM not found")
	return 0
}

// TestExtractMemoryGate inflates a 1 GiB member out of a ~1 MiB archive
// and requires the process's peak resident set to stay within a fixed
// budget: nothing about the extraction may scale with the uncompressed
// size.
func TestExtractMemoryGate(t *testing.T) {
	if !gatesEnabled() {
		t.Skip("set SF_RUN_GATES=1 to run the gates")
	}
	e, done := startEnv(t)
	defer done()

	const inflated = int64(2 << 30) // 2 GiB of zeros
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	fw, err := w.CreateHeader(&zip.FileHeader{Name: "zeros.bin", Method: zip.Deflate})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := io.Copy(fw, &repeatReader{block: make([]byte, 64<<10), left: inflated}); err != nil {
		t.Fatalf("write member: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	archive := buf.Bytes()
	if int64(len(archive)) > 8<<20 {
		t.Fatalf("gate archive is %d bytes; it should compress well", len(archive))
	}
	e.put(t, "zeros.zip", archive)

	budget := int64(128 << 20)
	hwmBefore := vmHWMBytes(t)
	stop := make(chan struct{})
	var heapPeak int64
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(100 * time.Millisecond):
			}
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			if int64(ms.HeapAlloc) > heapPeak {
				heapPeak = int64(ms.HeapAlloc)
			}
		}
	}()

	snap := runRequest(t, e, "zeros.zip", "zeros", func(r *Request) { r.MaxBytes = 2 * inflated })
	close(stop)
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s (%+v)", snap.State, snap.Error)
	}

	cl, release, err := e.mgr.Client(t.Context())
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	fi, err := cl.Stat(e.dir + "/zeros/zeros.bin")
	release()
	if err != nil {
		t.Fatalf("stat member: %v", err)
	}
	if fi.Size() != inflated {
		t.Fatalf("published member = %d bytes, want %d", fi.Size(), inflated)
	}

	hwmAfter := vmHWMBytes(t)
	t.Logf("gate memory: archive=%d bytes, inflated=%d bytes, heap peak=%d MiB, VmHWM delta=%d MiB (budget %d MiB)",
		len(archive), inflated, heapPeak>>20, (hwmAfter-hwmBefore)>>20, budget>>20)
	if d := hwmAfter - hwmBefore; d > budget {
		t.Fatalf("peak RSS grew %d MiB, budget %d MiB — the archive is being buffered", d>>20, budget>>20)
	}
}
