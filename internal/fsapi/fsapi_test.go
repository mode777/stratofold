package fsapi_test

// Integration tests for the filesystem API against the in-proc SSH
// fixture through the production wiring (testapp boots
// appserver.Install). The disconnect tests use the fixture's
// per-connection byte-threshold kills: deterministic drops that land
// mid-operation regardless of timing; the asserted invariant is
// always the convergent, exactly-once final state.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/appserver"
	"github.com/mode777/stratofold/internal/fsapi"
	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
	"github.com/mode777/stratofold/internal/vdir"
)

const docsATxt = "the quick brown fox jumps over the lazy dog\n"

type env struct {
	s          *testapp.Server
	f          *testssh.Fixture
	privID     string // non-public vdir over <root>/sandbox
	pubID      string // public vdir over the same root
	otherToken string // a valid token belonging to a non-owner user without a share
	viewerID   string // user holding a viewer share on privID (when granted)
	editorID   string // user holding an editor share on privID (when granted)
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
	for _, dir := range []string{"docs/sub", "mut", "up"} {
		if err := scl.MkdirAll(f.Path("sandbox/" + dir)); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := scl.MkdirAll(f.Path("outside")); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	writeRemote(t, scl, f.Path("sandbox/hello.txt"), "hello stratofold\n")
	writeRemote(t, scl, f.Path("sandbox/plain.txt"), "plain file\n")
	writeRemoteBytes(t, scl, f.Path("sandbox/blob.xyz"), testssh.RandomBytes(11, 128))
	writeRemote(t, scl, f.Path("sandbox/docs/a.txt"), docsATxt)
	writeRemote(t, scl, f.Path("sandbox/docs/sub/deep.txt"), "deep\n")
	writeRemote(t, scl, f.Path("sandbox/mut/seed.txt"), "seed\n")
	writeRemote(t, scl, f.Path("outside/secret.txt"), "outside\n")
	if err := scl.Symlink("a.txt", f.Path("sandbox/docs/link-in")); err != nil {
		t.Fatalf("symlink in: %v", err)
	}
	if err := scl.Symlink(f.Path("outside"), f.Path("sandbox/docs/link-out")); err != nil {
		t.Fatalf("symlink out: %v", err)
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

// ---- HTTP helpers ----

func opJSON(t *testing.T, e *env, vdirID, op string, reqBody any, cookie *http.Cookie) *http.Response {
	t.Helper()
	raw, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/api/sf/vdirs/%s/%s", e.s.BaseURL, vdirID, op),
		bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", op, err)
	}
	return resp
}

func uploadBytes(t *testing.T, e *env, vdirID, vpath string, content []byte, cookie *http.Cookie) *http.Response {
	t.Helper()
	return uploadBytesWithContext(t, e, vdirID, vpath, content, cookie, context.Background())
}

func uploadBytesWithContext(t *testing.T, e *env, vdirID, vpath string, content []byte, cookie *http.Cookie, ctx context.Context) *http.Response {
	t.Helper()
	u := fmt.Sprintf("%s/api/sf/vdirs/%s/upload?%s", e.s.BaseURL, vdirID, url.Values{"path": {vpath}}.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(content))
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	req.ContentLength = int64(len(content))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload %s: %v", vpath, err)
	}
	return resp
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
		t.Fatalf("status = %d, want %d (body %.160q)", resp.StatusCode, want, b)
	}
}

type lsEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Dir     bool   `json:"dir"`
	ModTime string `json:"modtime"`
}

