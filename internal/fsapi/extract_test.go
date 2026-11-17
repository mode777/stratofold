package fsapi_test

// Integration tests for the archive-extraction routes (the
// archive-extraction spec) through the production wiring: the authz
// matrix runs before any dial, job creation maps its errors
// deterministically, and the job is observable and cancelable by writers
// only.

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
)

func makeZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
	for _, n := range names {
		fw, err := w.Create(n)
		if err != nil {
			t.Fatalf("zip create %s: %v", n, err)
		}
		if _, err := fw.Write([]byte(files[n])); err != nil {
			t.Fatalf("zip write %s: %v", n, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func needOK(t *testing.T, resp *http.Response, what string) {
	t.Helper()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("%s: status = %d, body %s", what, resp.StatusCode, bodyOf(t, resp))
	}
	_ = resp.Body.Close()
}

func bodyOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(b)
}

type jobDoc struct {
	ID             string `json:"id"`
	State          string `json:"state"`
	Phase          string `json:"phase"`
	Path           string `json:"path"`
	Target         string `json:"target"`
	Skipped        int    `json:"skipped"`
	SkippedInvalid int    `json:"skippedInvalid"`
	SkippedDetails []struct {
		Name   string `json:"name"`
		Reason string `json:"reason"`
	} `json:"skippedDetails"`
	Error *struct {
		Status  int    `json:"status"`
		Message string `json:"message"`
	} `json:"error"`
}

func extractJob(t *testing.T, doc map[string]any) jobDoc {
	t.Helper()
	raw, err := json.Marshal(doc["job"])
	if err != nil {
		t.Fatalf("marshal job: %v", err)
	}
	var j jobDoc
	if err := json.Unmarshal(raw, &j); err != nil {
		t.Fatalf("decode job: %v", err)
	}
	return j
}

func postExtract(t *testing.T, e *env, vdirID string, payload any, cookie *http.Cookie) (*http.Response, map[string]any) {
	t.Helper()
	resp := opJSON(t, e, vdirID, "extract", payload, cookie)
	raw := bodyOf(t, resp)
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("decode extract response %q: %v", raw, err)
	}
	return resp, out
}

func getJob(t *testing.T, e *env, vdirID, jobID string, cookie *http.Cookie) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet,
		fmt.Sprintf("%s/api/sf/vdirs/%s/extract/%s", e.s.BaseURL, vdirID, jobID), nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET job: %v", err)
	}
	raw := bodyOf(t, resp)
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("decode job response %q: %v", raw, err)
	}
	return resp, out
}

func waitJob(t *testing.T, e *env, vdirID, jobID string, cookie *http.Cookie) jobDoc {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		_, doc := getJob(t, e, vdirID, jobID, cookie)
		j := extractJob(t, doc)
		if j.State != "running" {
			return j
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("extraction job did not settle")
	return jobDoc{}
}

func TestExtractWriteAccessMatrix(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	zipBytes := makeZip(t, map[string]string{"a.txt": "alpha"})
	needOK(t, uploadBytes(t, e, e.privID, "docs/photos.zip", zipBytes, c), "seed archive")
	_ = e.grant(t, e.privID, e.viewerID, "viewer")
	_ = e.grant(t, e.privID, e.editorID, "editor")

	payload := map[string]string{"path": "docs/photos.zip", "name": "out"}

	t.Run("owner accepted", func(t *testing.T) {
		dials := e.f.TotalConns()
		resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/photos.zip", "name": "owner-out"}, c)
		if resp.StatusCode != http.StatusAccepted {
			t.Fatalf("status = %d, want 202 (%v)", resp.StatusCode, doc)
		}
		if e.f.TotalConns() < dials {
			t.Fatal("dial bookkeeping regressed")
		}
		j := extractJob(t, doc)
		if j.ID == "" || j.Target != "docs/owner-out" {
			t.Fatalf("job = %+v", j)
		}
		waitJob(t, e, e.privID, j.ID, c)
	})

	t.Run("editor accepted", func(t *testing.T) {
		resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/photos.zip", "name": "editor-out"}, tokenCookie(t, e, e.editorID))
		if resp.StatusCode != http.StatusAccepted {
			t.Fatalf("status = %d, want 202 (%v)", resp.StatusCode, doc)
		}
		waitJob(t, e, e.privID, extractJob(t, doc).ID, tokenCookie(t, e, e.editorID))
	})

	cases := []struct {
		name   string
		cookie *http.Cookie
		want   int
	}{
		{"viewer forbidden", tokenCookie(t, e, e.viewerID), http.StatusForbidden},
		{"other user forbidden", &http.Cookie{Name: "sf_session", Value: e.otherToken}, http.StatusForbidden},
		{"anonymous unauthorized", nil, http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := e.f.TotalConns()
			resp, doc := postExtract(t, e, e.privID, payload, tc.cookie)
			if resp.StatusCode != tc.want {
				t.Fatalf("status = %d, want %d (%v)", resp.StatusCode, tc.want, doc)
			}
			if after := e.f.TotalConns(); after > before {
				t.Fatalf("a rejected extraction dialed: conns %d -> %d", before, after)
			}
		})
	}

	t.Run("public vdir anonymous rejected", func(t *testing.T) {
		needOK(t, uploadBytes(t, e, e.pubID, "p.zip", zipBytes, c), "seed public archive")
		resp, _ := postExtract(t, e, e.pubID, map[string]string{"path": "p.zip"}, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", resp.StatusCode)
		}
	})
}

