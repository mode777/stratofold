package fileserver_test

import (
	"bytes"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
)

const docsATxt = "the quick brown fox jumps over the lazy dog\n"

type env struct {
	s          *testapp.Server
	f          *testssh.Fixture
	privID     string // non-public vdir over <root>/sandbox
	pubID      string // public vdir over the same root
	otherToken string // a valid token belonging to a non-owner user without a share
	viewerID   string // user holding a viewer share on privID (set by grantViewer)
	editorID   string // user holding an editor share on privID (set by grantEditor)
}

func setup(t *testing.T) *env {
	t.Helper()
	return setupWithOptions(t)
}

func setupWithOptions(t *testing.T, appOpts ...testapp.Option) *env {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	s := testapp.Start(t, appOpts...)

	_, owner := s.LoginBody(t)

	connCol, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", owner["id"])
	conn.Set("label", "fixture")
	conn.Set("host", f.Host)
	conn.Set("port", f.Port)
	conn.Set("username", f.User)
	conn.Set("auth_method", "password")
	conn.Set("password", f.Password)
	conn.Set("host_key_fingerprint", f.Fingerprint)
	if err := s.App.Save(conn); err != nil {
		t.Fatalf("save connection: %v", err)
	}

	vdirCol, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	mkVdir := func(name string, pub bool) *core.Record {
		vd := core.NewRecord(vdirCol)
		vd.Set("owner", owner["id"])
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", f.Path("sandbox"))
		vd.Set("is_public", pub)
		if err := s.App.Save(vd); err != nil {
			t.Fatalf("save vdir %s: %v", name, err)
		}
		return vd
	}
	priv := mkVdir("sandbox", false)
	pub := mkVdir("pub", true)

	// A second user (non-owner), plus viewer/editor share holders —
	// created unshared; the role-specific tests grant as needed.
	usersCol, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	mkUser := func(email string) *core.Record {
		t.Helper()
		rec := core.NewRecord(usersCol)
		rec.SetEmail(email)
		rec.SetPassword("extra-pass-123")
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("seed user %s: %v", email, err)
		}
		return rec
	}
	other := mkUser("other@stratofold.test")
	viewer := mkUser("viewer@stratofold.test")
	editor := mkUser("editor@stratofold.test")
	otherToken, err := other.NewAuthToken()
	if err != nil {
		t.Fatalf("other token: %v", err)
	}

	// Seed the dataset under the sandbox root.
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()
	for _, dir := range []string{"docs", "noindex", "big", "outside"} {
		if err := scl.MkdirAll(f.Path("sandbox/" + dir)); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := scl.MkdirAll(f.Path("outside")); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	writeRemote(t, scl, f.Path("sandbox/docs/a.txt"), docsATxt)
	writeRemote(t, scl, f.Path("sandbox/index.html"), "<h1>root index</h1>\n")
	writeRemote(t, scl, f.Path("sandbox/docs/index.html"), "<h1>docs index</h1>\n")
	writeRemoteBytes(t, scl, f.Path("sandbox/blob.xyz"), testssh.RandomBytes(11, 128))
	writeRemoteBytes(t, scl, f.Path("sandbox/big/range.bin"), testssh.RandomBytes(42, 1<<20))
	writeRemote(t, scl, f.Path("outside/secret.txt"), "outside\n")
	if err := scl.Symlink(f.Path("outside"), f.Path("sandbox/docs/link-out")); err != nil {
		t.Fatalf("symlink out: %v", err)
	}
	if err := scl.Symlink("a.txt", f.Path("sandbox/docs/link-in")); err != nil {
		t.Fatalf("symlink in: %v", err)
	}

	return &env{
		s: s, f: f, privID: priv.Id, pubID: pub.Id, otherToken: otherToken,
		viewerID: viewer.Id, editorID: editor.Id,
	}
}

// grant saves a vdir_shares row directly (record-API rules don't apply
// to server-side saves) and returns the share id.
func (e *env) grant(t *testing.T, vdirID, userID, role string) string {
	t.Helper()
	shares, err := e.s.App.FindCollectionByNameOrId("vdir_shares")
	if err != nil {
		t.Fatalf("vdir_shares collection: %v", err)
	}
	rec := core.NewRecord(shares)
	rec.Set("vdir", vdirID)
	rec.Set("user", userID)
	rec.Set("role", role)
	if err := e.s.App.Save(rec); err != nil {
		t.Fatalf("save share: %v", err)
	}
	return rec.Id
}

