package vdirauthz_test

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
	"github.com/mode777/stratofold/internal/vdirauthz"
)

// Unit tests for the shared authorization seam (task 2.1) over the
// real embedded PocketBase app, with the SSH fixture observing that
// resolution never dials.
type env struct {
	s       *testapp.Server
	f       *testssh.Fixture
	owner   *core.Record
	sharer  *core.Record
	editor  *core.Record
	vdir    *core.Record // non-public
	pubVdir *core.Record // public
}

func setup(t *testing.T) *env {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	s := testapp.Start(t)

	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	mkUser := func(email string) *core.Record {
		t.Helper()
		rec := core.NewRecord(users)
		rec.SetEmail(email)
		rec.SetPassword("pass-123456")
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("seed %s: %v", email, err)
		}
		return rec
	}
	owner := mkUser("owner@stratofold.test")
	sharer := mkUser("viewer@stratofold.test")
	editor := mkUser("editor@stratofold.test")

	conns, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(conns)
	conn.Set("owner", owner.Id)
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

	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	mkVdir := func(name string, pub bool) *core.Record {
		t.Helper()
		vd := core.NewRecord(vdirs)
		vd.Set("owner", owner.Id)
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", "/srv/"+name)
		vd.Set("is_public", pub)
		if err := s.App.Save(vd); err != nil {
			t.Fatalf("save vdir %s: %v", name, err)
		}
		return vd
	}
	vdir := mkVdir("sandbox", false)
	pubVdir := mkVdir("pub", true)

	return &env{s: s, f: f, owner: owner, sharer: sharer, editor: editor, vdir: vdir, pubVdir: pubVdir}
}

// grant saves a share directly (bypassing the record API and its
// rules — this is a seam unit, not a rules test).
func (e *env) grant(t *testing.T, vd, user *core.Record, role string) *core.Record {
	t.Helper()
	shares, err := e.s.App.FindCollectionByNameOrId("vdir_shares")
	if err != nil {
		t.Fatalf("vdir_shares collection: %v", err)
	}
	rec := core.NewRecord(shares)
	rec.Set("vdir", vd.Id)
	rec.Set("user", user.Id)
	rec.Set("role", role)
	if err := e.s.App.Save(rec); err != nil {
		t.Fatalf("save share (%s): %v", role, err)
	}
	return rec
}

func TestResolveLevels(t *testing.T) {
	e := setup(t)
	// Whatever setup itself dialed (record hooks etc.), resolution
	// must not add to it.
	baseline := e.f.TotalConns()

	if got := vdirauthz.Resolve(e.s.App, e.vdir, e.owner.Id); got.Access != vdirauthz.Owner {
		t.Fatalf("owner resolved %v, want Owner", got.Access)
	}
	view := e.grant(t, e.vdir, e.sharer, "viewer")
	if got := vdirauthz.Resolve(e.s.App, e.vdir, e.sharer.Id); got.Access != vdirauthz.Viewer {
		t.Fatalf("viewer resolved %v, want Viewer", got.Access)
	}
	if got := vdirauthz.Resolve(e.s.App, e.vdir, e.editor.Id); got.Access != vdirauthz.None {
		t.Fatalf("unshared user resolved %v, want None", got.Access)
	}
	e.grant(t, e.vdir, e.editor, "editor")
	if got := vdirauthz.Resolve(e.s.App, e.vdir, e.editor.Id); got.Access != vdirauthz.Editor {
		t.Fatalf("editor resolved %v, want Editor", got.Access)
	}

	// No dial so far, and none of the resolutions above dialed.
	if got := e.f.TotalConns(); got != baseline {
		t.Fatalf("resolution dialed SSH: %d → %d connections", baseline, got)
	}

	// Deleting the share resolves to None on the very next call.
	if err := e.s.App.Delete(view); err != nil {
		t.Fatalf("delete share: %v", err)
	}
	if got := vdirauthz.Resolve(e.s.App, e.vdir, e.sharer.Id); got.Access != vdirauthz.None {
		t.Fatalf("revoked share resolved %v, want None", got.Access)
	}

	// Anonymous and unknown users: no access; the public flag still
	// surfaces.
	if got := vdirauthz.Resolve(e.s.App, e.vdir, ""); got.Access != vdirauthz.None || got.Public {
		t.Fatalf("anonymous on private vdir: %+v", got)
	}
	if got := vdirauthz.Resolve(e.s.App, e.pubVdir, ""); !got.Public || got.Access != vdirauthz.None {
		t.Fatalf("anonymous on public vdir: %+v", got)
	}
	if got := vdirauthz.Resolve(e.s.App, e.pubVdir, "no-such-user"); got.Access != vdirauthz.None {
		t.Fatalf("unknown user on public vdir: %+v", got)
	}
}

func TestResolveMappingHelpers(t *testing.T) {
	e := setup(t)
	e.grant(t, e.vdir, e.sharer, "viewer")
	e.grant(t, e.vdir, e.editor, "editor")

	cases := []struct {
		name  string
		got   vdirauthz.Decision
		read  bool
		write bool
	}{
		{"anonymous private", vdirauthz.Resolve(e.s.App, e.vdir, ""), false, false},
		{"anonymous public", vdirauthz.Resolve(e.s.App, e.pubVdir, ""), true, false},
		{"viewer", vdirauthz.Resolve(e.s.App, e.vdir, e.sharer.Id), true, false},
		{"editor", vdirauthz.Resolve(e.s.App, e.vdir, e.editor.Id), true, true},
		{"owner", vdirauthz.Resolve(e.s.App, e.vdir, e.owner.Id), true, true},
	}
	for _, tc := range cases {
		if tc.got.CanRead() != tc.read {
			t.Fatalf("%s: CanRead = %v, want %v (%+v)", tc.name, tc.got.CanRead(), tc.read, tc.got)
		}
		if tc.got.CanWrite() != tc.write {
			t.Fatalf("%s: CanWrite = %v, want %v (%+v)", tc.name, tc.got.CanWrite(), tc.write, tc.got)
		}
	}
}

// A redundant owner-share row (impossible via the API, inserted
// directly here) cannot out-rank the owner check.
func TestOwnerCheckPrecedesShareLookup(t *testing.T) {
	e := setup(t)
	e.grant(t, e.vdir, e.owner, "viewer")

	if got := vdirauthz.Resolve(e.s.App, e.vdir, e.owner.Id); got.Access != vdirauthz.Owner {
		t.Fatalf("owner with redundant share resolved %v, want Owner", got.Access)
	}
}
