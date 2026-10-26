package filelinks_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
)

const docsATxt = "the quick brown fox jumps over the lazy dog\n"

type env struct {
	s      *testapp.Server
	f      *testssh.Fixture
	privID string
	pubID  string

	owner    *http.Cookie
	other    *http.Cookie
	viewer   *http.Cookie
	editor   *http.Cookie
	viewerID string
	editorID string

	reconnect []byte
}

func setup(t *testing.T) *env {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	s := testapp.Start(t)
	_, ownerRec := s.LoginBody(t)
	ownerCookie := s.LoginSessionCookie(t)

	connCol, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", ownerRec["id"])
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
		t.Fatalf("vdirs: %v", err)
	}
	mkVdir := func(name string, pub bool) *core.Record {
		vd := core.NewRecord(vdirCol)
		vd.Set("owner", ownerRec["id"])
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

	usersCol, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users: %v", err)
	}
	mkUser := func(email string) *core.Record {
		rec := core.NewRecord(usersCol)
		rec.SetEmail(email)
		rec.SetPassword("extra-pass-123")
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("seed user %s: %v", email, err)
		}
		return rec
	}
	other := mkUser("links-other@stratofold.test")
	viewer := mkUser("links-viewer@stratofold.test")
	editor := mkUser("links-editor@stratofold.test")

	// Seed the dataset.
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()
	for _, dir := range []string{"docs", "docs/sub", "big"} {
		if err := scl.MkdirAll(f.Path("sandbox/" + dir)); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := scl.MkdirAll(f.Path("outside")); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	writeRemote(t, scl, f.Path("sandbox/docs/a.txt"), docsATxt)
	writeRemote(t, scl, f.Path("sandbox/docs/b.txt"), "second file\n")
	writeRemote(t, scl, f.Path("sandbox/docs/index.html"), "<h1>docs</h1>\n")
	writeRemote(t, scl, f.Path("sandbox/index.html"), "<h1>root</h1>\n")
	writeRemoteBytes(t, scl, f.Path("sandbox/big/range.bin"), testssh.RandomBytes(7, 1<<20))
	reconnect := testssh.RandomBytes(8, 8<<20)
	writeRemoteBytes(t, scl, f.Path("sandbox/big/reconnect.bin"), reconnect)
	writeRemote(t, scl, f.Path("outside/secret.txt"), "outside\n")

	return &env{
		s: s, f: f, privID: priv.Id, pubID: pub.Id,
		owner:    ownerCookie,
		other:    cookieFor(t, s, other.Id),
		viewer:   cookieFor(t, s, viewer.Id),
		editor:   cookieFor(t, s, editor.Id),
		viewerID: viewer.Id, editorID: editor.Id,
		reconnect: reconnect,
	}
}

func cookieFor(t *testing.T, s *testapp.Server, userID string) *http.Cookie {
	t.Helper()
	rec, err := s.App.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	tok, err := rec.NewAuthToken()
	if err != nil {
		t.Fatalf("user token: %v", err)
	}
	return &http.Cookie{Name: "sf_session", Value: tok}
}

