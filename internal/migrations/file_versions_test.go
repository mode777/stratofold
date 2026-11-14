package migrations_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/fileversion"
	"github.com/mode777/stratofold/internal/testapp"
)

// TestFileVersionsCollectionShape pins the internal generation store:
// the fields, the unique (vdir, remote_path) pair, the cascade, and the
// deliberately unset record rules.
func TestFileVersionsCollectionShape(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	col, err := s.App.FindCollectionByNameOrId(fileversion.Collection)
	if err != nil {
		t.Fatalf("%s collection: %v", fileversion.Collection, err)
	}
	for _, name := range []string{"vdir", "remote_path", "generation"} {
		if col.Fields.GetByName(name) == nil {
			t.Fatalf("%s is missing field %q", fileversion.Collection, name)
		}
	}
	indexes := strings.Join(col.Indexes, "\n")
	if !strings.Contains(indexes, "idx_file_versions_vdir_path") || !strings.Contains(strings.ToUpper(indexes), "UNIQUE") {
		t.Fatalf("file_versions lacks a unique (vdir, remote_path) index: %v", col.Indexes)
	}
	if col.ListRule != nil || col.ViewRule != nil || col.CreateRule != nil ||
		col.UpdateRule != nil || col.DeleteRule != nil {
		t.Fatalf("file_versions record rules must stay unset (superuser-only): %+v",
			[]*string{col.ListRule, col.ViewRule, col.CreateRule, col.UpdateRule, col.DeleteRule})
	}

	rel, ok := col.Fields.GetByName("vdir").(*core.RelationField)
	if !ok || !rel.CascadeDelete {
		t.Fatalf("file_versions.vdir must cascade-delete: %+v", col.Fields.GetByName("vdir"))
	}

	// A vdir deletion must remove its generation rows.
	c1 := seedConnection(t, s, owner, "versions-c1")
	st, out := doJSON(t, s, http.MethodPost, vdirBase, owner.token, map[string]any{
		"owner": owner.id, "connection": c1, "name": "versions", "root_path": "/srv/data",
	})
	if st != http.StatusOK {
		t.Fatalf("create vdir: status %d body %v", st, out)
	}
	vdirID := out["id"].(string)
	if _, err := fileversion.Bump(s.App, vdirID, "/srv/data/a.txt"); err != nil {
		t.Fatalf("bump: %v", err)
	}
	rows, err := s.App.FindRecordsByFilter(fileversion.Collection, "vdir = {:v}", "", 0, 0, dbx.Params{"v": vdirID})
	if err != nil {
		t.Fatalf("list generations: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("generation rows = %d, want 1", len(rows))
	}
	vd, err := s.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.App.Delete(vd); err != nil {
		t.Fatalf("delete vdir: %v", err)
	}
	rows, err = s.App.FindRecordsByFilter(fileversion.Collection, "vdir = {:v}", "", 0, 0, dbx.Params{"v": vdirID})
	if err != nil {
		t.Fatalf("list generations after delete: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("vdir delete left %d generation row(s)", len(rows))
	}
}
