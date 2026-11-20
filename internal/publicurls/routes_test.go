package publicurls_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
)

const (
	aliasDocsText = "the quick brown fox jumps over the lazy dog\n"
	aliasTenBytes = "0123456789"
	aliasShell    = "Stratofold SPA placeholder"
)

type aliasEnv struct {
	s      *testapp.Server
	f      *testssh.Fixture
	public *core.Record
	priv   *core.Record
}

func newAliasEnv(t *testing.T) *aliasEnv {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	s := testapp.Start(t)
	_, owner := s.LoginBody(t)

	connections, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(connections)
	conn.Set("owner", owner["id"])
	conn.Set("label", "alias-fixture")
	conn.Set("host", f.Host)
	conn.Set("port", f.Port)
	conn.Set("username", f.User)
	conn.Set("auth_method", "password")
	conn.Set("password", f.Password)
	conn.Set("host_key_fingerprint", f.Fingerprint)
	if err := s.App.Save(conn); err != nil {
		t.Fatalf("save connection: %v", err)
	}

	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	mk := func(name, slug string, public bool) *core.Record {
		vd := core.NewRecord(vdirs)
		vd.Set("owner", owner["id"])
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", f.Path("sandbox"))
		vd.Set("is_public", public)
		vd.Set("public_slug", slug)
		if err := s.App.Save(vd); err != nil {
			t.Fatalf("save vdir %s: %v", name, err)
		}
		return vd
	}

	pub := mk("Public", "pretty", true)
	priv := mk("Private", "private-alias", false)

	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()
	for _, dir := range []string{"docs", "docs/sub", "docs/view", "view"} {
		if err := scl.MkdirAll(f.Path("sandbox/" + dir)); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := scl.MkdirAll(f.Path("outside")); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	writeFile(t, scl, f.Path("sandbox/index.html"), "<h1>root index</h1>\n")
	writeFile(t, scl, f.Path("sandbox/docs/a.txt"), aliasDocsText)
	writeFile(t, scl, f.Path("sandbox/docs/ten.txt"), aliasTenBytes)
	writeFile(t, scl, f.Path("sandbox/docs/sub/index.html"), "<h1>sub index</h1>\n")
	writeFile(t, scl, f.Path("sandbox/view/photo.jpg"), "view bytes")
	writeFile(t, scl, f.Path("sandbox/view/index.html"), "<h1>view index</h1>\n")
	writeFile(t, scl, f.Path("sandbox/docs/view/photo.jpg"), "nested view bytes")
	writeFile(t, scl, f.Path("outside/secret.txt"), "outside secret\n")
	if err := scl.Symlink(f.Path("outside"), f.Path("sandbox/docs/link-out")); err != nil {
		t.Fatalf("symlink out: %v", err)
	}

	return &aliasEnv{s: s, f: f, public: pub, priv: priv}
}

func writeFile(t *testing.T, scl *sftp.Client, path, content string) {
	t.Helper()
	fp, err := scl.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	defer fp.Close()
	if _, err := fp.Write([]byte(content)); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func httpClient() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func doAlias(t *testing.T, method, url string, headers map[string]string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
}

func readAll(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	_ = resp.Body.Close()
	return body
}

func TestAliasBrowseRoutes(t *testing.T) {
	e := newAliasEnv(t)

	t.Run("bare alias redirects to the slashed browse root", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty", nil, nil)
		_ = readAll(t, resp)
		if resp.StatusCode != http.StatusMovedPermanently {
			t.Fatalf("status = %d, want 301", resp.StatusCode)
		}
		if loc := resp.Header.Get("Location"); loc != "/apps/pretty/" {
			t.Fatalf("Location = %q, want /apps/pretty/", loc)
		}
	})

	t.Run("folders without an index serve the shell", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/docs/", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status %d, want 200", resp.StatusCode)
		}
		if !bytes.Contains(body, []byte(aliasShell)) {
			t.Fatalf("docs/ did not return the SPA shell: %.100s", body)
		}
	})

	t.Run("root index is served", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || string(body) != "<h1>root index</h1>\n" {
			t.Fatalf("root index: status %d body %q", resp.StatusCode, body)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Fatalf("root index Content-Type = %q, want text/html", ct)
		}
		if resp.Header.Get("ETag") == "" {
			t.Fatal("root index has no ETag")
		}
	})

	t.Run("nested index is served", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/docs/sub/", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || string(body) != "<h1>sub index</h1>\n" {
			t.Fatalf("nested index: status %d body %q", resp.StatusCode, body)
		}
	})

	t.Run("explicit index path streams the same file", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/index.html", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || string(body) != "<h1>root index</h1>\n" {
			t.Fatalf("explicit index.html: status %d body %q", resp.StatusCode, body)
		}
	})

	t.Run("unslashed directory redirects to the slashed browse form", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/docs", nil, nil)
		_ = readAll(t, resp)
		if resp.StatusCode != http.StatusMovedPermanently {
			t.Fatalf("status = %d, want 301", resp.StatusCode)
		}
		if loc := resp.Header.Get("Location"); loc != "/apps/pretty/docs/" {
			t.Fatalf("Location = %q, want /apps/pretty/docs/", loc)
		}
	})

	t.Run("root-level view namespace is reserved", func(t *testing.T) {
		for _, path := range []string{"/apps/pretty/view", "/apps/pretty/view/", "/apps/pretty/view/photo.jpg"} {
			resp := doAlias(t, http.MethodGet, e.s.BaseURL+path, nil, nil)
			body := readAll(t, resp)
			if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(aliasShell)) {
				t.Fatalf("%s: status %d body %.80s, want the shell", path, resp.StatusCode, body)
			}
			if bytes.Contains(body, []byte("view bytes")) || bytes.Contains(body, []byte("view index")) {
				t.Fatalf("%s streamed a root-level view entry instead of the preview shell", path)
			}
		}
	})

	t.Run("nested view names are normal paths", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/docs/view/photo.jpg", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || string(body) != "nested view bytes" {
			t.Fatalf("nested view file: status %d body %q", resp.StatusCode, body)
		}
	})

	t.Run("private, unknown, released, and un-published names are 404 without a dial", func(t *testing.T) {
		before := e.f.TotalConns()
		cookie := e.s.LoginSessionCookie(t)
		for _, tc := range []struct {
			name   string
			url    string
			cookie *http.Cookie
		}{
			{"private root", "/apps/private-alias", cookie},
			{"private path", "/apps/private-alias/docs/a.txt", nil},
			{"unknown root", "/apps/never-registered", nil},
			{"unknown path", "/apps/never-registered/docs/", nil},
		} {
			resp := doAlias(t, http.MethodGet, e.s.BaseURL+tc.url, nil, tc.cookie)
			body := readAll(t, resp)
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("%s: status %d, want 404 (body %.100s)", tc.name, resp.StatusCode, body)
			}
			if bytes.Contains(body, []byte(aliasShell)) || bytes.Contains(body, []byte(aliasDocsText)) {
				t.Fatalf("%s leaked content", tc.name)
			}
		}
		if after := e.f.TotalConns(); after != before {
			t.Fatalf("denied aliases dialed SSH: conns %d -> %d", before, after)
		}

		// Un-publishing closes the live alias; re-publishing restores it.
		e.public.Set("is_public", false)
		if err := e.s.App.Save(e.public); err != nil {
			t.Fatalf("unpublish: %v", err)
		}
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/", nil, nil)
		_ = readAll(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("un-published alias: status %d, want 404", resp.StatusCode)
		}
		e.public.Set("is_public", true)
		if err := e.s.App.Save(e.public); err != nil {
			t.Fatalf("republish: %v", err)
		}
		resp = doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || string(body) != "<h1>root index</h1>\n" {
			t.Fatalf("republished alias: status %d body %.80s", resp.StatusCode, body)
		}
	})
}