func lsEntries(t *testing.T, resp *http.Response) []lsEntry {
	t.Helper()
	var out struct {
		Entries []lsEntry `json:"entries"`
	}
	if err := json.NewDecoder(bytes.NewReader(body(t, resp))).Decode(&out); err != nil {
		t.Fatalf("decode ls body: %v", err)
	}
	return out.Entries
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func ownerC(t *testing.T, e *env) *http.Cookie {
	t.Helper()
	return e.s.LoginSessionCookie(t)
}

func otherC(t *testing.T, e *env) *http.Cookie {
	t.Helper()
	return &http.Cookie{Name: "sf_session", Value: e.otherToken}
}

// ---- remote state helpers (independent of the code under test) ----

func fixtureSFTP(t *testing.T, e *env) *sftp.Client {
	t.Helper()
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	return scl
}

func remoteLstat(t *testing.T, e *env, rel string) (os.FileInfo, error) {
	t.Helper()
	scl := fixtureSFTP(t, e)
	defer scl.Close()
	return scl.Lstat(e.f.Path(rel))
}

func remoteRead(t *testing.T, e *env, rel string) []byte {
	t.Helper()
	scl := fixtureSFTP(t, e)
	defer scl.Close()
	rf, err := scl.Open(e.f.Path(rel))
	if err != nil {
		t.Fatalf("open %s: %v", rel, err)
	}
	defer rf.Close()
	b, err := io.ReadAll(rf)
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return b
}

func remoteNames(t *testing.T, e *env, rel string) []string {
	t.Helper()
	scl := fixtureSFTP(t, e)
	defer scl.Close()
	list, err := scl.ReadDir(e.f.Path(rel))
	if err != nil {
		t.Fatalf("readdir %s: %v", rel, err)
	}
	var names []string
	for _, fi := range list {
		names = append(names, fi.Name())
	}
	return names
}

func sha(b []byte) string { return hex.EncodeToString(sha256sum(b)) }

func sha256sum(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

// ---- listings (task 2.1) ----

func TestLsListsRemoteEntries(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	resp := opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, c)
	mustStatus(t, resp, http.StatusOK)
	entries := lsEntries(t, resp)
	byName := map[string]lsEntry{}
	for _, en := range entries {
		byName[en.Name] = en
	}
	hello, ok := byName["hello.txt"]
	if !ok {
		t.Fatalf("root listing missing hello.txt: %v", entries)
	}
	if hello.Dir {
		t.Error("hello.txt flagged as directory")
	}
	if hello.Size != int64(len("hello stratofold\n")) {
		t.Errorf("hello.txt size = %d, want %d", hello.Size, len("hello stratofold\n"))
	}
	if _, err := time.Parse(time.RFC3339, hello.ModTime); err != nil {
		t.Errorf("hello.txt modtime %q: %v", hello.ModTime, err)
	}
	if docs, ok := byName["docs"]; !ok || !docs.Dir {
		t.Errorf("docs entry = %+v, want a directory", docs)
	}
	for _, want := range []string{"plain.txt", "mut", "up", "blob.xyz"} {
		if _, ok := byName[want]; !ok {
			t.Errorf("root listing missing %s", want)
		}
	}

	// The docs listing carries real sizes and symlink entries as-is.
	resp = opJSON(t, e, e.privID, "ls", map[string]string{"path": "docs"}, c)
	mustStatus(t, resp, http.StatusOK)
	byName = map[string]lsEntry{}
	for _, en := range lsEntries(t, resp) {
		byName[en.Name] = en
	}
	a, ok := byName["a.txt"]
	if !ok || a.Dir || a.Size != int64(len(docsATxt)) {
		t.Errorf("docs/a.txt entry = %+v", a)
	}
	if sub, ok := byName["sub"]; !ok || !sub.Dir {
		t.Errorf("docs/sub entry = %+v, want a directory", sub)
	}
	for _, want := range []string{"link-in", "link-out"} {
		if _, ok := byName[want]; !ok {
			t.Errorf("docs listing missing symlink entry %s", want)
		}
	}

	// Nested virtual path.
	resp = opJSON(t, e, e.privID, "ls", map[string]string{"path": "docs/sub"}, c)
	mustStatus(t, resp, http.StatusOK)
	entries = lsEntries(t, resp)
	if len(entries) != 1 || entries[0].Name != "deep.txt" {
		t.Fatalf("docs/sub listing = %v, want exactly deep.txt", entries)
	}

	// An empty body lists the root.
	resp = opJSON(t, e, e.privID, "ls", map[string]string{}, c)
	mustStatus(t, resp, http.StatusOK)
	if len(lsEntries(t, resp)) == 0 {
		t.Fatal("empty-body ls returned no entries")
	}
}

func TestLsRejections(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	rows := []struct {
		name string
		path string
	}{
		{"parent traversal", "../outside/secret.txt"},
		{"absolute form", "/etc/passwd"},
		{"null byte", "do\x00cs"},
		{"symlink escaping the root", "docs/link-out"},
		{"missing directory", "nope"},
		{"regular file is not a directory", "hello.txt"},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			resp := opJSON(t, e, e.privID, "ls", map[string]string{"path": row.path}, c)
			if resp.StatusCode != http.StatusNotFound {
				b := body(t, resp)
				t.Fatalf("ls %q: status = %d, want 404 (body %.120q)", row.path, resp.StatusCode, b)
			}
		})
	}

	t.Run("unknown vdir", func(t *testing.T) {
		resp := opJSON(t, e, "000000000000000", "ls", map[string]string{"path": ""}, c)
		mustStatus(t, resp, http.StatusNotFound)
	})
}

