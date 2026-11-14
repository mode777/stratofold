package fsapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type statEntry struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Size    int64  `json:"size"`
	ModTime string `json:"mtime"`
	Version string `json:"version"`
}

func statFile(t *testing.T, e *env, vdirID, path string, cookie *http.Cookie) statEntry {
	t.Helper()
	resp := opJSON(t, e, vdirID, "stat", map[string]string{"path": path}, cookie)
	mustStatus(t, resp, http.StatusOK)
	var out statEntry
	if err := json.NewDecoder(bytes.NewReader(body(t, resp))).Decode(&out); err != nil {
		t.Fatalf("decode stat body: %v", err)
	}
	return out
}

func uploadBytesWithIfMatch(t *testing.T, e *env, vdirID, vpath string, content []byte,
	cookie *http.Cookie, ifMatch string) *http.Response {
	t.Helper()
	u := fmt.Sprintf("%s/api/sf/vdirs/%s/upload?%s", e.s.BaseURL, vdirID,
		url.Values{"path": {vpath}}.Encode())
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(content))
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	req.ContentLength = int64(len(content))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	return e.s.Do(t, req)
}

func TestStatFileDirectoryRoot(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	root := statFile(t, e, e.privID, "", c)
	if root.Path != "" || root.Kind != "directory" || root.Size != 0 || root.Name != "sandbox" || root.Version == "" {
		t.Fatalf("root stat = %+v", root)
	}
	if _, err := time.Parse(time.RFC3339, root.ModTime); err != nil {
		t.Fatalf("root mtime %q: %v", root.ModTime, err)
	}

	hello := statFile(t, e, e.privID, "hello.txt", c)
	if hello.Name != "hello.txt" || hello.Kind != "file" || hello.Size != int64(len("hello stratofold\n")) || hello.Path != "hello.txt" {
		t.Fatalf("hello.txt stat = %+v", hello)
	}
	if hello.Version == "" || hello.Version == root.Version {
		t.Fatalf("hello.txt version = %q, root = %q", hello.Version, root.Version)
	}

	docs := statFile(t, e, e.privID, "docs", c)
	if docs.Kind != "directory" || docs.Size != 0 || docs.Name != "docs" {
		t.Fatalf("docs stat = %+v", docs)
	}
	nested := statFile(t, e, e.privID, "docs/a.txt", c)
	if nested.Name != "a.txt" || nested.Kind != "file" || nested.Size != int64(len(docsATxt)) {
		t.Fatalf("docs/a.txt stat = %+v", nested)
	}

	for _, path := range []string{"nope", "../outside/secret.txt", "/etc/passwd", "docs/link-out"} {
		resp := opJSON(t, e, e.privID, "stat", map[string]string{"path": path}, c)
		mustStatus(t, resp, http.StatusNotFound)
	}
}

func TestVersionStoreFailureOnLsAndStatIs500(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	if _, err := e.s.App.DB().NewQuery("DROP TABLE file_versions").Execute(); err != nil {
		t.Fatalf("drop version store: %v", err)
	}
	for _, op := range []struct {
		name string
		body map[string]string
	}{
		{"ls", map[string]string{"path": ""}},
		{"stat", map[string]string{"path": "hello.txt"}},
	} {
		resp := opJSON(t, e, e.privID, op.name, op.body, c)
		if resp.StatusCode != http.StatusInternalServerError {
			b := body(t, resp)
			t.Fatalf("%s with a missing version store: status = %d, want 500 (body %.160q)",
				op.name, resp.StatusCode, b)
		}
	}
}

func TestStatAuthMatrixAndNoDial(t *testing.T) {
	e := setup(t)
	baseline := e.f.TotalConns()

	mustStatus(t, opJSON(t, e, e.privID, "stat", map[string]string{"path": "hello.txt"}, nil), http.StatusUnauthorized)
	mustStatus(t, opJSON(t, e, e.privID, "stat", map[string]string{"path": "hello.txt"}, otherC(t, e)), http.StatusForbidden)
	if got := e.f.TotalConns(); got != baseline {
		t.Fatalf("rejected stat dialed: conns %d -> %d", baseline, got)
	}

	// A public vdir remains anonymously stat-able.
	resp := opJSON(t, e, e.pubID, "stat", map[string]string{"path": "hello.txt"}, nil)
	mustStatus(t, resp, http.StatusOK)
}

func TestStatAndLsShareVersionWithETag(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)
	stat := statFile(t, e, e.privID, "hello.txt", c)

	resp := opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, c)
	mustStatus(t, resp, http.StatusOK)
	var listed *lsEntry
	for _, en := range lsEntries(t, resp) {
		if en.Name == "hello.txt" {
			en := en
			listed = &en
		}
	}
	if listed == nil {
		t.Fatal("root listing missing hello.txt")
	}
	if listed.Version == "" || listed.Version != stat.Version {
		t.Fatalf("ls version = %q, stat version = %q", listed.Version, stat.Version)
	}

	req, err := http.NewRequest(http.MethodGet, e.s.BaseURL+"/files/"+e.privID+"/hello.txt", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(c)
	fileResp := e.s.Do(t, req)
	defer fileResp.Body.Close()
	if fileResp.StatusCode != http.StatusOK {
		t.Fatalf("file GET status = %d", fileResp.StatusCode)
	}
	if got, want := fileResp.Header.Get("ETag"), `"`+stat.Version+`"`; got != want {
		t.Fatalf("ETag = %q, want %q", got, want)
	}
}

