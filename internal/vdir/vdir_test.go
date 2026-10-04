package vdir_test

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/pkg/sftp"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
	"github.com/mode777/stratofold/internal/vdir"
)

const fileContent = "the quick brown fox jumps over the lazy dog\n"

type env struct {
	s      *testapp.Server
	f      *testssh.Fixture
	connID string
	vdirID string
}

// setup boots the app + fixture and records a connection + a vdir
// rooted at <fixture-root>/sandbox (seeded with docs/a.txt and the
// escape apparatus).
func setup(t *testing.T) *env {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	s := testapp.Start(t)

	_, rec := s.LoginBody(t)
	connCol, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", rec["id"])
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
	vd := core.NewRecord(vdirCol)
	vd.Set("owner", rec["id"])
	vd.Set("connection", conn.Id)
	vd.Set("name", "sandbox")
	vd.Set("root_path", f.Path("sandbox"))
	if err := s.App.Save(vd); err != nil {
		t.Fatalf("save vdir: %v", err)
	}

	// Seed <root>/docs/a.txt and the escape apparatus.
	cl, err := f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()
	if err := scl.MkdirAll(f.Path("sandbox/docs")); err != nil {
		t.Fatalf("mkdir sandbox/docs: %v", err)
	}
	if err := scl.MkdirAll(f.Path("outside")); err != nil {
		t.Fatalf("mkdir outside: %v", err)
	}
	writeRemote(t, scl, f.Path("sandbox/docs/a.txt"), fileContent)
	writeRemote(t, scl, f.Path("outside/secret.txt"), "outside\n")

	// symlink inside the root pointing outside the root
	if err := scl.Symlink(f.Path("outside"), f.Path("sandbox/docs/link-out")); err != nil {
		t.Fatalf("symlink out: %v", err)
	}
	// symlink staying inside the root
	if err := scl.Symlink("a.txt", f.Path("sandbox/docs/link-in")); err != nil {
		t.Fatalf("symlink in: %v", err)
	}

	return &env{s: s, f: f, connID: conn.Id, vdirID: vd.Id}
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

func TestResolveNormalPaths(t *testing.T) {
	e := setup(t)
	r := vdir.NewResolver(e.s.App)
	ctx := context.Background()

	res, err := r.Resolve(ctx, e.vdirID, "docs/a.txt")
	if err != nil {
		t.Fatalf("resolve docs/a.txt: %v", err)
	}
	if res.RemotePath != e.f.Path("sandbox/docs/a.txt") {
		t.Fatalf("remote path %q", res.RemotePath)
	}

	res, err = r.Resolve(ctx, e.vdirID, "")
	if err != nil {
		t.Fatalf("resolve root: %v", err)
	}
	if res.RemotePath != e.f.Path("sandbox") {
		t.Fatalf("root remote path %q", res.RemotePath)
	}

	res, err = r.Resolve(ctx, e.vdirID, "docs/./sub/../a.txt")
	if err != nil {
		t.Fatalf("resolve redundant: %v", err)
	}
	if res.RemotePath != e.f.Path("sandbox/docs/a.txt") {
		t.Fatalf("canonical remote path %q", res.RemotePath)
	}
}

func TestLexicalRejectionsDialNothing(t *testing.T) {
	e := setup(t)
	r := vdir.NewResolver(e.s.App)
	ctx := context.Background()

	before := e.f.TotalConns()
	for _, p := range []string{
		"../../../etc/passwd",
		"docs/../../outside/secret.txt",
		"/etc/passwd",
		"a\x00b",
	} {
		if _, err := r.Resolve(ctx, e.vdirID, p); err == nil {
			t.Fatalf("resolve %q accepted", p)
		}
	}
	if after := e.f.TotalConns(); after != before {
		t.Fatalf("rejected paths dialed: %d → %d connections", before, after)
	}
}

func TestSymlinkEscapeRejected(t *testing.T) {
	e := setup(t)
	r := vdir.NewResolver(e.s.App)

	_, err := r.Resolve(context.Background(), e.vdirID, "docs/link-out/secret.txt")
	if !errors.Is(err, vdir.ErrEscape) {
		t.Fatalf("symlink escape error = %v, want ErrEscape", err)
	}
}

func TestInternalSymlinkAccepted(t *testing.T) {
	e := setup(t)
	r := vdir.NewResolver(e.s.App)

	res, err := r.Resolve(context.Background(), e.vdirID, "docs/link-in")
	if err != nil {
		t.Fatalf("internal symlink: %v", err)
	}
	if res.RemotePath != e.f.Path("sandbox/docs/a.txt") {
		t.Fatalf("resolved %q", res.RemotePath)
	}
}

func TestSymlinkedRootBaseline(t *testing.T) {
	e := setup(t)

	// root symlink: <root>/sandbox-link → <root>/sandbox-real
	cl, err := e.f.SSHClient()
	if err != nil {
		t.Fatalf("ssh client: %v", err)
	}
	scl, err := sftp.NewClient(cl)
	if err != nil {
		t.Fatalf("sftp client: %v", err)
	}
	defer scl.Close()
	if err := scl.MkdirAll(e.f.Path("sandbox-real/docs")); err != nil {
		t.Fatalf("mkdir sandbox-real: %v", err)
	}
	writeRemote(t, scl, e.f.Path("sandbox-real/docs/b.txt"), "b\n")
	if err := scl.Symlink(e.f.Path("sandbox-real"), e.f.Path("sandbox-link")); err != nil {
		t.Fatalf("root symlink: %v", err)
	}

	_, vrec := e.s.LoginBody(t)
	vdirCol, err := e.s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	vd := core.NewRecord(vdirCol)
	vd.Set("owner", vrec["id"])
	vd.Set("connection", e.connID)
	vd.Set("name", "linked")
	vd.Set("root_path", e.f.Path("sandbox-link"))
	if err := e.s.App.Save(vd); err != nil {
		t.Fatalf("save vdir: %v", err)
	}

	r := vdir.NewResolver(e.s.App)
	res, err := r.Resolve(context.Background(), vd.Id, "docs/b.txt")
	if err != nil {
		t.Fatalf("resolve via symlinked root: %v", err)
	}
	if res.RemotePath != e.f.Path("sandbox-real/docs/b.txt") {
		t.Fatalf("resolved %q", res.RemotePath)
	}

	// and the escape check still applies relative to the resolved root
	if _, err := r.Resolve(context.Background(), vd.Id, "../sandbox/docs/a.txt"); err == nil {
		t.Fatalf("traversal out of symlinked root accepted")
	}
}

func TestOutsideRootUnreachableThroughVdir(t *testing.T) {
	e := setup(t)
	r := vdir.NewResolver(e.s.App)
	ctx := context.Background()

	for _, p := range []string{
		"../outside/secret.txt",    // lexical traversal
		"docs/link-out/secret.txt", // symlink escape
		"docs/link-out",            // the link itself
		"/etc/passwd",              // absolute form
	} {
		if _, err := r.Resolve(ctx, e.vdirID, p); err == nil {
			t.Fatalf("outside file reachable via %q", p)
		}
	}
}

func TestReadThroughSeamIsByteExact(t *testing.T) {
	e := setup(t)
	r := vdir.NewResolver(e.s.App)

	res, err := r.Resolve(context.Background(), e.vdirID, "docs/a.txt")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	tr := sftpreadwrite.New(res.Provider, res.RemotePath, sftpreadwrite.Options{})
	var got bytes.Buffer
	if _, err := tr.ReadAll(context.Background(), &got); err != nil {
		t.Fatalf("read through seam: %v", err)
	}
	if got.String() != fileContent {
		t.Fatalf("read %q, want %q", got.String(), fileContent)
	}
}