// ---- mutations (tasks 3.1–3.3) ----

func TestMkdirCreatesParentsAndToleratesExisting(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "mk/a/b/c"}, c), http.StatusNoContent)
	if fi, err := remoteLstat(t, e, "sandbox/mk/a/b/c"); err != nil || !fi.IsDir() {
		t.Fatalf("mk/a/b/c after mkdir: fi=%v err=%v", fi, err)
	}
	entries := func() []string {
		resp := opJSON(t, e, e.privID, "ls", map[string]string{"path": "mk/a/b"}, c)
		mustStatus(t, resp, http.StatusOK)
		var names []string
		for _, en := range lsEntries(t, resp) {
			names = append(names, en.Name)
		}
		return names
	}
	if names := entries(); len(names) != 1 || names[0] != "c" {
		t.Fatalf("ls mk/a/b = %v, want exactly c", names)
	}

	// Idempotent: mkdir of the existing leaf and of an existing
	// pre-seeded directory both succeed without altering anything.
	mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "mk/a/b/c"}, c), http.StatusNoContent)
	mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "mut"}, c), http.StatusNoContent)
	if got := string(remoteRead(t, e, "sandbox/mut/seed.txt")); got != "seed\n" {
		t.Fatalf("mut/seed.txt altered by mkdir: %q", got)
	}

	// A regular file in the way never succeeds.
	writeRemote(t, fixtureSFTP(t, e), e.f.Path("sandbox/mk/file.txt"), "blocker\n")
	resp := opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "mk/file.txt/under"}, c)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("mkdir under a file: status = %d, want 404", resp.StatusCode)
	}
}

func TestMvMovesReplacesAndRejects(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	// Move: content byte-exact at the target, source gone.
	mustStatus(t, opJSON(t, e, e.privID, "mv", map[string]string{"path": "docs/a.txt", "to": "mut/renamed.txt"}, c), http.StatusNoContent)
	if got, want := string(remoteRead(t, e, "sandbox/mut/renamed.txt")), docsATxt; got != want {
		t.Fatalf("moved content = %q, want %q", got, want)
	}
	if _, err := remoteLstat(t, e, "sandbox/docs/a.txt"); err == nil {
		t.Fatal("source still exists after mv")
	}

	// Replace: an existing file target is fully replaced.
	plain := testssh.RandomBytes(5, 256)
	writeRemoteBytes(t, fixtureSFTP(t, e), e.f.Path("sandbox/plain2.bin"), plain)
	mustStatus(t, opJSON(t, e, e.privID, "mv", map[string]string{"path": "plain2.bin", "to": "mut/renamed.txt"}, c), http.StatusNoContent)
	if got := remoteRead(t, e, "sandbox/mut/renamed.txt"); !bytes.Equal(got, plain) {
		t.Fatalf("replaced content mismatch: %x vs %x", sha(got), sha(plain))
	}
	if _, err := remoteLstat(t, e, "sandbox/plain2.bin"); err == nil {
		t.Fatal("replace source still exists")
	}

	rows := []struct {
		name   string
		path   string
		to     string
		status int
	}{
		{"missing source", "nope.bin", "mut/x", http.StatusNotFound},
		{"missing target parent", "hello.txt", "nodir/x.txt", http.StatusNotFound},
		{"onto itself", "hello.txt", "hello.txt", http.StatusBadRequest},
		{"escape source", "../outside/secret.txt", "mut/x", http.StatusNotFound},
		{"absolute target", "hello.txt", "/tmp/x", http.StatusNotFound},
		{"missing fields", "", "", http.StatusBadRequest},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			resp := opJSON(t, e, e.privID, "mv", map[string]string{"path": row.path, "to": row.to}, c)
			if resp.StatusCode != row.status {
				b := body(t, resp)
				t.Fatalf("mv %q->%q: status = %d, want %d (body %.120q)", row.path, row.to, resp.StatusCode, row.status, b)
			}
		})
	}
}