func TestAliasDirectFiles(t *testing.T) {
	e := newAliasEnv(t)
	base := e.s.BaseURL + "/apps/pretty"

	t.Run("file content is byte-exact with content headers", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, base+"/docs/a.txt", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if string(body) != aliasDocsText {
			t.Fatalf("body = %q, want %q", body, aliasDocsText)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
			t.Fatalf("Content-Type = %q, want text/plain", ct)
		}
		if resp.Header.Get("Content-Length") != "44" {
			t.Fatalf("Content-Length = %q, want 44", resp.Header.Get("Content-Length"))
		}
		if resp.Header.Get("Accept-Ranges") != "bytes" {
			t.Fatalf("Accept-Ranges = %q", resp.Header.Get("Accept-Ranges"))
		}
		if resp.Header.Get("ETag") == "" || resp.Header.Get("Last-Modified") == "" {
			t.Fatal("missing validators")
		}
	})

	t.Run("single range returns exactly the slice", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, base+"/docs/ten.txt", map[string]string{"Range": "bytes=2-5"}, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusPartialContent {
			t.Fatalf("status = %d, want 206", resp.StatusCode)
		}
		if string(body) != "2345" {
			t.Fatalf("body = %q, want 2345", body)
		}
		if cr := resp.Header.Get("Content-Range"); cr != "bytes 2-5/10" {
			t.Fatalf("Content-Range = %q", cr)
		}
	})

	t.Run("unsatisfiable range is 416", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, base+"/docs/ten.txt", map[string]string{"Range": "bytes=10-"}, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
			t.Fatalf("status = %d, want 416", resp.StatusCode)
		}
		if cr := resp.Header.Get("Content-Range"); cr != "bytes */10" {
			t.Fatalf("Content-Range = %q", cr)
		}
		if len(body) != 0 {
			t.Fatalf("416 body = %q, want empty", body)
		}
	})

	t.Run("validators and HEAD work", func(t *testing.T) {
		full := doAlias(t, http.MethodGet, base+"/docs/a.txt", nil, nil)
		_ = readAll(t, full)
		etag := full.Header.Get("ETag")
		if etag == "" {
			t.Fatal("GET returned no ETag")
		}

		cond := doAlias(t, http.MethodGet, base+"/docs/a.txt", map[string]string{"If-None-Match": etag}, nil)
		body := readAll(t, cond)
		if cond.StatusCode != http.StatusNotModified || len(body) != 0 {
			t.Fatalf("conditional: status %d body %q, want 304 empty", cond.StatusCode, body)
		}

		head := doAlias(t, http.MethodHead, base+"/docs/a.txt", nil, nil)
		body = readAll(t, head)
		if head.StatusCode != http.StatusOK || len(body) != 0 {
			t.Fatalf("HEAD: status %d body %q", head.StatusCode, body)
		}
		if head.Header.Get("ETag") != etag {
			t.Fatalf("HEAD ETag = %q, want %q", head.Header.Get("ETag"), etag)
		}
		if head.Header.Get("Content-Length") != "44" {
			t.Fatalf("HEAD Content-Length = %q", head.Header.Get("Content-Length"))
		}
	})

	t.Run("missing files are 404", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, base+"/docs/missing.txt", nil, nil)
		_ = readAll(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", resp.StatusCode)
		}
	})

	t.Run("traversal and encoded dot segments are rejected", func(t *testing.T) {
		for _, path := range []string{
			base + "/%2e%2e/outside/secret.txt",
			base + "/docs/%2e%2e/%2e%2e/outside/secret.txt",
			base + "/docs/..%2f..%2foutside%2fsecret.txt",
		} {
			resp := doAlias(t, http.MethodGet, path, nil, nil)
			body := readAll(t, resp)
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("%s: status %d, want 404 (body %.80s)", path, resp.StatusCode, body)
			}
			if bytes.Contains(body, []byte("outside secret")) {
				t.Fatalf("%s leaked content outside the root", path)
			}
		}
	})

	t.Run("remote symlink escapes are rejected", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, base+"/docs/link-out/secret.txt", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", resp.StatusCode)
		}
		if bytes.Contains(body, []byte("outside secret")) {
			t.Fatal("symlink escape served outside content")
		}
	})
}