func tokenCookie(t *testing.T, e *env, userID string) *http.Cookie {
	t.Helper()
	rec, err := e.s.App.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user %s: %v", userID, err)
	}
	tok, err := rec.NewAuthToken()
	if err != nil {
		t.Fatalf("user token: %v", err)
	}
	return &http.Cookie{Name: "sf_session", Value: tok}
}

func writeRemote(t *testing.T, scl *sftp.Client, path, content string) {
	t.Helper()
	writeRemoteBytes(t, scl, path, []byte(content))
}

func writeRemoteBytes(t *testing.T, scl *sftp.Client, path string, data []byte) {
	t.Helper()
	fp, err := scl.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	defer fp.Close()
	if _, err := fp.Write(data); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// client returns an HTTP client that reports redirects verbatim
// (3xx responses are asserted as-is, never followed).
func client() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func get(t *testing.T, e *env, url string, cookie *http.Cookie, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("request %s: %v", url, err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client().Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	return resp
}

func ownerCookie(t *testing.T, e *env) *http.Cookie {
	t.Helper()
	return e.s.LoginSessionCookie(t)
}

func body(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

func mustStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		b := body(t, resp)
		t.Fatalf("status = %d, want %d (body %.120q)", resp.StatusCode, want, b)
	}
}

func TestServeFileIsByteExact(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	resp := get(t, e, e.s.BaseURL+"/files/"+e.privID+"/docs/a.txt", c, nil)
	mustStatus(t, resp, http.StatusOK)
	if got := string(body(t, resp)); got != docsATxt {
		t.Fatalf("body %q, want %q", got, docsATxt)
	}
	if v := resp.Header.Get("Accept-Ranges"); v != "bytes" {
		t.Fatalf("Accept-Ranges = %q", v)
	}
	etag := resp.Header.Get("ETag")
	if len(etag) < 3 || etag[0] != '"' || etag[len(etag)-1] != '"' {
		t.Fatalf("ETag %q is not a quoted entity tag", etag)
	}
	if _, err := http.ParseTime(resp.Header.Get("Last-Modified")); err != nil {
		t.Fatalf("Last-Modified %q unparseable", resp.Header.Get("Last-Modified"))
	}

	// An internal symlink resolves to the same bytes.
	resp = get(t, e, e.s.BaseURL+"/files/"+e.privID+"/docs/link-in", c, nil)
	mustStatus(t, resp, http.StatusOK)
	if got := string(body(t, resp)); got != docsATxt {
		t.Fatalf("symlinked body %q", got)
	}
}

func TestSandboxRejectionsAre404(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	for _, path := range []string{
		"/%2e%2e/outside/secret.txt", // percent-decoded traversal
		"/docs/link-out/secret.txt",  // remote symlink escape
		"/%2Fetc%2Fpasswd",           // absolute form after decoding
		"/nope.txt",                  // missing file
		"/docs/missing-sub/none.txt", // missing intermediate
	} {
		resp := get(t, e, e.s.BaseURL+"/files/"+e.privID+path, c, nil)
		mustStatus(t, resp, http.StatusNotFound)
		if b := body(t, resp); bytes.Contains(b, []byte("outside")) {
			t.Fatalf("path %s leaked outside content", path)
		}
	}

	// Unknown vdir id.
	resp := get(t, e, e.s.BaseURL+"/files/000000000000000/docs/a.txt", c, nil)
	mustStatus(t, resp, http.StatusNotFound)
}

func TestAccessControl(t *testing.T) {
	e := setup(t)
	fileURL := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"

	// Anonymous on a non-public vdir: 401 and zero SSH dials.
	before := e.f.TotalConns()
	mustStatus(t, get(t, e, fileURL, nil, nil), http.StatusUnauthorized)
	mustStatus(t, get(t, e, fileURL, &http.Cookie{Name: "sf_session", Value: "forged-token"}, nil), http.StatusUnauthorized)
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("rejected requests dialed SSH: %d -> %d connections", before, after)
	}

	// Authenticated non-holder: 403 (also without dialing).
	before = e.f.TotalConns()
	mustStatus(t, get(t, e, fileURL, &http.Cookie{Name: "sf_session", Value: e.otherToken}, nil), http.StatusForbidden)
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("403 dialed SSH: %d -> %d connections", before, after)
	}

	// The owner serves.
	mustStatus(t, get(t, e, fileURL, ownerCookie(t, e), nil), http.StatusOK)

	// A public vdir serves the same file anonymously.
	mustStatus(t, get(t, e, e.s.BaseURL+"/files/"+e.pubID+"/docs/a.txt", nil, nil), http.StatusOK)
}