func TestRmRecursiveAndRetrySafe(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	// A tree with nested files and an inside-the-tree symlink pointing
	// outside: the link is deleted as a link, its target untouched.
	scl := fixtureSFTP(t, e)
	defer scl.Close()
	for _, d := range []string{"tree", "tree/d1", "tree/d1/d2"} {
		if err := scl.MkdirAll(fpath(e, d)); err != nil {
			t.Fatal(err)
		}
	}
	writeRemote(t, scl, fpath(e, "tree/f1.txt"), "one\n")
	writeRemote(t, scl, fpath(e, "tree/d1/f2.txt"), "two\n")
	writeRemote(t, scl, fpath(e, "tree/d1/d2/f3.txt"), "three\n")
	if err := scl.Symlink(e.f.Path("outside/secret.txt"), fpath(e, "tree/link")); err != nil {
		t.Fatal(err)
	}

	// TEMP debug probes
	if fi, err := remoteLstat(t, e, "sandbox/tree"); err != nil {
		t.Logf("PROBE direct lstat tree: err=%v", err)
	} else {
		t.Logf("PROBE direct lstat tree: ok isdir=%v", fi.IsDir())
	}
	if res, err := vdir.NewResolver(e.s.App).Resolve(t.Context(), e.privID, "tree"); err != nil {
		t.Logf("PROBE resolver: err=%v", err)
	} else {
		t.Logf("PROBE resolver: %s", res.RemotePath)
	}

	mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "tree"}, c), http.StatusNoContent)
	if _, err := remoteLstat(t, e, "sandbox/tree"); err == nil {
		t.Fatal("tree still exists after rm")
	}
	if got := string(remoteRead(t, e, "outside/secret.txt")); got != "outside\n" {
		t.Fatalf("symlink target clobbered: %q", got)
	}

	// Retrying a completed rm succeeds (already deleted = success).
	mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "tree"}, c), http.StatusNoContent)

	// A single file and a pre-seeded directory also delete cleanly.
	mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "plain.txt"}, c), http.StatusNoContent)
	if _, err := remoteLstat(t, e, "sandbox/plain.txt"); err == nil {
		t.Fatal("plain.txt still exists")
	}
	mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "mut"}, c), http.StatusNoContent)
	if _, err := remoteLstat(t, e, "sandbox/mut"); err == nil {
		t.Fatal("mut still exists")
	}

	// Deleting a path that does not exist is idempotent success.
	resp := opJSON(t, e, e.privID, "rm", map[string]string{"path": "nope"}, c)
	mustStatus(t, resp, http.StatusNoContent)
	resp = opJSON(t, e, e.privID, "rm", map[string]string{"path": ""}, c)
	mustStatus(t, resp, http.StatusBadRequest)
}

func fpath(e *env, rel string) string { return e.f.Path("sandbox/" + rel) }

// ---- uploads (tasks 4.1–4.3) ----

func TestUploadByteExactAndReplaces(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	first := testssh.RandomBytes(1, 256<<10)
	resp := uploadBytes(t, e, e.privID, "up/first.bin", first, c)
	mustStatus(t, resp, http.StatusOK)
	var out struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	if err := json.NewDecoder(bytes.NewReader(body(t, resp))).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Path != "up/first.bin" || out.Size != int64(len(first)) {
		t.Fatalf("upload response = %+v, want path up/first.bin size %d", out, len(first))
	}
	if got := remoteRead(t, e, "sandbox/up/first.bin"); !bytes.Equal(got, first) {
		t.Fatalf("uploaded content mismatch: %s vs %s", sha(got), sha(first))
	}

	// Replace: the new body fully replaces the previous content.
	second := testssh.RandomBytes(2, 128<<10)
	resp = uploadBytes(t, e, e.privID, "up/first.bin", second, c)
	mustStatus(t, resp, http.StatusOK)
	if got := remoteRead(t, e, "sandbox/up/first.bin"); !bytes.Equal(got, second) {
		t.Fatal("replaced content mismatch")
	}

	// No temp partials left behind.
	for _, n := range remoteNames(t, e, "sandbox/up") {
		if strings.Contains(n, ".sfpart-") {
			t.Fatalf("temp partial left behind: %s", n)
		}
	}
}

func TestUploadMissingParentAndBadShape(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	resp := uploadBytes(t, e, e.privID, "no/such/dir/f.bin", []byte("x"), c)
	mustStatus(t, resp, http.StatusNotFound)
	if _, err := remoteLstat(t, e, "sandbox/no"); err == nil {
		t.Fatal("upload into missing parent wrote something")
	}

	// No path query parameter.
	req, err := http.NewRequest(http.MethodPost, e.s.BaseURL+"/api/sf/vdirs/"+e.privID+"/upload", bytes.NewReader([]byte("x")))
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(c)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	mustStatus(t, resp2, http.StatusBadRequest)
}

