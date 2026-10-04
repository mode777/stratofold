package fsapi_test

// Concurrency validation (design D7, filesystem-api spec "Concurrent
// operations multiplex safely over the managed connection"): parallel
// operations over one vdir's single SFTP channel complete exactly as
// if executed alone — every published file matches its own body, and
// no partially written file is ever visible at a target path.

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/mode777/stratofold/internal/testssh"
)

func TestParallelUploadsLandIndependently(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	const n = 8
	bodies := make([][]byte, n)
	for i := range bodies {
		bodies[i] = testssh.RandomBytes(int64(20+i), 1<<20)
	}

	// A reader polls one target while its upload is in flight: the
	// only acceptable responses are 404 (not yet published) or the
	// complete body (atomic publication) — never a partial file.
	stopPolling := make(chan struct{})
	pollErr := make(chan string, 1)
	go func() {
		defer close(pollErr)
		url := e.s.BaseURL + "/files/" + e.privID + "/up/concurrent-3.bin"
		for {
			select {
			case <-stopPolling:
				return
			default:
			}
			req, err := http.NewRequest(http.MethodGet, url, nil)
			if err != nil {
				pollErr <- err.Error()
				return
			}
			req.AddCookie(c)
			resp, err := client().Do(req)
			if err != nil {
				continue // transient transport noise during teardown
			}
			b := body(t, resp)
			if resp.StatusCode == http.StatusNotFound {
				continue
			}
			if resp.StatusCode == http.StatusOK && bytes.Equal(b, bodies[3]) {
				continue
			}
			pollErr <- fmt.Sprintf("partial state visible: status=%d len=%d", resp.StatusCode, len(b))
			return
		}
	}()

	var wg sync.WaitGroup
	statuses := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp := uploadBytes(t, e, e.privID, fmt.Sprintf("up/concurrent-%d.bin", i), bodies[i], c)
			statuses[i] = resp.StatusCode
			_ = resp.Body.Close()
		}(i)
	}
	wg.Wait()
	close(stopPolling)
	if msg := <-pollErr; msg != "" {
		t.Fatal(msg)
	}
	for i, st := range statuses {
		if st != http.StatusOK {
			t.Fatalf("upload %d: status = %d, want 200", i, st)
		}
	}
	for i := 0; i < n; i++ {
		got := remoteRead(t, e, fmt.Sprintf("sandbox/up/concurrent-%d.bin", i))
		if !bytes.Equal(got, bodies[i]) {
			t.Fatalf("upload %d corrupted across parallel traffic: %s vs %s",
				i, sha(got), sha(bodies[i]))
		}
	}
}

func TestMixedParallelOperations(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	payloads := make([][]byte, 4)
	for i := range payloads {
		payloads[i] = testssh.RandomBytes(int64(30+i), 256<<10)
	}

	// The shared parent exists before the parallel phase; the
	// parallel operations themselves run with no setup steps.
	mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "mix"}, c), http.StatusNoContent)

	var wg sync.WaitGroup
	fail := make(chan string, 32)
	expectStatus := func(name string, want int, fn func() *http.Response) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := fn()
			defer resp.Body.Close()
			if resp.StatusCode != want {
				fail <- fmt.Sprintf("%s: status = %d, want %d", name, resp.StatusCode, want)
			}
		}()
	}

	// Parallel uploads to distinct targets.
	for i := range payloads {
		i := i
		expectStatus(fmt.Sprintf("upload f%d", i), http.StatusOK, func() *http.Response {
			return uploadBytes(t, e, e.privID, fmt.Sprintf("mix/f%d.bin", i), payloads[i], c)
		})
	}
	// Parallel mutations on disjoint subtrees.
	for i := 0; i < 3; i++ {
		i := i
		expectStatus(fmt.Sprintf("mkdir d%d", i), http.StatusNoContent, func() *http.Response {
			return opJSON(t, e, e.privID, "mkdir", map[string]string{"path": fmt.Sprintf("mix/d%d/x/y", i)}, c)
		})
	}
	// Parallel listings.
	for i := 0; i < 4; i++ {
		expectStatus("ls", http.StatusOK, func() *http.Response {
			return opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, c)
		})
	}
	wg.Wait()
	close(fail)
	for msg := range fail {
		t.Error(msg)
	}

	// Every upload landed byte-exact despite the concurrent mutations.
	for i := range payloads {
		got := remoteRead(t, e, fmt.Sprintf("sandbox/mix/f%d.bin", i))
		if !bytes.Equal(got, payloads[i]) {
			t.Fatalf("mix/f%d.bin corrupted: %s vs %s", i, sha(got), sha(payloads[i]))
		}
	}
	// All three subtrees exist in full.
	for i := 0; i < 3; i++ {
		if fi, err := remoteLstat(t, e, fmt.Sprintf("sandbox/mix/d%d/x/y", i)); err != nil || !fi.IsDir() {
			t.Fatalf("mix/d%d/x/y missing after parallel mkdir: err=%v", i, err)
		}
	}

	// Moves over the settled tree, in parallel, then cleanup.
	var mvWg sync.WaitGroup
	for i := 0; i < 3; i++ {
		mvWg.Add(1)
		go func(i int) {
			defer mvWg.Done()
			resp := opJSON(t, e, e.privID, "mv",
				map[string]string{"path": fmt.Sprintf("mix/d%d", i), "to": fmt.Sprintf("mix/m%d", i)}, c)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusNoContent {
				t.Errorf("parallel mv d%d: status = %d", i, resp.StatusCode)
			}
		}(i)
	}
	mvWg.Wait()
	for i := 0; i < 3; i++ {
		if _, err := remoteLstat(t, e, fmt.Sprintf("sandbox/mix/m%d/x", i)); err != nil {
			t.Fatalf("mix/m%d/x missing after parallel mv: %v", i, err)
		}
		if _, err := remoteLstat(t, e, fmt.Sprintf("sandbox/mix/d%d", i)); err == nil {
			t.Fatalf("mix/d%d still present after mv", i)
		}
	}

	mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "mix"}, c), http.StatusNoContent)
	if names := remoteNames(t, e, "sandbox"); strings.Contains(strings.Join(names, ","), "mix") {
		t.Fatalf("mix survived rm: %v", names)
	}
}

func client() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}