// Shared users download like the owner; unshared ones still don't.
func TestSharedUserAccess(t *testing.T) {
	e := setup(t)
	fileURL := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"

	// Baseline: an unshared authenticated user is 403 without dialing.
	before := e.f.TotalConns()
	mustStatus(t, get(t, e, fileURL, tokenCookie(t, e, e.viewerID), nil), http.StatusForbidden)
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("403 dialed SSH: %d -> %d connections", before, after)
	}

	// Grant viewer: download serves (plain), including a Range request.
	shareID := e.grant(t, e.privID, e.viewerID, "viewer")
	vc := tokenCookie(t, e, e.viewerID)
	mustStatus(t, get(t, e, fileURL, vc, nil), http.StatusOK)
	resp := get(t, e, fileURL, vc, map[string]string{"Range": "bytes=2-5"})
	mustStatus(t, resp, http.StatusPartialContent)
	if got := string(body(t, resp)); got != docsATxt[2:6] {
		t.Fatalf("viewer range body %q", got)
	}

	// Removing the share denies the same still-valid session on the
	// next request (revocation is immediate).
	shareRec, err := e.s.App.FindRecordById("vdir_shares", shareID)
	if err != nil {
		t.Fatalf("find share: %v", err)
	}
	if err := e.s.App.Delete(shareRec); err != nil {
		t.Fatalf("delete share: %v", err)
	}
	before = e.f.TotalConns()
	mustStatus(t, get(t, e, fileURL, vc, nil), http.StatusForbidden)
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("revoked 403 dialed SSH: %d -> %d connections", before, after)
	}

	// Editor: download serves too.
	e.grant(t, e.privID, e.editorID, "editor")
	mustStatus(t, get(t, e, fileURL, tokenCookie(t, e, e.editorID), nil), http.StatusOK)

	// Public vdirs are unchanged: anonymous reads, and shares add
	// nothing (read is already granted to everyone).
	mustStatus(t, get(t, e, e.s.BaseURL+"/files/"+e.pubID+"/docs/a.txt", nil, nil), http.StatusOK)

	// Un-publishing closes anonymous access immediately (task 5.1).
	pubRec, err := e.s.App.FindRecordById("vdirs", e.pubID)
	if err != nil {
		t.Fatalf("find pub vdir: %v", err)
	}
	pubRec.Set("is_public", false)
	if err := e.s.App.Save(pubRec); err != nil {
		t.Fatalf("unpublish: %v", err)
	}
	before = e.f.TotalConns()
	mustStatus(t, get(t, e, e.s.BaseURL+"/files/"+e.pubID+"/docs/a.txt", nil, nil), http.StatusUnauthorized)
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("unpublished 401 dialed SSH: %d -> %d connections", before, after)
	}
}