func TestUploadAbandonOnPublishConflict(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	// The target exists and is a directory: the publish step can never
	// succeed; the upload must fail loudly with nothing at the target
	// path and no temp partial left behind.
	resp := uploadBytes(t, e, e.privID, "mut", []byte("attempted overwrite of a directory"), c)
	if resp.StatusCode != http.StatusInternalServerError {
		b := body(t, resp)
		t.Fatalf("upload onto a directory: status = %d, want 500 (body %.120q)", resp.StatusCode, b)
	}
	if fi, err := remoteLstat(t, e, "sandbox/mut"); err != nil || !fi.IsDir() {
		t.Fatalf("mut after conflicted upload: fi=%v err=%v", fi, err)
	}
	if got := string(remoteRead(t, e, "sandbox/mut/seed.txt")); got != "seed\n" {
		t.Fatalf("mut contents altered: %q", got)
	}
	for _, n := range remoteNames(t, e, "sandbox") {
		if strings.Contains(n, ".sfpart-") {
			t.Fatalf("temp partial left behind: %s", n)
		}
	}
}

func TestUploadAbandonOnExhaustedAttempts(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	// Two deterministic mid-transfer kills against an attempt budget
	// of two: the transfer exhausts, the request fails 503, and no
	// file exists at the target path (nor any temp partial).
	oldAttempts, oldOpts := fsapi.MaxAttempts, fsapi.UploadTransferOptions
	fsapi.MaxAttempts, fsapi.UploadTransferOptions = 2, sftpreadwrite.Options{MaxAttempts: 2}
	defer func() { fsapi.MaxAttempts, fsapi.UploadTransferOptions = oldAttempts, oldOpts }()

	e.f.ArmKills([]int64{64 << 10, 128 << 10})
	payload := testssh.RandomBytes(3, 512<<10)
	resp := uploadBytes(t, e, e.privID, "up/storm.bin", payload, c)
	if resp.StatusCode != http.StatusServiceUnavailable {
		b := body(t, resp)
		t.Fatalf("kill-storm upload: status = %d, want 503 (body %.160q)", resp.StatusCode, b)
	}
	if _, err := remoteLstat(t, e, "sandbox/up/storm.bin"); err == nil {
		t.Fatal("target exists after exhausted upload")
	}
	for _, n := range remoteNames(t, e, "sandbox/up") {
		if strings.Contains(n, ".sfpart-") {
			t.Fatalf("temp partial left behind: %s", n)
		}
	}
}

func TestUploadClientCancellationAbandons(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	// A slow body (pipe) keeps the upload running; the client cancels
	// mid-flight; the handler must abandon — no temp, no target.
	pr, pw := io.Pipe()
	go func() {
		chunk := make([]byte, 32<<10)
		for i := range chunk {
			chunk[i] = byte(i)
		}
		for {
			if _, err := pw.Write(chunk); err != nil {
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
	defer pw.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	u := e.s.BaseURL + "/api/sf/vdirs/" + e.privID + "/upload?path=up/canceled.bin"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, pr)
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = -1 // chunked: the size is unknown to the server
	req.AddCookie(c)
	_, _ = http.DefaultClient.Do(req) // the request error is the cancellation itself

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		clean := true
		for _, n := range remoteNames(t, e, "sandbox/up") {
			if strings.Contains(n, ".sfpart-") || n == "canceled.bin" {
				clean = false
			}
		}
		if clean {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("canceled upload left state behind: %v", remoteNames(t, e, "sandbox/up"))
}

// ---- disconnect retries for the fast mutations (R6, tasks 3.1–3.3) ----

func TestMutationDisconnectsRetried(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	t.Run("mkdir deep chain across two kills", func(t *testing.T) {
		// 50 components ≈ 10KB of channel traffic: both kills land
		// mid-chain deterministically, whichever part of the request
		// they interrupt.
		e.f.ArmKills([]int64{12 << 10, 20 << 10})
		chain := "disco"
		for i := 0; i < 120; i++ {
			chain += fmt.Sprintf("/a%d", i)
		}
		mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": chain}, c), http.StatusNoContent)
		for i := 0; i < 120; i++ {
			rel := "sandbox/disco"
			for j := 0; j <= i; j++ {
				rel += fmt.Sprintf("/a%d", j)
			}
			if fi, err := remoteLstat(t, e, rel); err != nil || !fi.IsDir() {
				t.Fatalf("chain incomplete at %s: fi=%v err=%v", rel, fi, err)
			}
		}
	})

	t.Run("rm tree across two kills", func(t *testing.T) {
		scl := fixtureSFTP(t, e)
		defer scl.Close()
		for _, d := range []string{"disco-rm", "disco-rm/d1", "disco-rm/d2", "disco-rm/d3"} {
			if err := scl.MkdirAll(fpath(e, d)); err != nil {
				t.Fatal(err)
			}
		}
		for d := 1; d <= 3; d++ {
			for i := 0; i < 90; i++ {
				writeRemote(t, scl, fpath(e, fmt.Sprintf("disco-rm/d%d/f%02d.txt", d, i)), "x\n")
			}
		}
		e.f.ArmKills([]int64{12 << 10, 24 << 10})
		mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "disco-rm"}, c), http.StatusNoContent)
		if _, err := remoteLstat(t, e, "sandbox/disco-rm"); err == nil {
			t.Fatal("tree partially deleted after retried rm")
		}
	})

	t.Run("mv across one kill", func(t *testing.T) {
		scl := fixtureSFTP(t, e)
		defer scl.Close()
		payload := testssh.RandomBytes(6, 64<<10)
		writeRemoteBytes(t, scl, fpath(e, "disco-mv-src.bin"), payload)
		e.f.ArmKills([]int64{6 << 10})
		mustStatus(t, opJSON(t, e, e.privID, "mv", map[string]string{"path": "disco-mv-src.bin", "to": "disco-mv-dst.bin"}, c), http.StatusNoContent)
		if _, err := remoteLstat(t, e, "sandbox/disco-mv-src.bin"); err == nil {
			t.Fatal("mv left the source behind")
		}
		if got := remoteRead(t, e, "sandbox/disco-mv-dst.bin"); !bytes.Equal(got, payload) {
			t.Fatal("mv target content mismatch")
		}
	})
}

