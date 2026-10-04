package fsapi_test

// The risk gates (filesystem-api spec): multi-gigabyte uploads keep
// host memory flat (roadmap R5) and sustained parallel traffic does
// not corrupt anything. Long-running: enable with SF_RUN_GATES=1;
// against a real OpenSSH use SF_TESTSSH_MODE=external.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mode777/stratofold/internal/testssh"
)

func gatesEnabled() bool { return os.Getenv("SF_RUN_GATES") == "1" }

// zeroReader produces zeros without holding them (the uploaded body
// must never exist in host memory as a whole).
type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

// repeatReader yields block repeatedly until total bytes have been
// produced — a deterministic multi-hundred-MB body costing one block
// of host memory.
type repeatReader struct {
	block     []byte
	offset    int
	remaining int64
}

func (r *repeatReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := int64(len(p))
	if n > r.remaining {
		n = r.remaining
	}
	written := 0
	for written < int(n) {
		copied := copy(p[written:], r.block[r.offset:])
		r.offset = (r.offset + copied) % len(r.block)
		written += copied
	}
	r.remaining -= n
	return int(n), nil
}

// uploadReader posts a streaming body of the given declared size.
func uploadReader(t *testing.T, e *env, vdirID, vpath string, r io.Reader, size int64, cookie *http.Cookie) *http.Response {
	t.Helper()
	u := e.s.BaseURL + "/api/sf/vdirs/" + vdirID + "/upload?path=" + vpath
	req, err := http.NewRequest(http.MethodPost, u, r)
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	req.ContentLength = size
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload %s: %v", vpath, err)
	}
	return resp
}

func uploadSize(t *testing.T, resp *http.Response) int64 {
	t.Helper()
	var out struct {
		Size int64 `json:"size"`
	}
	if err := jsonUnmarshal(body(t, resp), &out); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	return out.Size
}

// remoteSHA256 hashes a remote file with the fixture's whitelisted
// sha256sum (out-of-process, independent of the code under test).
func remoteSHA256(t *testing.T, e *env, rel string) string {
	t.Helper()
	out, err := e.f.Exec("sha256sum " + e.f.Path(rel))
	if err != nil {
		t.Fatalf("sha256sum %s: %v (%s)", rel, err, out)
	}
	fields := strings.Fields(out)
	if len(fields) == 0 {
		t.Fatalf("sha256sum %s: unparsable output %q", rel, out)
	}
	return fields[0]
}

// vmHWM returns the process's peak resident set size (Linux).
func vmHWM(t *testing.T) int64 {
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

// TestUploadMemoryGate (roadmap R5): a multi-gigabyte upload streams
// end to end while the process's peak memory stays flat — the body is
// never buffered on the Stratofold host — and the published sparse
// file is zeros at both ends.
func TestUploadMemoryGate(t *testing.T) {
	if !gatesEnabled() {
		t.Skip("set SF_RUN_GATES=1 to run the gates")
	}
	e := setup(t)
	c := ownerC(t, e)
	mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "gates"}, c), http.StatusNoContent)

	const budget = int64(64 << 20) // 64 MiB headroom over process start
	hwmBefore := vmHWM(t)
	stop := make(chan struct{})
	var peak int64
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(100 * time.Millisecond):
			}
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			if int64(ms.HeapAlloc) > peak {
				peak = int64(ms.HeapAlloc)
			}
		}
	}()

	resp := uploadReader(t, e, e.privID, "gates/sparse-up.bin",
		io.LimitReader(zeroReader{}, testssh.SparseSize), testssh.SparseSize, c)
	if resp.StatusCode != http.StatusOK {
		b := body(t, resp)
		t.Fatalf("gate upload: status = %d (body %.160q)", resp.StatusCode, b)
	}
	if got := uploadSize(t, resp); got != testssh.SparseSize {
		t.Fatalf("published size = %d, want %d", got, testssh.SparseSize)
	}

	// Spot-check both ends of the sparse file through the read path.
	for _, row := range []struct {
		name string
		rng  string
	}{
		{"head", "bytes=0-" + strconv.FormatInt(1<<20-1, 10)},
		{"tail", "bytes=" + strconv.FormatInt(testssh.SparseSize-1<<20, 10) + "-"},
	} {
		req, err := http.NewRequest(http.MethodGet,
			e.s.BaseURL+"/files/"+e.privID+"/gates/sparse-up.bin", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(c)
		req.Header.Set("Range", row.rng)
		rr, err := client().Do(req)
		if err != nil {
			t.Fatalf("%s read: %v", row.name, err)
		}
		b := body(t, rr)
		if rr.StatusCode != http.StatusPartialContent || len(b) != 1<<20 || !bytes.Equal(b, make([]byte, len(b))) {
			t.Fatalf("%s of the published sparse file is not zeros: status=%d len=%d", row.name, rr.StatusCode, len(b))
		}
	}
	close(stop)

	hwmAfter := vmHWM(t)
	t.Logf("gate memory: heap peak=%d MiB, VmHWM delta=%d MiB (budget %d MiB)",
		peak>>20, (hwmAfter-hwmBefore)>>20, budget>>20)
	if d := hwmAfter - hwmBefore; d > budget {
		t.Fatalf("peak RSS grew %d MiB, budget %d MiB — body buffering suspected", d>>20, budget>>20)
	}
}