func TestVersionStableAndUploadChanges(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	first := statFile(t, e, e.privID, "hello.txt", c)
	second := statFile(t, e, e.privID, "hello.txt", c)
	if first.Version != second.Version {
		t.Fatalf("unchanged version moved: %q -> %q", first.Version, second.Version)
	}

	body := testsshBytes(32, 64)
	resp := uploadBytes(t, e, e.privID, "up/version.bin", body, c)
	mustStatus(t, resp, http.StatusOK)
	v1 := statFile(t, e, e.privID, "up/version.bin", c).Version

	// Same byte length, immediately again: the publication generation
	// must rotate the version even if size and whole-second mtime do not.
	sameLength := testsshBytes(33, 64)
	resp = uploadBytes(t, e, e.privID, "up/version.bin", sameLength, c)
	mustStatus(t, resp, http.StatusOK)
	v2 := statFile(t, e, e.privID, "up/version.bin", c).Version
	if v2 == v1 {
		t.Fatalf("same-size same-second upload kept version %q", v1)
	}

	// An external edit with a changed signature rotates it too.
	scl := fixtureSFTP(t, e)
	defer scl.Close()
	writeRemoteBytes(t, scl, e.f.Path("sandbox/up/version.bin"), []byte("external content with a different length"))
	v3 := statFile(t, e, e.privID, "up/version.bin", c).Version
	if v3 == v2 {
		t.Fatalf("external edit kept version %q", v2)
	}
}

func TestConditionalUploadMatchingAndStale(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	mustStatus(t, uploadBytes(t, e, e.privID, "up/cond.txt", []byte("one"), c), http.StatusOK)
	v1 := statFile(t, e, e.privID, "up/cond.txt", c).Version

	resp := uploadBytesWithIfMatch(t, e, e.privID, "up/cond.txt", []byte("two"), c, `"`+v1+`"`)
	mustStatus(t, resp, http.StatusOK)
	v2 := statFile(t, e, e.privID, "up/cond.txt", c).Version
	if v2 == v1 {
		t.Fatalf("matching upload kept version %q", v1)
	}

	// Stale: the newer content and version survive; no temp remains.
	resp = uploadBytesWithIfMatch(t, e, e.privID, "up/cond.txt", []byte("three"), c, `"`+v1+`"`)
	if resp.StatusCode != http.StatusPreconditionFailed {
		b := body(t, resp)
		t.Fatalf("stale upload status = %d, want 412 (body %.160q)", resp.StatusCode, b)
	}
	var conflict struct {
		Message string `json:"message"`
		Version string `json:"version"`
	}
	if err := json.NewDecoder(bytes.NewReader(body(t, resp))).Decode(&conflict); err != nil {
		t.Fatalf("decode 412 body: %v", err)
	}
	if conflict.Version != v2 {
		t.Fatalf("412 version = %q, want current %q", conflict.Version, v2)
	}
	if got := string(remoteRead(t, e, "sandbox/up/cond.txt")); got != "two" {
		t.Fatalf("stale upload changed target to %q", got)
	}
	for _, n := range remoteNames(t, e, "sandbox/up") {
		if strings.Contains(n, ".sfpart-") {
			t.Fatalf("412 left a temp file: %s", n)
		}
	}

	// The current version publishes.
	mustStatus(t, uploadBytesWithIfMatch(t, e, e.privID, "up/cond.txt", []byte("three"), c, `"`+v2+`"`), http.StatusOK)
	if got := string(remoteRead(t, e, "sandbox/up/cond.txt")); got != "three" {
		t.Fatalf("current-version upload content = %q", got)
	}
}

func TestConditionalUploadMissingTargetAndStar(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	resp := uploadBytesWithIfMatch(t, e, e.privID, "up/new-cond.txt", []byte("x"), c, `"deadbeef"`)
	if resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("missing target with tag: status = %d, want 412", resp.StatusCode)
	}
	if _, err := remoteLstat(t, e, "sandbox/up/new-cond.txt"); err == nil {
		t.Fatal("missing-target precondition created the file")
	}
	resp = uploadBytesWithIfMatch(t, e, e.privID, "up/new-cond.txt", []byte("x"), c, "*")
	if resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("missing target with *: status = %d, want 412", resp.StatusCode)
	}
	if _, err := remoteLstat(t, e, "sandbox/up/new-cond.txt"); err == nil {
		t.Fatal("star precondition created the file")
	}

	mustStatus(t, uploadBytes(t, e, e.privID, "up/new-cond.txt", []byte("created"), c), http.StatusOK)
	mustStatus(t, uploadBytesWithIfMatch(t, e, e.privID, "up/new-cond.txt", []byte("starred"), c, "*"), http.StatusOK)
	if got := string(remoteRead(t, e, "sandbox/up/new-cond.txt")); got != "starred" {
		t.Fatalf("star upload content = %q", got)
	}
}