// Task 4.3: the deterministic mid-upload disconnect — the published
// file checksums equal to the uploaded body.
func TestUploadDisconnectResumes(t *testing.T) {
	e := setup(t)
	c := ownerC(t, e)

	e.f.ArmKills([]int64{65536}) // the first connection dies 64KiB in
	payload := testssh.RandomBytes(7, 8<<20)
	resp := uploadBytes(t, e, e.privID, "up/resume.bin", payload, c)
	mustStatus(t, resp, http.StatusOK)
	var out struct {
		Size int64 `json:"size"`
	}
	if err := json.NewDecoder(bytes.NewReader(body(t, resp))).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Size != int64(len(payload)) {
		t.Fatalf("reported size = %d, want %d", out.Size, len(payload))
	}
	if got := remoteRead(t, e, "sandbox/up/resume.bin"); !bytes.Equal(got, payload) {
		t.Fatalf("resumed upload corrupted: %s vs %s", sha(got), sha(payload))
	}
}

// The /api/sf/vdirs/* group really runs with cleared deadlines: the
// server has a 300ms write deadline that would kill any longer
// upload; a streamed upload far outlasting it still completes.
func TestUploadOutlivesWriteTimeout(t *testing.T) {
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

	payload := testssh.RandomBytes(8, 32<<20) // ~10x the 300ms deadline
	resp := uploadBytes(t, e, e.privID, "up/timeout.bin", payload, &http.Cookie{Name: "sf_session", Value: token})
	mustStatus(t, resp, http.StatusOK)
	if got := remoteRead(t, e, "sandbox/up/timeout.bin"); !bytes.Equal(got, payload) {
		t.Fatal("upload died to the write deadline or corrupted")
	}
}

// ---- access control (task 5.1) ----