func (e *env) grant(t *testing.T, vdirID, userID, role string) string {
	t.Helper()
	shares, err := e.s.App.FindCollectionByNameOrId("vdir_shares")
	if err != nil {
		t.Fatalf("shares: %v", err)
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

func (e *env) mint(t *testing.T, vdirID, path string, c *http.Cookie) (int, map[string]any) {
	t.Helper()
	raw := fmt.Sprintf(`{"path":%q}`, path)
	req, err := http.NewRequest(http.MethodPost, e.s.BaseURL+"/api/sf/vdirs/"+vdirID+"/links", strings.NewReader(raw))
	if err != nil {
		t.Fatalf("mint request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c != nil {
		req.AddCookie(c)
	}
	resp := e.s.Do(t, req)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(body, &out)
	return resp.StatusCode, out
}

func mintURL(t *testing.T, e *env, vdirID, path string, c *http.Cookie) string {
	t.Helper()
	st, out := e.mint(t, vdirID, path, c)
	if st != http.StatusCreated {
		t.Fatalf("mint %s: status %d body %v", path, st, out)
	}
	url, _ := out["url"].(string)
	if !strings.HasPrefix(url, "/s/") {
		t.Fatalf("mint url = %q, want /s/<token>", url)
	}
	return e.s.BaseURL + url
}

func (e *env) get(t *testing.T, url string, c *http.Cookie, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if c != nil {
		req.AddCookie(c)
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

func client() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func mustStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != want {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d, want %d (body %.200s)", resp.StatusCode, want, b)
	}
}

func body(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

func writeRemote(t *testing.T, scl *sftp.Client, path, content string) {
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

// TestMintMatrix covers the access and shape contract of the mint route.
func TestMintMatrix(t *testing.T) {
	e := setup(t)

	st, out := e.mint(t, e.privID, "docs/a.txt", e.owner)
	if st != http.StatusCreated {
		t.Fatalf("owner mint: status %d body %v", st, out)
	}
	if url, _ := out["url"].(string); !strings.HasPrefix(url, "/s/") {
		t.Fatalf("mint url = %q", url)
	}
	if _, err := time.Parse(time.RFC3339, out["expires_at"].(string)); err != nil {
		t.Fatalf("expires_at %q is not RFC3339: %v", out["expires_at"], err)
	}
	exp, _ := time.Parse(time.RFC3339, out["expires_at"].(string))
	if d := time.Until(exp); d < 23*time.Hour+59*time.Minute || d > 24*time.Hour+time.Minute {
		t.Fatalf("expiry is %v away, want ~24h", d)
	}

	e.grant(t, e.privID, e.viewerID, "viewer")
	if st, _ := e.mint(t, e.privID, "docs/a.txt", e.viewer); st != http.StatusCreated {
		t.Fatalf("viewer mint: status %d", st)
	}
	e.grant(t, e.privID, e.editorID, "editor")
	if st, _ := e.mint(t, e.privID, "docs/a.txt", e.editor); st != http.StatusCreated {
		t.Fatalf("editor mint: status %d", st)
	}
	// A signed-in reader on a public vdir can mint too.
	if st, _ := e.mint(t, e.pubID, "docs/a.txt", e.owner); st != http.StatusCreated {
		t.Fatalf("public-vdir mint: status %d", st)
	}

	before := e.f.TotalConns()
	if st, _ := e.mint(t, e.privID, "docs/a.txt", nil); st != http.StatusUnauthorized {
		t.Fatalf("anonymous mint: status %d, want 401", st)
	}
	if st, _ := e.mint(t, e.privID, "docs/a.txt", &http.Cookie{Name: "sf_session", Value: "forged"}); st != http.StatusUnauthorized {
		t.Fatalf("forged-session mint: status %d, want 401", st)
	}
	if st, _ := e.mint(t, e.privID, "docs/a.txt", e.other); st != http.StatusForbidden {
		t.Fatalf("non-reader mint: status %d, want 403", st)
	}
	if st, _ := e.mint(t, e.privID, "", e.owner); st != http.StatusBadRequest {
		t.Fatalf("empty-path mint: status %d, want 400", st)
	}
	if st, _ := e.mint(t, "000000000000000", "docs/a.txt", e.owner); st != http.StatusNotFound {
		t.Fatalf("unknown-vdir mint: status %d, want 404", st)
	}
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("rejected mints dialed SSH: %d -> %d", before, after)
	}
}

// TestMintTokensAreSecretAndUnique covers the token-at-rest and
// once-only response guarantees.
func TestMintTokensAreSecretAndUnique(t *testing.T) {
	e := setup(t)

	url1 := mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	url2 := mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	if url1 == url2 {
		t.Fatal("two mints returned the same URL")
	}
	token1 := strings.TrimPrefix(strings.TrimPrefix(url1, e.s.BaseURL), "/s/")
	token2 := strings.TrimPrefix(strings.TrimPrefix(url2, e.s.BaseURL), "/s/")
	if token1 == token2 {
		t.Fatal("two mints returned the same token")
	}

	sum := sha256.Sum256([]byte(token1))
	wantHash := hex.EncodeToString(sum[:])
	rows, err := e.s.App.FindAllRecords("file_links")
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	found := false
	for _, row := range rows {
		hash := row.GetString("token_hash")
		if hash == token1 || hash == token2 {
			t.Fatal("plaintext token stored at rest")
		}
		if hash == wantHash {
			found = true
			if row.GetString("path") != "docs/a.txt" {
				t.Fatalf("stored path = %q", row.GetString("path"))
			}
			if row.GetString("created_by") == "" {
				t.Fatal("stored link has no creator")
			}
		}
	}
	if !found {
		t.Fatal("minted token hash not found at rest")
	}
}

// TestLinkResponseSemantics covers GET/HEAD/OPTIONS, representation
// headers, Range, conditionals, and the 404 failure shape.
func TestLinkResponseSemantics(t *testing.T) {
	e := setup(t)
	url := mintURL(t, e, e.privID, "docs/a.txt", e.owner)

	resp := e.get(t, url, nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET link: status %d", resp.StatusCode)
	}
	if got := string(body(t, resp)); got != docsATxt {
		t.Fatalf("body = %q", got)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("CORS origin = %q, want *", got)
	}
	if got := resp.Header.Get("Content-Type"); got != "text/plain" {
		t.Fatalf("Content-Type = %q, want text/plain", got)
	}
	if got := resp.Header.Get("Content-Disposition"); !strings.Contains(got, "a.txt") {
		t.Fatalf("Content-Disposition = %q, want the file name", got)
	}
	etag := resp.Header.Get("ETag")

	// HEAD: headers, no body.
	req, _ := http.NewRequest(http.MethodHead, url, nil)
	headResp, err := client().Do(req)
	if err != nil {
		t.Fatalf("HEAD: %v", err)
	}
	defer headResp.Body.Close()
	if headResp.StatusCode != http.StatusOK {
		t.Fatalf("HEAD status %d", headResp.StatusCode)
	}
	if headResp.Header.Get("Content-Length") != strconv.Itoa(len(docsATxt)) {
		t.Fatalf("HEAD Content-Length = %q", headResp.Header.Get("Content-Length"))
	}
	if b, _ := io.ReadAll(headResp.Body); len(b) != 0 {
		t.Fatalf("HEAD returned %d body bytes", len(b))
	}

	// OPTIONS preflight (PocketBase's global CORS middleware answers
	// real preflights, echoing the requested headers).
	optReq, _ := http.NewRequest(http.MethodOptions, url, nil)
	optReq.Header.Set("Origin", "https://receiver.example")
	optReq.Header.Set("Access-Control-Request-Method", "GET")
	optReq.Header.Set("Access-Control-Request-Headers", "range,if-none-match")
	optResp, err := client().Do(optReq)
	if err != nil {
		t.Fatalf("OPTIONS: %v", err)
	}
	defer optResp.Body.Close()
	if optResp.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS status %d", optResp.StatusCode)
	}
	if !strings.Contains(strings.ToLower(optResp.Header.Get("Access-Control-Allow-Headers")), "range") {
		t.Fatalf("OPTIONS allow-headers = %q", optResp.Header.Get("Access-Control-Allow-Headers"))
	}
	if !strings.Contains(optResp.Header.Get("Access-Control-Allow-Methods"), "GET") {
		t.Fatalf("OPTIONS allow-methods = %q", optResp.Header.Get("Access-Control-Allow-Methods"))
	}

	// Single bounded range.
	rangeResp := e.get(t, url, nil, map[string]string{"Range": "bytes=2-5"})
	if rangeResp.StatusCode != http.StatusPartialContent {
		t.Fatalf("range status %d", rangeResp.StatusCode)
	}
	if got := rangeResp.Header.Get("Content-Range"); got != fmt.Sprintf("bytes 2-5/%d", len(docsATxt)) {
		t.Fatalf("Content-Range = %q", got)
	}
	if got := string(body(t, rangeResp)); got != docsATxt[2:6] {
		t.Fatalf("range body = %q", got)
	}

	// Unsatisfiable range.
	mustStatus(t, e.get(t, url, nil, map[string]string{"Range": "bytes=999999-"}), http.StatusRequestedRangeNotSatisfiable)

	// Conditional request.
	mustStatus(t, e.get(t, url, nil, map[string]string{"If-None-Match": etag}), http.StatusNotModified)

	// Every invalid token is a plain 404.
	mustStatus(t, e.get(t, e.s.BaseURL+"/s/forged-token", nil, nil), http.StatusNotFound)
	mustStatus(t, e.get(t, e.s.BaseURL+"/s/nope", nil, nil), http.StatusNotFound)
}

// TestLinkRevocation covers expiry, deletion, moved targets, directory
// targets, and creator-access loss.
func TestLinkRevocation(t *testing.T) {
	e := setup(t)

	// Expired.
	url := mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	token := strings.TrimPrefix(strings.TrimPrefix(url, e.s.BaseURL), "/s/")
	row := findLink(t, e, token)
	past, _ := types.ParseDateTime(time.Now().Add(-time.Hour))
	row.Set("expires_at", past)
	if err := e.s.App.Save(row); err != nil {
		t.Fatalf("expire: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)

	// Deleted row.
	url = mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	token = strings.TrimPrefix(strings.TrimPrefix(url, e.s.BaseURL), "/s/")
	if err := e.s.App.Delete(findLink(t, e, token)); err != nil {
		t.Fatalf("delete link: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)

	// Moved target.
	url = mintURL(t, e, e.privID, "docs/b.txt", e.owner)
	cl, _ := e.f.SSHClient()
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp: %v", err)
	}
	if err := scl.Rename(e.f.Path("sandbox/docs/b.txt"), e.f.Path("sandbox/docs/b-moved.txt")); err != nil {
		t.Fatalf("rename: %v", err)
	}
	_ = scl.Close()
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)

	// Directory target.
	dirURL := mintURL(t, e, e.privID, "docs", e.owner)
	mustStatus(t, e.get(t, dirURL, nil, nil), http.StatusNotFound)

	// Creator share removal.
	e.grant(t, e.privID, e.viewerID, "viewer")
	viewerURL := mintURL(t, e, e.privID, "docs/a.txt", e.viewer)
	shareID := ""
	shares, _ := e.s.App.FindAllRecords("vdir_shares")
	for _, sh := range shares {
		if sh.GetString("vdir") == e.privID && sh.GetString("user") == e.viewerID {
			shareID = sh.Id
		}
	}
	if shareID == "" {
		t.Fatal("viewer share not found")
	}
	if err := e.s.App.Delete(mustRecord(t, e, "vdir_shares", shareID)); err != nil {
		t.Fatalf("delete share: %v", err)
	}
	mustStatus(t, e.get(t, viewerURL, nil, nil), http.StatusNotFound)

	// Deleted creator.
	users, _ := e.s.App.FindCollectionByNameOrId("users")
	deletedUser := core.NewRecord(users)
	deletedUser.SetEmail("links-deleted@stratofold.test")
	deletedUser.SetPassword("extra-pass-123")
	if err := e.s.App.Save(deletedUser); err != nil {
		t.Fatalf("seed deleted user: %v", err)
	}
	e.grant(t, e.privID, deletedUser.Id, "viewer")
	deletedURL := mintURL(t, e, e.privID, "docs/a.txt", cookieFor(t, e.s, deletedUser.Id))
	if err := e.s.App.Delete(deletedUser); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	mustStatus(t, e.get(t, deletedURL, nil, nil), http.StatusNotFound)

	// Deleted vdir.
	url = mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	vdir := mustRecord(t, e, "vdirs", e.privID)
	if err := e.s.App.Delete(vdir); err != nil {
		t.Fatalf("delete vdir: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)

	// Owner link survives un-publishing.
	pubURL := mintURL(t, e, e.pubID, "docs/a.txt", e.owner)
	pub := mustRecord(t, e, "vdirs", e.pubID)
	pub.Set("is_public", false)
	if err := e.s.App.Save(pub); err != nil {
		t.Fatalf("unpublish: %v", err)
	}
	mustStatus(t, e.get(t, pubURL, nil, nil), http.StatusOK)
}

func mustRecord(t *testing.T, e *env, collection, id string) *core.Record {
	t.Helper()
	rec, err := e.s.App.FindRecordById(collection, id)
	if err != nil {
		t.Fatalf("find %s/%s: %v", collection, id, err)
	}
	return rec
}

func findLink(t *testing.T, e *env, token string) *core.Record {
	t.Helper()
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	rows, err := e.s.App.FindAllRecords("file_links")
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	for _, row := range rows {
		if row.GetString("token_hash") == hash {
			return row
		}
	}
	t.Fatalf("link for token not found")
	return nil
}

// TestLinkRangeRetryAfterAbort is the client-side half of the
// reconnect contract at the link URL.
func TestLinkRangeRetryAfterAbort(t *testing.T) {
	e := setup(t)
	url := mintURL(t, e, e.privID, "big/reconnect.bin", e.owner)

	const n = 1000
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("Range", "bytes=0-")
	resp, err := client().Do(req)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	head := make([]byte, n)
	if _, err := io.ReadFull(resp.Body, head); err != nil {
		t.Fatalf("read head: %v", err)
	}
	cancel()
	_ = resp.Body.Close()

	retry := e.get(t, url, nil, map[string]string{"Range": "bytes=" + strconv.Itoa(n) + "-"})
	if retry.StatusCode != http.StatusPartialContent {
		t.Fatalf("retry status %d", retry.StatusCode)
	}
	if got := retry.Header.Get("Content-Range"); !strings.HasPrefix(got, "bytes "+strconv.Itoa(n)+"-") {
		t.Fatalf("retry Content-Range = %q", got)
	}
	rest := body(t, retry)
	if len(rest) != (8<<20)-n {
		t.Fatalf("retry body = %d bytes, want %d", len(rest), (8<<20)-n)
	}
	if !bytes.Equal(head, e.reconnect[:n]) {
		t.Fatalf("head bytes mismatch")
	}
	if len(rest) != len(e.reconnect)-n {
		t.Fatalf("retry body = %d bytes, want %d", len(rest), len(e.reconnect)-n)
	}
}

// TestLinkSurvivesServerDrops streams a link response while the fixture
// drops the server-side SSH connections twice; the in-flight response
// resumes and completes byte-exact.
func TestLinkSurvivesServerDrops(t *testing.T) {
	e := setup(t)
	url := mintURL(t, e, e.privID, "big/reconnect.bin", e.owner)

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

	for i := 0; i < 2; i++ {
		time.Sleep(150 * time.Millisecond)
		e.f.DropAllConnections()
	}

	select {
	case r := <-resCh:
		if r.err != nil {
			t.Fatalf("streaming GET: %v", r.err)
		}
		if r.resp.StatusCode != http.StatusPartialContent {
			t.Fatalf("status %d", r.resp.StatusCode)
		}
		if !bytes.Equal(r.body, e.reconnect) {
			t.Fatalf("body corrupted across drops")
		}
	case <-time.After(30 * time.Second):
		t.Fatal("response did not complete")
	}
}