func TestExtractPublishesAndIsObservable(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	zipBytes := makeZip(t, map[string]string{
		"a.txt":            "alpha",
		"sub/b.txt":        "beta",
		".DS_Store":        "junk",
		"__MACOSX/._a.txt": "junk",
	})
	needOK(t, uploadBytes(t, e, e.privID, "docs/photos.zip", zipBytes, c), "seed archive")

	resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/photos.zip"}, c)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}
	j := extractJob(t, doc)
	if j.Target != "docs/photos" {
		t.Fatalf("target = %q, want docs/photos", j.Target)
	}
	final := waitJob(t, e, e.privID, j.ID, c)
	if final.State != "succeeded" {
		t.Fatalf("state = %s (%+v)", final.State, final.Error)
	}
	if final.Skipped != 2 {
		t.Fatalf("skipped = %d, want 2", final.Skipped)
	}

	// The listing shows the new folder beside the archive.
	listResp := opJSON(t, e, e.privID, "ls", map[string]string{"path": "docs"}, c)
	needOK(t, listResp, "list docs")
	if !strings.Contains(bodyOf(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": "docs"}, c)), `"photos"`) {
		t.Fatal("extracted folder missing from the listing")
	}

	// Every member is fetchable through the file server.
	for _, rel := range []string{"docs/photos/a.txt", "docs/photos/sub/b.txt"} {
		r := opJSON(t, e, e.privID, "stat", map[string]string{"path": rel}, c)
		needOK(t, r, "stat "+rel)
	}
}

// TestExtractSkipFieldsRoundTrip pins the skip reporting through the API:
// cosmetic and invalid skips arrive separately, and the invalid sample
// names the entry with its reason, on the same GET the UI polls.
func TestExtractSkipFieldsRoundTrip(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	zipBytes := makeZip(t, map[string]string{
		"ok.txt":        "ok",
		"../escape.txt": "hostile",
		".DS_Store":     "junk",
	})
	needOK(t, uploadBytes(t, e, e.privID, "docs/mixed.zip", zipBytes, c), "seed archive")

	resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/mixed.zip"}, c)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}
	j := extractJob(t, doc)
	final := waitJob(t, e, e.privID, j.ID, c)
	if final.State != "succeeded" {
		t.Fatalf("state = %s (%+v)", final.State, final.Error)
	}
	if final.Skipped != 1 {
		t.Fatalf("skipped = %d, want 1 cosmetic (.DS_Store)", final.Skipped)
	}
	if final.SkippedInvalid != 1 {
		t.Fatalf("skippedInvalid = %d, want 1", final.SkippedInvalid)
	}
	if len(final.SkippedDetails) != 1 {
		t.Fatalf("skippedDetails = %+v, want one record", final.SkippedDetails)
	}
	if final.SkippedDetails[0].Name != "../escape.txt" || final.SkippedDetails[0].Reason != "unsafe-name" {
		t.Fatalf("skippedDetails[0] = %+v, want ../escape.txt/unsafe-name", final.SkippedDetails[0])
	}
	// The good member is published; the hostile one never landed.
	r := opJSON(t, e, e.privID, "stat", map[string]string{"path": "docs/mixed/ok.txt"}, c)
	needOK(t, r, "stat ok.txt")
}

func TestExtractCreationErrors(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	needOK(t, uploadBytes(t, e, e.privID, "docs/photos.zip", makeZip(t, map[string]string{"a.txt": "a"}), c), "seed")
	needOK(t, uploadBytes(t, e, e.privID, "docs/notzip.bin", []byte("not a zip at all"), c), "seed non-zip")

	cases := []struct {
		name  string
		path  string
		extra map[string]string
		want  int
	}{
		{"missing path", "", nil, http.StatusBadRequest},
		{"missing archive", "docs/nope.zip", nil, http.StatusNotFound},
		{"not an archive", "docs/notzip.bin", nil, http.StatusBadRequest},
		{"directory source", "docs", nil, http.StatusBadRequest},
		{"escaping path", "../outside.zip", nil, http.StatusNotFound},
		{"bad target name", "docs/photos.zip", map[string]string{"name": "a/b"}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := map[string]string{"path": tc.path}
			for k, v := range tc.extra {
				payload[k] = v
			}
			resp, _ := postExtract(t, e, e.privID, payload, c)
			if resp.StatusCode != tc.want {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tc.want)
			}
		})
	}

	t.Run("existing target conflicts", func(t *testing.T) {
		mk := opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "docs/photos"}, c)
		if mk.StatusCode != http.StatusNoContent {
			t.Fatalf("mkdir status = %d, want 204", mk.StatusCode)
		}
		resp, _ := postExtract(t, e, e.privID, map[string]string{"path": "docs/photos.zip"}, c)
		if resp.StatusCode != http.StatusConflict {
			t.Fatalf("status = %d, want 409", resp.StatusCode)
		}
	})

	t.Run("unknown job is not found", func(t *testing.T) {
		resp, _ := getJob(t, e, e.privID, "deadbeefdeadbeefdeadbeefdeadbeef", c)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", resp.StatusCode)
		}
	})
}