func TestAccessMatrix(t *testing.T) {
	e := setup(t)
	baseline := e.f.TotalConns()

	// Anonymous and invalid sessions never dial.
	t.Run("anonymous is 401 without dialing", func(t *testing.T) {
		ops := []struct {
			name string
			run  func() *http.Response
		}{
			{"ls", func() *http.Response { return opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, nil) }},
			{"mkdir", func() *http.Response { return opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "x"}, nil) }},
			{"mv", func() *http.Response {
				return opJSON(t, e, e.privID, "mv", map[string]string{"path": "a", "to": "b"}, nil)
			}},
			{"rm", func() *http.Response { return opJSON(t, e, e.privID, "rm", map[string]string{"path": "x"}, nil) }},
			{"upload", func() *http.Response { return uploadBytes(t, e, e.privID, "x.bin", []byte("x"), nil) }},
		}
		for _, op := range ops {
			resp := op.run()
			if resp.StatusCode != http.StatusUnauthorized {
				b := body(t, resp)
				t.Fatalf("anonymous %s: status = %d, want 401 (body %.120q)", op.name, resp.StatusCode, b)
			}
		}
		if got := e.f.TotalConns(); got != baseline {
			t.Fatalf("rejected anonymous ops dialed: conns %d → %d", baseline, got)
		}
	})

	t.Run("forged or invalid sessions are 401", func(t *testing.T) {
		for _, tok := range []string{"forged-token", testapp.TestUserPassword} {
			c := &http.Cookie{Name: "sf_session", Value: tok}
			resp := opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, c)
			mustStatus(t, resp, http.StatusUnauthorized)
		}
		if got := e.f.TotalConns(); got != baseline {
			t.Fatalf("invalid sessions dialed: conns %d → %d", baseline, got)
		}
	})

	t.Run("authenticated non-owner is 403", func(t *testing.T) {
		c := otherC(t, e)
		for _, op := range []struct {
			name string
			run  func() *http.Response
		}{
			{"ls", func() *http.Response { return opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, c) }},
			{"mkdir", func() *http.Response { return opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "x"}, c) }},
			{"upload", func() *http.Response { return uploadBytes(t, e, e.privID, "x.bin", []byte("x"), c) }},
		} {
			resp := op.run()
			if resp.StatusCode != http.StatusForbidden {
				b := body(t, resp)
				t.Fatalf("non-owner %s: status = %d, want 403 (body %.120q)", op.name, resp.StatusCode, b)
			}
		}
		if got := e.f.TotalConns(); got != baseline {
			t.Fatalf("rejected non-owner ops dialed: conns %d → %d", baseline, got)
		}
	})

	t.Run("public vdir serves anonymous ls only", func(t *testing.T) {
		resp := opJSON(t, e, e.pubID, "ls", map[string]string{"path": ""}, nil)
		mustStatus(t, resp, http.StatusOK)
		if got := e.f.TotalConns(); got <= baseline {
			t.Fatalf("public ls did not dial (conns %d → %d)", baseline, got)
		}
		for _, op := range []struct {
			name string
			run  func() *http.Response
		}{
			{"mkdir", func() *http.Response { return opJSON(t, e, e.pubID, "mkdir", map[string]string{"path": "x"}, nil) }},
			{"mv", func() *http.Response {
				return opJSON(t, e, e.pubID, "mv", map[string]string{"path": "a", "to": "b"}, nil)
			}},
			{"rm", func() *http.Response { return opJSON(t, e, e.pubID, "rm", map[string]string{"path": "hello.txt"}, nil) }},
			{"upload", func() *http.Response { return uploadBytes(t, e, e.pubID, "x.bin", []byte("x"), nil) }},
		} {
			resp := op.run()
			if resp.StatusCode != http.StatusUnauthorized {
				b := body(t, resp)
				t.Fatalf("anonymous write on public vdir (%s): status = %d, want 401 (body %.120q)", op.name, resp.StatusCode, b)
			}
		}
		// Writes stay owner-only on public vdirs even when
		// authenticated: a non-owner is 403.
		resp = uploadBytes(t, e, e.pubID, "x.bin", []byte("x"), otherC(t, e))
		mustStatus(t, resp, http.StatusForbidden)
	})

	t.Run("owner executes every operation", func(t *testing.T) {
		c := ownerC(t, e)
		mustStatus(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, c), http.StatusOK)
		mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "own/x"}, c), http.StatusNoContent)
		mustStatus(t, opJSON(t, e, e.privID, "mv", map[string]string{"path": "own", "to": "own2"}, c), http.StatusNoContent)
		mustStatus(t, uploadBytes(t, e, e.privID, "own2/f.bin", []byte("own"), c), http.StatusOK)
		mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "own2"}, c), http.StatusNoContent)
	})

	// Viewer: ls only, on non-public and public vdirs alike; every
	// write is 403 and never dials.
	t.Run("viewer lists but every write is 403", func(t *testing.T) {
		e.grant(t, e.privID, e.viewerID, "viewer")
		vc := tokenCookie(t, e, e.viewerID)
		mustStatus(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, vc), http.StatusOK)

		before := e.f.TotalConns()
		for _, op := range []struct {
			name string
			run  func() *http.Response
		}{
			{"mkdir", func() *http.Response { return opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "vw/x"}, vc) }},
			{"mv", func() *http.Response {
				return opJSON(t, e, e.privID, "mv", map[string]string{"path": "hello.txt", "to": "vw"}, vc)
			}},
			{"rm", func() *http.Response { return opJSON(t, e, e.privID, "rm", map[string]string{"path": "hello.txt"}, vc) }},
			{"upload", func() *http.Response { return uploadBytes(t, e, e.privID, "vw.bin", []byte("x"), vc) }},
			{"upload on public", func() *http.Response { return uploadBytes(t, e, e.pubID, "vw.bin", []byte("x"), vc) }},
		} {
			resp := op.run()
			if resp.StatusCode != http.StatusForbidden {
				b := body(t, resp)
				t.Fatalf("viewer %s: status = %d, want 403 (body %.120q)", op.name, resp.StatusCode, b)
			}
		}
		if got := e.f.TotalConns(); got != before {
			t.Fatalf("rejected viewer writes dialed: conns %d → %d", before, got)
		}
		// nothing was created by the rejected attempts
		for _, p := range []string{"vw", "vw.bin"} {
			if _, err := remoteLstat(t, e, "sandbox/"+p); err == nil {
				t.Fatalf("rejected viewer write left %q behind", p)
			}
		}
		// reads on the public vdir are fine for a share holder too
		mustStatus(t, opJSON(t, e, e.pubID, "ls", map[string]string{"path": ""}, vc), http.StatusOK)
	})

	// Editor: the full remote operation set, on non-public and public
	// vdirs alike.
	t.Run("editor executes every operation", func(t *testing.T) {
		e.grant(t, e.privID, e.editorID, "editor")
		ec := tokenCookie(t, e, e.editorID)
		mustStatus(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, ec), http.StatusOK)
		mustStatus(t, opJSON(t, e, e.privID, "mkdir", map[string]string{"path": "ed/x"}, ec), http.StatusNoContent)
		mustStatus(t, opJSON(t, e, e.privID, "mv", map[string]string{"path": "ed", "to": "ed2"}, ec), http.StatusNoContent)
		mustStatus(t, uploadBytes(t, e, e.privID, "ed2/f.bin", []byte("ed"), ec), http.StatusOK)
		mustStatus(t, opJSON(t, e, e.privID, "rm", map[string]string{"path": "ed2"}, ec), http.StatusNoContent)
		// writes on a public vdir need an editor grant on that vdir —
		// without one the editor is an unshared user there (403), with
		// one editor suffices
		mustStatus(t, uploadBytes(t, e, e.pubID, "ed-pub.bin", []byte("ed"), ec), http.StatusForbidden)
		e.grant(t, e.pubID, e.editorID, "editor")
		mustStatus(t, uploadBytes(t, e, e.pubID, "ed-pub.bin", []byte("ed"), ec), http.StatusOK)
		mustStatus(t, opJSON(t, e, e.pubID, "rm", map[string]string{"path": "ed-pub.bin"}, ec), http.StatusNoContent)
	})
}