// TestSustainedConcurrencyGate (design D7): sustained parallel
// traffic — several large uploads plus mixed operations — over one
// vdir's single SFTP channel completes without interleaving corruption
// and with flat memory. Content is verified by remote sha256sum.
func TestSustainedConcurrencyGate(t *testing.T) {
	if !gatesEnabled() {
		t.Skip("set SF_RUN_GATES=1 to run the gates")
	}
	e := setup(t)
	c := ownerC(t, e)

	const uploads = 4
	const size = int64(256 << 20)
	mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "sustained"}, c), http.StatusNoContent)

	hwmBefore := vmHWM(t)
	var wg sync.WaitGroup
	errs := make(chan string, uploads+8)
	blocks := make([][]byte, uploads)
	for i := 0; i < uploads; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			block := testssh.RandomBytes(int64(40+i), 1<<20)
			blocks[i] = block
			resp := uploadReader(t, e, e.privID, fmt.Sprintf("sustained/f%d.bin", i),
				&repeatReader{block: block, remaining: size}, size, c)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				errs <- fmt.Sprintf("sustained upload %d: status = %d", i, resp.StatusCode)
			}
		}(i)
	}
	// Mixed operations while the uploads run.
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			dir := fmt.Sprintf("sustained/d%d", i%3)
			resp := opJSON(t, e, e.privID, "mkdir", map[string]string{"path": dir + "/a/b"}, c)
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusNoContent {
				errs <- fmt.Sprintf("sustained mkdir %d: status = %d", i, resp.StatusCode)
			}
			resp = opJSON(t, e, e.privID, "ls", map[string]string{"path": "sustained"}, c)
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				errs <- fmt.Sprintf("sustained ls %d: status = %d", i, resp.StatusCode)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for msg := range errs {
		t.Error(msg)
	}

	// Each published file is exactly its own deterministic byte
	// pattern — no interleaving corruption.
	for i := 0; i < uploads; i++ {
		h := sha256.New()
		written := int64(0)
		for written < size {
			n := int64(len(blocks[i]))
			if remain := size - written; remain < n {
				n = remain
			}
			h.Write(blocks[i][:n])
			written += n
		}
		want := hex.EncodeToString(h.Sum(nil))
		if got := remoteSHA256(t, e, "sandbox/sustained/f"+strconv.Itoa(i)+".bin"); got != want {
			t.Fatalf("sustained upload %d corrupted: sha %s, want %s", i, got, want)
		}
	}
	hwmAfter := vmHWM(t)
	t.Logf("sustained memory: VmHWM delta=%d MiB across %d parallel %dMiB uploads",
		(hwmAfter-hwmBefore)>>20, uploads, size>>20)
	if d := hwmAfter - hwmBefore; d > 256<<20 {
		t.Fatalf("peak RSS grew %d MiB across %d parallel uploads — buffering suspected", d>>20, uploads)
	}

	mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "sustained"}, c), http.StatusNoContent)
}
