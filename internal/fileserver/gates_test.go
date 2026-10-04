package fileserver_test

import (
	"crypto/sha256"
	"hash"
	"io"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/appserver"
	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
)

// The streaming gates (file-server spec, "Responses stream without
// host buffering and survive disconnects"). The memory gate is
// long-running: enable with SF_RUN_GATES=1; against a real OpenSSH use
// SF_TESTSSH_MODE=external. The write-timeout proof is cheap and runs
// in the normal suite.

func gatesEnabled() bool { return os.Getenv("SF_RUN_GATES") == "1" }

// gateSink streams into a checksum and counts nonzero bytes: checksum
// equality for the known all-zero sparse source is "SparseSize zero
// bytes".
type gateSink struct {
	h       hash.Hash
	nonzero int64
	n       int64
}

func (g *gateSink) Write(p []byte) (int, error) {
	g.h.Write(p)
	for _, b := range p {
		if b != 0 {
			g.nonzero++
		}
	}
	g.n += int64(len(p))
	return len(p), nil
}

// TestFileServerMemoryGate: a multi-GB download through /files/*
// delivers every byte (all-zero sparse source) while the process's
// peak memory stays flat — no host-side buffering.
func TestFileServerMemoryGate(t *testing.T) {
	if !gatesEnabled() {
		t.Skip("set SF_RUN_GATES=1 to run the gates")
	}
	e := setup(t)
	c := ownerCookie(t, e)

	// A vdir rooted at the whole fixture dataset exposes sparse4g.bin.
	vdirID := gateVdir(t, e, "all", e.f.Root)
	url := e.s.BaseURL + "/files/" + vdirID + "/sparse4g.bin"

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

	resp := get(t, e, url, c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if resp.ContentLength != testssh.SparseSize {
		t.Fatalf("Content-Length = %d, want %d", resp.ContentLength, testssh.SparseSize)
	}

	sink := &gateSink{h: sha256.New()}
	if _, err := io.Copy(sink, resp.Body); err != nil {
		t.Fatalf("stream: %v", err)
	}
	_ = resp.Body.Close()
	close(stop)

	if sink.n != testssh.SparseSize || sink.nonzero != 0 {
		t.Fatalf("delivered %d bytes (%d nonzero), want %d zero bytes",
			sink.n, sink.nonzero, testssh.SparseSize)
	}

	hwmAfter := vmHWM(t)
	t.Logf("memory: heap peak=%d MiB, VmHWM delta=%d MiB (budget %d MiB), sha=%s",
		peak>>20, (hwmAfter-hwmBefore)>>20, budget>>20, sink.h.Sum(nil)[:4])
	if d := hwmAfter - hwmBefore; d > budget {
		t.Fatalf("peak RSS grew %d MiB, budget %d MiB — whole-file buffering suspected", d>>20, budget>>20)
	}
}

// TestFileServerResponseOutlivesWriteTimeout proves the /files/*
// routes really run with cleared deadlines: the server is configured
// with a 300ms write deadline (absolute, from request start) that
// would kill any response lasting longer; the streamed slice far
// outlasts it and still completes. The session cookie is minted
// directly so the (deliberately slow, bcrypt-hashing) login route
// never runs against the short deadline.
func TestFileServerResponseOutlivesWriteTimeout(t *testing.T) {
	e := setupWithOptions(t, testapp.WithOptions(func(o *appserver.Options) {
		o.Timeouts = &appserver.TimeoutConfig{
			Write:      300 * time.Millisecond,
			ReadHeader: time.Minute,
			Idle:       2 * time.Minute,
		}
	}))

	user, err := e.s.App.FindAuthRecordByEmail("users", testapp.TestUserEmail)
	if err != nil {
		t.Fatal(err)
	}
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	c := &http.Cookie{Name: "sf_session", Value: token}

	vdirID := gateVdir(t, e, "all", e.f.Root)
	// 256 MiB of the sparse file: ~3s at in-proc throughput, 10x the
	// 300ms deadline.
	const size = int64(256 << 20)
	req, err := http.NewRequest(http.MethodGet,
		e.s.BaseURL+"/files/"+vdirID+"/sparse4g.bin", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(c)
	req.Header.Set("Range", "bytes=0-"+strconv.FormatInt(size-1, 10))
	resp, err := client().Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	sink := &gateSink{h: sha256.New()}
	if _, err := io.Copy(sink, resp.Body); err != nil {
		t.Fatalf("stream died (write deadline not cleared?): %v", err)
	}
	_ = resp.Body.Close()
	if sink.n != size || sink.nonzero != 0 {
		t.Fatalf("served %d bytes (%d nonzero), want %d zero bytes", sink.n, sink.nonzero, size)
	}
}

// gateVdir records an extra vdir on the env's app (gates reach the
// shared fixture dataset outside the sandbox root).
func gateVdir(t *testing.T, e *env, name, root string) string {
	t.Helper()
	_, owner := e.s.LoginBody(t)
	col, err := e.s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatal(err)
	}
	vd, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("owner", owner["id"])
	rec.Set("connection", vd.GetString("connection"))
	rec.Set("name", name)
	rec.Set("root_path", root)
	if err := e.s.App.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec.Id
}

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