func TestRangeMatrix(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)
	url := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"
	full := docsATxt
	size := len(full)

	for _, tc := range []struct {
		header       string
		status       int
		contentRange string
		want         string
	}{
		{"bytes=2-5", 206, "bytes 2-5/" + strconv.Itoa(size), full[2:6]},
		{"bytes=7-", 206, "bytes 7-" + strconv.Itoa(size-1) + "/" + strconv.Itoa(size), full[7:]},
		{"bytes=-3", 206, "bytes " + strconv.Itoa(size-3) + "-" + strconv.Itoa(size-1) + "/" + strconv.Itoa(size), full[size-3:]},
		{"bytes=8-100", 206, "bytes 8-" + strconv.Itoa(size-1) + "/" + strconv.Itoa(size), full[8:]},
		{"bytes=-50", 206, "bytes 0-" + strconv.Itoa(size-1) + "/" + strconv.Itoa(size), full},
		{"bytes=40-42", 206, "bytes 40-42/" + strconv.Itoa(size), full[40:43]},
		{"bytes=" + strconv.Itoa(size) + "-", 416, "bytes */" + strconv.Itoa(size), ""},
		{"bytes=-0", 416, "bytes */" + strconv.Itoa(size), ""},
		{"bytes=0-1,3-4", 200, "", full},
		{"bytes=abc", 200, "", full},
		{"chunks=0-1", 200, "", full},
		{"bytes=", 200, "", full},
	} {
		t.Run(tc.header, func(t *testing.T) {
			resp := get(t, e, url, c, map[string]string{"Range": tc.header})
			mustStatus(t, resp, tc.status)
			if got := resp.Header.Get("Content-Range"); got != tc.contentRange {
				t.Fatalf("Content-Range = %q, want %q", got, tc.contentRange)
			}
			if got := string(body(t, resp)); got != tc.want {
				t.Fatalf("body %.30q, want %.30q", got, tc.want)
			}
			if tc.status == 206 {
				if cl := resp.ContentLength; int(cl) != len(tc.want) {
					t.Fatalf("Content-Length = %d, want %d", cl, len(tc.want))
				}
			}
		})
	}
}

func TestRangeAcrossChunkBoundaries(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)
	src := testssh.RandomBytes(42, 1<<20)

	resp := get(t, e, e.s.BaseURL+"/files/"+e.privID+"/big/range.bin", c,
		map[string]string{"Range": "bytes=1000-2003"})
	if resp.StatusCode != 206 {
		t.Fatalf("status = %d, want 206", resp.StatusCode)
	}
	if got, want := resp.Header.Get("Content-Range"), "bytes 1000-2003/1048576"; got != want {
		t.Fatalf("Content-Range = %q, want %q", got, want)
	}
	if got := body(t, resp); !bytes.Equal(got, src[1000:2004]) {
		t.Fatalf("ranged slice mismatch")
	}
}

func TestConditionalRequests(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)
	url := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"

	first := get(t, e, url, c, nil)
	mustStatus(t, first, http.StatusOK)
	body(t, first)
	etag := first.Header.Get("ETag")
	lm := first.Header.Get("Last-Modified")

	t.Run("if-none-match", func(t *testing.T) {
		resp := get(t, e, url, c, map[string]string{"If-None-Match": etag})
		mustStatus(t, resp, http.StatusNotModified)
		if b := body(t, resp); len(b) != 0 {
			t.Fatalf("304 carried a body: %.40q", b)
		}
	})
	t.Run("if-none-match-star", func(t *testing.T) {
		mustStatus(t, get(t, e, url, c, map[string]string{"If-None-Match": "*"}), http.StatusNotModified)
	})
	t.Run("if-none-match-mismatch-serves", func(t *testing.T) {
		mustStatus(t, get(t, e, url, c, map[string]string{"If-None-Match": `"deadbeef-deadbeef"`}), http.StatusOK)
	})
	t.Run("if-modified-since", func(t *testing.T) {
		mustStatus(t, get(t, e, url, c, map[string]string{"If-Modified-Since": lm}), http.StatusNotModified)
	})
	t.Run("if-modified-since-future", func(t *testing.T) {
		mustStatus(t, get(t, e, url, c, map[string]string{"If-Modified-Since": "Sun, 01 Jan 2040 00:00:00 GMT"}), http.StatusNotModified)
	})
	t.Run("if-modified-since-stale-serves", func(t *testing.T) {
		mustStatus(t, get(t, e, url, c, map[string]string{"If-Modified-Since": "Mon, 01 Jan 2001 00:00:00 GMT"}), http.StatusOK)
	})
	t.Run("if-none-match-precedes", func(t *testing.T) {
		// Matching INM plus a stale IMS: 304 without evaluating IMS.
		resp := get(t, e, url, c, map[string]string{
			"If-None-Match":     etag,
			"If-Modified-Since": "Mon, 01 Jan 2001 00:00:00 GMT",
		})
		mustStatus(t, resp, http.StatusNotModified)
	})
	t.Run("conditional-beats-range", func(t *testing.T) {
		resp := get(t, e, url, c, map[string]string{
			"If-None-Match": etag,
			"Range":         "bytes=0-1",
		})
		mustStatus(t, resp, http.StatusNotModified)
	})
}