// TestExtractAllSkippedFailsExplicitly pins the nothing-extracted guard
// through the API: a fully encrypted archive is a 400 with skip counts,
// not an empty published folder.
func TestExtractAllSkippedFailsExplicitly(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "secret.txt", Method: zip.Deflate}
	h.Flags |= 0x1 // encrypted
	fw, err := w.CreateHeader(h)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := fw.Write([]byte("x")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	needOK(t, uploadBytes(t, e, e.privID, "docs/locked.zip", buf.Bytes(), c), "seed locked")

	resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/locked.zip"}, c)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}
	j := extractJob(t, doc)
	final := waitJob(t, e, e.privID, j.ID, c)
	if final.State != "failed" {
		t.Fatalf("state = %s, want failed", final.State)
	}
	if final.Error == nil || final.Error.Status != http.StatusBadRequest {
		t.Fatalf("error = %+v, want 400", final.Error)
	}
	if !strings.Contains(final.Error.Message, "encrypted") || !strings.Contains(final.Error.Message, "nothing could be extracted") {
		t.Fatalf("message = %q, want the nothing-extracted wording naming encryption", final.Error.Message)
	}
	if final.SkippedInvalid != 1 {
		t.Fatalf("skippedInvalid = %d, want 1 reported with the failure", final.SkippedInvalid)
	}
	// Nothing was published.
	r := opJSON(t, e, e.privID, "stat", map[string]string{"path": "docs/locked"}, c)
	if r.StatusCode != http.StatusNotFound {
		t.Fatalf("stat status = %d, want 404", r.StatusCode)
	}
}