func TestAliasResolverAndLifecycle(t *testing.T) {
	e := newAliasEnv(t)

	t.Run("resolver returns only id and name without a session", func(t *testing.T) {
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/api/sf/public-urls/pretty", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d body %.100s", resp.StatusCode, body)
		}
		if len(resp.Cookies()) != 0 {
			t.Fatalf("resolver set cookies: %v", resp.Cookies())
		}
		var out map[string]any
		if err := json.Unmarshal(body, &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(out) != 2 {
			t.Fatalf("resolver returned extra fields: %v", out)
		}
		if out["vdir"] != e.public.Id || out["name"] != "Public" {
			t.Fatalf("resolver body = %v", out)
		}
	})

	t.Run("resolver hides private and unknown names", func(t *testing.T) {
		for _, name := range []string{"private-alias", "never-registered"} {
			resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/api/sf/public-urls/"+name, nil, nil)
			body := readAll(t, resp)
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("%s: status %d body %.100s", name, resp.StatusCode, body)
			}
			if bytes.Contains(body, []byte(e.public.Id)) || bytes.Contains(body, []byte("Public")) {
				t.Fatalf("%s leaked vdir data: %s", name, body)
			}
		}
	})

	t.Run("rename moves the URL on the next request", func(t *testing.T) {
		e.public.Set("public_slug", "renamed")
		if err := e.s.App.Save(e.public); err != nil {
			t.Fatalf("rename: %v", err)
		}
		old := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/", nil, nil)
		_ = readAll(t, old)
		if old.StatusCode != http.StatusNotFound {
			t.Fatalf("old name: status %d, want 404", old.StatusCode)
		}
		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/renamed/", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK || string(body) != "<h1>root index</h1>\n" {
			t.Fatalf("new name: status %d body %.80s", resp.StatusCode, body)
		}

		// Restore for the following release/reclaim case.
		e.public.Set("public_slug", "pretty")
		if err := e.s.App.Save(e.public); err != nil {
			t.Fatalf("restore name: %v", err)
		}
	})

	t.Run("release frees the name for another owner", func(t *testing.T) {
		e.public.Set("public_slug", "")
		if err := e.s.App.Save(e.public); err != nil {
			t.Fatalf("release: %v", err)
		}
		gone := doAlias(t, http.MethodGet, e.s.BaseURL+"/apps/pretty/", nil, nil)
		_ = readAll(t, gone)
		if gone.StatusCode != http.StatusNotFound {
			t.Fatalf("released name: status %d, want 404", gone.StatusCode)
		}

		users, err := e.s.App.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatalf("users collection: %v", err)
		}
		other := core.NewRecord(users)
		other.SetEmail("alias-other@stratofold.test")
		other.SetPassword("other-pass-123")
		if err := e.s.App.Save(other); err != nil {
			t.Fatalf("seed other user: %v", err)
		}
		connID := e.public.GetString("connection")
		vdirs, err := e.s.App.FindCollectionByNameOrId("vdirs")
		if err != nil {
			t.Fatalf("vdirs collection: %v", err)
		}
		theirs := core.NewRecord(vdirs)
		theirs.Set("owner", other.Id)
		theirs.Set("connection", connID)
		theirs.Set("name", "Other public")
		theirs.Set("root_path", e.f.Path("sandbox"))
		theirs.Set("is_public", true)
		theirs.Set("public_slug", "pretty")
		if err := e.s.App.Save(theirs); err != nil {
			t.Fatalf("reclaim name: %v", err)
		}

		resp := doAlias(t, http.MethodGet, e.s.BaseURL+"/api/sf/public-urls/pretty", nil, nil)
		body := readAll(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("reclaimed resolver: status %d body %.100s", resp.StatusCode, body)
		}
		var out map[string]any
		if err := json.Unmarshal(body, &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out["vdir"] != theirs.Id {
			t.Fatalf("reclaimed name resolves to %v, want %s", out["vdir"], theirs.Id)
		}

		// Deleting the new owner's vdir frees the name again.
		if err := e.s.App.Delete(theirs); err != nil {
			t.Fatalf("delete reclaiming vdir: %v", err)
		}
		resp = doAlias(t, http.MethodGet, e.s.BaseURL+"/api/sf/public-urls/pretty", nil, nil)
		_ = readAll(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("deleted owner's name: status %d, want 404", resp.StatusCode)
		}
	})
}