func TestConditionalUploadMalformed(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	for _, header := range []string{"not-quoted", "", `* , "v1"`, `"unterminated`} {
		req, err := http.NewRequest(http.MethodPost,
			e.s.BaseURL+"/api/sf/vdirs/"+e.privID+"/upload?path=up/bad.txt",
			bytes.NewReader([]byte("x")))
		if err != nil {
			t.Fatal(err)
		}
		req.ContentLength = 1
		req.AddCookie(c)
		if header != "" {
			req.Header.Set("If-Match", header)
		} else {
			req.Header["If-Match"] = []string{""}
		}
		resp := e.s.Do(t, req)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("If-Match %q: status = %d, want 400", header, resp.StatusCode)
		}
	}

	// A syntactically valid weak tag never matches a strong current tag.
	mustStatus(t, uploadBytes(t, e, e.privID, "up/weak.txt", []byte("one"), c), http.StatusOK)
	v := statFile(t, e, e.privID, "up/weak.txt", c).Version
	resp := uploadBytesWithIfMatch(t, e, e.privID, "up/weak.txt", []byte("two"), c, `W/"`+v+`"`)
	if resp.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("weak If-Match status = %d, want 412", resp.StatusCode)
	}
}

func TestConditionalUploadChangeDuringLongBody(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	mustStatus(t, uploadBytes(t, e, e.privID, "up/slow.txt", []byte("one"), c), http.StatusOK)
	v1 := statFile(t, e, e.privID, "up/slow.txt", c).Version

	pr, pw := io.Pipe()
	req, err := http.NewRequest(http.MethodPost,
		e.s.BaseURL+"/api/sf/vdirs/"+e.privID+"/upload?path=up/slow.txt", pr)
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = -1
	req.AddCookie(c)
	req.Header.Set("If-Match", `"`+v1+`"`)

	done := make(chan *http.Response, 1)
	go func() {
		resp, rerr := http.DefaultClient.Do(req)
		if rerr != nil {
			t.Errorf("slow upload request: %v", rerr)
			done <- nil
			return
		}
		done <- resp
	}()

	if _, err := pw.Write(bytes.Repeat([]byte("a"), 4096)); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)

	scl := fixtureSFTP(t, e)
	writeRemote(t, scl, e.f.Path("sandbox/up/slow.txt"), "external-new")
	scl.Close()

	if _, err := pw.Write(bytes.Repeat([]byte("b"), 4096)); err != nil {
		t.Fatal(err)
	}
	_ = pw.Close()

	resp := <-done
	if resp == nil {
		t.Fatal("no response")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPreconditionFailed {
		b := body(t, resp)
		t.Fatalf("long-body change: status = %d, want 412 (body %.160q)", resp.StatusCode, b)
	}
	if got := string(remoteRead(t, e, "sandbox/up/slow.txt")); got != "external-new" {
		t.Fatalf("long-body upload overwrote newer content: %q", got)
	}
	for _, n := range remoteNames(t, e, "sandbox/up") {
		if strings.Contains(n, ".sfpart-") {
			t.Fatalf("long-body 412 left a temp file: %s", n)
		}
	}
}

func TestConditionalUploadConcurrentRace(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	mustStatus(t, uploadBytes(t, e, e.privID, "up/race.txt", []byte("base"), c), http.StatusOK)
	base := statFile(t, e, e.privID, "up/race.txt", c).Version

	bodies := [][]byte{[]byte("first-writer"), []byte("second-writer")}
	statuses := make([]int, 2)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range bodies {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			resp := uploadBytesWithIfMatch(t, e, e.privID, "up/race.txt", bodies[i], c, `"`+base+`"`)
			statuses[i] = resp.StatusCode
			_ = resp.Body.Close()
		}(i)
	}
	close(start)
	wg.Wait()

	if statuses[0] == statuses[1] {
		t.Fatalf("concurrent conditional uploads both returned %d", statuses[0])
	}
	winner := -1
	for i, status := range statuses {
		switch status {
		case http.StatusOK:
			winner = i
		case http.StatusPreconditionFailed:
		default:
			t.Fatalf("upload %d status = %d", i, status)
		}
	}
	if winner < 0 {
		t.Fatalf("no winner: statuses = %v", statuses)
	}
	if got := remoteRead(t, e, "sandbox/up/race.txt"); !bytes.Equal(got, bodies[winner]) {
		t.Fatalf("winner content %q != %q", got, bodies[winner])
	}
}

func TestMvRotatesTargetVersion(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	before := statFile(t, e, e.privID, "mut/seed.txt", c).Version
	mustStatus(t, opJSON(t, e, e.privID, "mv",
		map[string]string{"path": "hello.txt", "to": "mut/seed.txt"}, c), http.StatusNoContent)
	after := statFile(t, e, e.privID, "mut/seed.txt", c).Version
	if after == before {
		t.Fatalf("mv replacement kept target version %q", before)
	}
}

func testsshBytes(seed int64, n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(seed) + byte(i*31)
	}
	return b
}
