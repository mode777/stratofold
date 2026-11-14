package fileserver_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"testing"
)

type statResult struct {
	Version string `json:"version"`
}

func statVersion(t *testing.T, e *env, path string, cookie *http.Cookie) string {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"path": path})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, e.s.BaseURL+"/api/sf/vdirs/"+e.privID+"/stat", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("stat %q: status %d body %.160q", path, resp.StatusCode, b)
	}
	var out statResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode stat: %v", err)
	}
	return out.Version
}

func uploadFile(t *testing.T, e *env, path string, content []byte, cookie *http.Cookie) {
	t.Helper()
	u := fmt.Sprintf("%s/api/sf/vdirs/%s/upload?%s", e.s.BaseURL, e.privID,
		url.Values{"path": {path}}.Encode())
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = int64(len(content))
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("upload %q: status %d body %.160q", path, resp.StatusCode, b)
	}
}

func TestFileServerETagMatchesStatConditionalHeadAndRange(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	url := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(c)
	full := e.s.Do(t, req)
	defer full.Body.Close()
	if full.StatusCode != http.StatusOK {
		t.Fatalf("GET status = %d", full.StatusCode)
	}
	etag := full.Header.Get("ETag")
	version := statVersion(t, e, "docs/a.txt", c)
	if etag != `"`+version+`"` {
		t.Fatalf("ETag = %q, stat version = %q", etag, version)
	}

	req, _ = http.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(c)
	req.Header.Set("If-None-Match", etag)
	notModified := e.s.Do(t, req)
	defer notModified.Body.Close()
	if notModified.StatusCode != http.StatusNotModified {
		t.Fatalf("If-None-Match status = %d, want 304", notModified.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodHead, url, nil)
	req.AddCookie(c)
	head := e.s.Do(t, req)
	defer head.Body.Close()
	if head.StatusCode != http.StatusOK {
		t.Fatalf("HEAD status = %d", head.StatusCode)
	}
	if head.Header.Get("ETag") != etag {
		t.Fatalf("HEAD ETag = %q, want %q", head.Header.Get("ETag"), etag)
	}
	if head.Header.Get("Content-Length") != full.Header.Get("Content-Length") {
		t.Fatalf("HEAD Content-Length = %q, want %q", head.Header.Get("Content-Length"), full.Header.Get("Content-Length"))
	}
	if b, _ := io.ReadAll(head.Body); len(b) != 0 {
		t.Fatalf("HEAD returned %d body bytes", len(b))
	}

	req, _ = http.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(c)
	req.Header.Set("Range", "bytes=0-4")
	partial := e.s.Do(t, req)
	defer partial.Body.Close()
	if partial.StatusCode != http.StatusPartialContent {
		t.Fatalf("Range status = %d, want 206", partial.StatusCode)
	}
	if partial.Header.Get("ETag") != etag {
		t.Fatalf("Range ETag = %q, want %q", partial.Header.Get("ETag"), etag)
	}
	partialBody, _ := io.ReadAll(partial.Body)
	if string(partialBody) != docsATxt[:5] {
		t.Fatalf("Range body = %q, want %q", partialBody, docsATxt[:5])
	}
}

func TestFileServerETagRotatesOnSameSizeUpload(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	url := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(c)
	before := e.s.Do(t, req)
	oldETag := before.Header.Get("ETag")
	before.Body.Close()

	// Same byte length as docsATxt, only the content differs.
	replacement := []byte("THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG\n")
	if len(replacement) != len(docsATxt) {
		t.Fatalf("test replacement length = %d, want %d", len(replacement), len(docsATxt))
	}
	uploadFile(t, e, "docs/a.txt", replacement, c)

	req, _ = http.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(c)
	req.Header.Set("If-None-Match", oldETag)
	after := e.s.Do(t, req)
	defer after.Body.Close()
	if after.StatusCode != http.StatusOK {
		t.Fatalf("stale ETag status = %d, want 200", after.StatusCode)
	}
	newETag := after.Header.Get("ETag")
	if newETag == oldETag {
		t.Fatalf("same-size upload kept ETag %q", oldETag)
	}
	if got := statVersion(t, e, "docs/a.txt", c); newETag != `"`+got+`"` {
		t.Fatalf("new ETag = %q, stat version = %q", newETag, got)
	}
	body, _ := io.ReadAll(after.Body)
	if !bytes.Equal(body, replacement) {
		t.Fatalf("new content = %q", body)
	}
}

func TestFileServerVersionStoreFailureIs500(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	if _, err := e.s.App.DB().NewQuery("DROP TABLE file_versions").Execute(); err != nil {
		t.Fatalf("drop version store: %v", err)
	}
	req, _ := http.NewRequest(http.MethodGet, e.s.BaseURL+"/files/"+e.privID+"/docs/a.txt", nil)
	req.AddCookie(c)
	resp := e.s.Do(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("missing version store: status = %d, want 500 (body %.160q)", resp.StatusCode, b)
	}
}

func TestFileServerIndexETagMatchesStat(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	req, _ := http.NewRequest(http.MethodGet, e.s.BaseURL+"/files/"+e.privID+"/docs/", nil)
	req.AddCookie(c)
	resp := e.s.Do(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("index GET status = %d", resp.StatusCode)
	}
	version := statVersion(t, e, "docs/index.html", c)
	if got := resp.Header.Get("ETag"); got != `"`+version+`"` {
		t.Fatalf("index ETag = %q, stat version = %q", got, version)
	}
}