func TestExtractJobsAreScopedToWriters(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	_ = e.grant(t, e.privID, e.editorID, "editor")
	needOK(t, uploadBytes(t, e, e.privID, "docs/photos.zip", makeZip(t, map[string]string{"a.txt": "a"}), c), "seed")

	resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/photos.zip"}, c)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}
	j := extractJob(t, doc)
	waitJob(t, e, e.privID, j.ID, c)

	// Another authenticated user without a grant cannot observe or cancel.
	other := &http.Cookie{Name: "sf_session", Value: e.otherToken}
	if resp, _ := getJob(t, e, e.privID, j.ID, other); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("other user poll status = %d, want 403", resp.StatusCode)
	}
	delResp := e.s.Delete(t, fmt.Sprintf("/api/sf/vdirs/%s/extract/%s", e.privID, j.ID), []*http.Cookie{other})
	if delResp.StatusCode != http.StatusForbidden {
		t.Fatalf("other user cancel status = %d, want 403", delResp.StatusCode)
	}

	// A writer cancels: idempotent on a finished job.
	del := e.s.Delete(t, fmt.Sprintf("/api/sf/vdirs/%s/extract/%s", e.privID, j.ID), []*http.Cookie{c})
	delBody := bodyOf(t, del)
	if del.StatusCode != http.StatusOK {
		t.Fatalf("cancel status = %d, want 200 (%s)", del.StatusCode, delBody)
	}
	if !strings.Contains(delBody, `"succeeded"`) {
		t.Fatalf("cancel of a finished job must report its terminal state: %s", delBody)
	}
}

func TestExtractCancelRunningJob(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)
	files := map[string]string{}
	for i := 0; i < 200; i++ {
		files[fmt.Sprintf("d%d/f%d.txt", i%10, i)] = strings.Repeat("x", 4096)
	}
	needOK(t, uploadBytes(t, e, e.privID, "docs/big.zip", makeZip(t, files), c), "seed big")

	resp, doc := postExtract(t, e, e.privID, map[string]string{"path": "docs/big.zip"}, c)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}
	j := extractJob(t, doc)

	del := e.s.Delete(t, fmt.Sprintf("/api/sf/vdirs/%s/extract/%s", e.privID, j.ID), []*http.Cookie{c})
	needOK(t, del, "cancel")

	final := waitJob(t, e, e.privID, j.ID, c)
	if final.State != "canceled" && final.State != "succeeded" {
		t.Fatalf("state = %s, want canceled or succeeded", final.State)
	}
	if final.State == "canceled" {
		// A canceled job publishes nothing.
		r := opJSON(t, e, e.privID, "stat", map[string]string{"path": "docs/big"}, c)
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("canceled extraction published a folder: status %d", r.StatusCode)
		}
	}
}

func TestLsHidesScratchNamesOnly(t *testing.T) {
	e := setup(t)
	c := e.s.LoginSessionCookie(t)

	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	defer scl.Close()
	scratch := []string{
		".photos.zip.sfext-0123456789abcdef",
		".movie.mp4.sfpart-0123456789abcdef",
	}
	keep := []string{
		".bashrc",
		".git",
		"notes.sfext-not-hex.txt",
		"photo.sfext-0123456789abcdef",  // no leading dot: not ours
		".report.sfext-0123456789abcde", // wrong hex length
	}
	for _, name := range append(append([]string{}, scratch...), keep...) {
		if err := scl.MkdirAll(e.f.Path("sandbox/scratch/" + name)); err != nil {
			t.Fatalf("mkdir %s: %v", name, err)
		}
	}

	resp := opJSON(t, e, e.privID, "ls", map[string]string{"path": "scratch"}, c)
	needOK(t, resp, "ls scratch")
	raw := bodyOf(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": "scratch"}, c))
	for _, name := range scratch {
		if strings.Contains(raw, url.QueryEscape(name)) || strings.Contains(raw, name) {
			t.Fatalf("scratch entry %q leaked into the listing: %s", name, raw)
		}
	}
	for _, name := range keep {
		if !strings.Contains(raw, name) {
			t.Fatalf("%q must keep listing, body: %s", name, raw)
		}
	}
}
