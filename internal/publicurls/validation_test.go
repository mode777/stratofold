package publicurls_test

import (
	"testing"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
)

func seedVdir(tb testing.TB, s *testapp.Server, ownerID, name string) *core.Record {
	tb.Helper()
	connections, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		tb.Fatalf("connections collection: %v", err)
	}
	conns, err := s.App.FindRecordsByFilter("connections", "owner = {:owner}", "", 1, 0, map[string]any{"owner": ownerID})
	if err != nil {
		tb.Fatalf("find connections: %v", err)
	}
	var connID string
	if len(conns) > 0 {
		connID = conns[0].Id
	} else {
		conn := core.NewRecord(connections)
		conn.Set("owner", ownerID)
		conn.Set("label", "fixture")
		conn.Set("host", "127.0.0.1")
		conn.Set("port", 22)
		conn.Set("username", "testuser")
		conn.Set("auth_method", "password")
		conn.Set("password", "not-a-real-secret")
		if err := s.App.Save(conn); err != nil {
			tb.Fatalf("save connection: %v", err)
		}
		connID = conn.Id
	}

	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		tb.Fatalf("vdirs collection: %v", err)
	}
	vd := core.NewRecord(vdirs)
	vd.Set("owner", ownerID)
	vd.Set("connection", connID)
	vd.Set("name", name)
	vd.Set("root_path", "/srv/"+name)
	return vd
}

func TestDuplicatePublicSlugIsAFieldError(t *testing.T) {
	s := testapp.Start(t)
	owner, err := s.App.FindAuthRecordByEmail("users", testapp.TestUserEmail)
	if err != nil {
		t.Fatalf("owner: %v", err)
	}

	first := seedVdir(t, s, owner.Id, "first")
	first.Set("public_slug", "shared-name")
	if err := s.App.Save(first); err != nil {
		t.Fatalf("save first vdir: %v", err)
	}

	// Re-saving the same record with the same slug is not a conflict.
	if err := s.App.Save(first); err != nil {
		t.Fatalf("re-save first vdir: %v", err)
	}

	second := seedVdir(t, s, owner.Id, "second")
	second.Set("public_slug", "shared-name")
	err = s.App.Save(second)
	if err == nil {
		t.Fatal("duplicate slug save succeeded, want a field validation error")
	}
	errs, ok := err.(validation.Errors)
	if !ok {
		t.Fatalf("duplicate slug error = %T %v, want validation.Errors", err, err)
	}
	if _, ok := errs["public_slug"]; !ok {
		t.Fatalf("duplicate slug error = %v, want a public_slug field error", errs)
	}
}