// Revocation is immediate (task 5.1): the same still-valid session
// loses and gains access with the share row, without re-login.
func TestImmediateRevocation(t *testing.T) {
	e := setup(t)
	shareID := e.grant(t, e.privID, e.viewerID, "viewer")
	vc := tokenCookie(t, e, e.viewerID)

	mustStatus(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, vc), http.StatusOK)

	shareRec, err := e.s.App.FindRecordById("vdir_shares", shareID)
	if err != nil {
		t.Fatalf("find share: %v", err)
	}
	if err := e.s.App.Delete(shareRec); err != nil {
		t.Fatalf("delete share: %v", err)
	}
	mustStatus(t, opJSON(t, e, e.privID, "ls", map[string]string{"path": ""}, vc), http.StatusForbidden)

	// Promotion applies on the next request, too: viewer → editor
	// makes upload work without any re-login.
	e.grant(t, e.privID, e.viewerID, "editor")
	mustStatus(t, uploadBytes(t, e, e.privID, "promoted.bin", []byte("promoted"), vc), http.StatusOK)

	// Un-publishing a public vdir closes anonymous access immediately
	// on the API surface as well.
	mustStatus(t, opJSON(t, e, e.pubID, "ls", map[string]string{"path": ""}, nil), http.StatusOK)
	pubRec, err := e.s.App.FindRecordById("vdirs", e.pubID)
	if err != nil {
		t.Fatalf("find pub vdir: %v", err)
	}
	pubRec.Set("is_public", false)
	if err := e.s.App.Save(pubRec); err != nil {
		t.Fatalf("unpublish: %v", err)
	}
	mustStatus(t, opJSON(t, e, e.pubID, "ls", map[string]string{"path": ""}, nil), http.StatusUnauthorized)
}
