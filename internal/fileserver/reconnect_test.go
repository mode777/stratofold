package fileserver_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/pkg/sftp"

	"github.com/mode777/stratofold/internal/testssh"
)

// The R1 story at the HTTP layer (file-server spec, "Responses stream
// without host buffering and survive disconnects"):
//
//   - a server-side connection drop during an in-flight response is
//     recovered inside the same response (resume at the served
//     offset), and the completed body is byte-exact;
//   - a response aborted by the client (gone mid-transfer) does not
//     corrupt anything, and the client's Range retry from the last
//     offset it received returns exactly the remaining bytes.

const reconnectBlob = "big/reconnect.bin"

func seedReconnectBlob(t *testing.T, e *env) []byte {
	t.Helper()
	src := testssh.RandomBytes(99, 32<<20)
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()
	writeRemoteBytes(t, scl, e.f.Path("sandbox/"+reconnectBlob), src)
	return src
}

// TestMidTransferDropCompletesByteExact streams a 32 MiB range while
// the fixture drops the server-side SSH connections a bounded number
// of times mid-transfer (the change-1 chaos pattern); the in-flight
// response resumes after backoff and completes with the exact bytes.
func TestMidTransferDropCompletesByteExact(t *testing.T) {
	e := setup(t)
	src := seedReconnectBlob(t, e)
	c := ownerCookie(t, e)
	url := e.s.BaseURL + "/files/" + e.privID + "/" + reconnectBlob

	type result struct {
		resp *http.Response
		body []byte
		err  error
	}
	resCh := make(chan result, 1)
	go func() {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			resCh <- result{err: err}
			return
		}
		req.AddCookie(c)
		req.Header.Set("Range", "bytes=0-")
		resp, err := client().Do(req)
		if err != nil {
			resCh <- result{err: err}
			return
		}
		b, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		resCh <- result{resp: resp, body: b, err: err}
	}()

	// Three mid-transfer drops, spaced so at least one lands while
	// the response is streaming; the manager then recovers at its own
	// backoff pace.
	drops := 0
	for i := 0; i < 3; i++ {
		time.Sleep(150 * time.Millisecond)
		e.f.DropAllConnections()
		drops++
	}

	select {
	case r := <-resCh:
		if r.err != nil {
			t.Fatalf("streaming GET: %v", r.err)
		}
		mustStatus(t, r.resp, http.StatusPartialContent)
		if got, want := r.resp.Header.Get("Content-Range"), "bytes 0-"+strconv.FormatInt(int64(len(src)-1), 10)+"/"+strconv.FormatInt(int64(len(src)), 10); got != want {
			t.Fatalf("Content-Range = %q, want %q", got, want)
		}
		if !bytes.Equal(r.body, src) {
			t.Fatalf("body corrupted across %d drops", drops)
		}
	case <-time.After(30 * time.Second):
		t.Fatalf("response did not complete")
	}
}

// TestRangeRetryAfterAbortedResponse starts a response, reads exactly
// N bytes client-side, then abandons it (context cancel — the client
// "went away"); a Range retry from N returns exactly the remaining
// bytes.
func TestRangeRetryAfterAbortedResponse(t *testing.T) {
	e := setup(t)
	src := seedReconnectBlob(t, e)
	c := ownerCookie(t, e)
	url := e.s.BaseURL + "/files/" + e.privID + "/" + reconnectBlob

	const n = 1000
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.AddCookie(c)
	req.Header.Set("Range", "bytes=0-")
	resp, err := client().Do(req)
	if err != nil {
		t.Fatalf("aborted response: %v", err)
	}
	head := make([]byte, n)
	if _, err := io.ReadFull(resp.Body, head); err != nil {
		t.Fatalf("read head: %v", err)
	}
	cancel()
	_ = resp.Body.Close()
	if !bytes.Equal(head, src[:n]) {
		t.Fatalf("head bytes mismatch")
	}

	// The client retries from the last offset it received.
	retry := get(t, e, url, c, map[string]string{"Range": "bytes=" + strconv.FormatInt(n, 10) + "-"})
	mustStatus(t, retry, http.StatusPartialContent)
	if got, want := retry.Header.Get("Content-Range"), "bytes "+strconv.FormatInt(n, 10)+"-"+strconv.FormatInt(int64(len(src)-1), 10)+"/"+strconv.FormatInt(int64(len(src)), 10); got != want {
		t.Fatalf("retry Content-Range = %q, want %q", got, want)
	}
	rest := body(t, retry)
	if !bytes.Equal(rest, src[n:]) {
		got := sha256.Sum256(rest)
		want := sha256.Sum256(src[n:])
		t.Fatalf("retry body mismatch: got sha %s, want %s",
			hex.EncodeToString(got[:]), hex.EncodeToString(want[:]))
	}
}