func TestContentHeaders(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)

	t.Run("known extension maps to type", func(t *testing.T) {
		resp := get(t, e, e.s.BaseURL+"/files/"+e.privID+"/docs/a.txt", c, nil)
		mustStatus(t, resp, http.StatusOK)
		if ct := resp.Header.Get("Content-Type"); ct != "text/plain" {
			t.Fatalf("Content-Type = %q, want text/plain", ct)
		}
		body(t, resp)
	})
	t.Run("html", func(t *testing.T) {
		resp := get(t, e, e.s.BaseURL+"/files/"+e.privID+"/", c, nil)
		mustStatus(t, resp, http.StatusOK)
		if ct := resp.Header.Get("Content-Type"); ct != "text/html" {
			t.Fatalf("Content-Type = %q, want text/html", ct)
		}
		body(t, resp)
	})
	t.Run("unknown extension defaults to octet-stream", func(t *testing.T) {
		resp := get(t, e, e.s.BaseURL+"/files/"+e.privID+"/blob.xyz", c, nil)
		mustStatus(t, resp, http.StatusOK)
		if ct := resp.Header.Get("Content-Type"); ct != "application/octet-stream" {
			t.Fatalf("Content-Type = %q", ct)
		}
		if cl := resp.ContentLength; cl != 128 {
			t.Fatalf("Content-Length = %d, want 128", cl)
		}
		body(t, resp)
	})
}

func TestDirectorySemantics(t *testing.T) {
	e := setup(t)
	c := ownerCookie(t, e)
	base := e.s.BaseURL + "/files/" + e.privID

	t.Run("root with trailing slash serves root index", func(t *testing.T) {
		resp := get(t, e, base+"/", c, nil)
		mustStatus(t, resp, http.StatusOK)
		if got := string(body(t, resp)); got != "<h1>root index</h1>\n" {
			t.Fatalf("root index body %q", got)
		}
	})
	t.Run("bare vdir form serves root index", func(t *testing.T) {
		resp := get(t, e, base, c, nil)
		mustStatus(t, resp, http.StatusOK)
		if got := string(body(t, resp)); got != "<h1>root index</h1>\n" {
			t.Fatalf("root index body %q", got)
		}
	})
	t.Run("unslashed directory redirects", func(t *testing.T) {
		resp := get(t, e, base+"/docs", c, nil)
		mustStatus(t, resp, http.StatusMovedPermanently)
		if loc := resp.Header.Get("Location"); !strings.HasSuffix(loc, "/files/"+e.privID+"/docs/") {
			t.Fatalf("Location = %q", loc)
		}
		body(t, resp)
	})
	t.Run("slashed directory serves its index", func(t *testing.T) {
		resp := get(t, e, base+"/docs/", c, nil)
		mustStatus(t, resp, http.StatusOK)
		if got := string(body(t, resp)); got != "<h1>docs index</h1>\n" {
			t.Fatalf("docs index body %q", got)
		}
	})
	t.Run("directory without index is 404, never a listing", func(t *testing.T) {
		resp := get(t, e, base+"/noindex/", c, nil)
		mustStatus(t, resp, http.StatusNotFound)
		if b := body(t, resp); len(b) != 0 && bytes.Contains(b, []byte("noindex")) {
			t.Fatalf("404 body hints at a listing: %.80q", b)
		}
	})
	t.Run("missing directory is 404 without redirect", func(t *testing.T) {
		mustStatus(t, get(t, e, base+"/missing-dir", c, nil), http.StatusNotFound)
	})
	t.Run("file with trailing slash is 404", func(t *testing.T) {
		mustStatus(t, get(t, e, base+"/docs/a.txt/", c, nil), http.StatusNotFound)
	})
}

func TestPublicVdirDirectoryAndRangeAnonymously(t *testing.T) {
	e := setup(t)
	resp := get(t, e, e.s.BaseURL+"/files/"+e.pubID+"/docs/a.txt", nil,
		map[string]string{"Range": "bytes=0-4"})
	mustStatus(t, resp, http.StatusPartialContent)
	if got := string(body(t, resp)); got != docsATxt[:5] {
		t.Fatalf("anonymous range body %q", got)
	}
}
