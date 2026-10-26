package migrations_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/mode777/stratofold/internal/testapp"
)

const fileLinksBase = "/api/collections/file_links/records"

// TestFileLinksCollectionShape pins the migration's fields, indexes,
// and deliberately unset record rules.
func TestFileLinksCollectionShape(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	col, err := s.App.FindCollectionByNameOrId("file_links")
	if err != nil {
		t.Fatalf("file_links collection: %v", err)
	}
	for _, name := range []string{"vdir", "path", "created_by", "token_hash", "expires_at"} {
		if col.Fields.GetByName(name) == nil {
			t.Fatalf("file_links is missing field %q", name)
		}
	}
	indexes := strings.Join(col.Indexes, "\n")
	if !strings.Contains(indexes, "idx_file_links_token_hash") {
		t.Fatalf("file_links has no token_hash index: %v", col.Indexes)
	}
	if !strings.Contains(indexes, "idx_file_links_expires_at") {
		t.Fatalf("file_links has no expires_at index: %v", col.Indexes)
	}
	if col.ListRule != nil || col.ViewRule != nil || col.CreateRule != nil ||
		col.UpdateRule != nil || col.DeleteRule != nil {
		t.Fatalf("file_links record rules must stay unset (superuser-only): %+v",
			[]*string{col.ListRule, col.ViewRule, col.CreateRule, col.UpdateRule, col.DeleteRule})
	}

	// Seed a link row server-side; the record API must not reveal it to
	// a normal authenticated user.
	c1 := seedConnection(t, s, owner, "links-c1")
	st, out := doJSON(t, s, http.MethodPost, vdirBase, owner.token, map[string]any{
		"owner": owner.id, "connection": c1, "name": "links", "root_path": "/srv/data",
	})
	if st != http.StatusOK {
		t.Fatalf("create vdir: status %d body %v", st, out)
	}
	vdirID := out["id"].(string)

	links, err := s.App.FindCollectionByNameOrId("file_links")
	if err != nil {
		t.Fatalf("file_links collection: %v", err)
	}
	row := core.NewRecord(links)
	row.Set("vdir", vdirID)
	row.Set("path", "docs/a.txt")
	row.Set("created_by", owner.id)
	row.Set("token_hash", "deadbeefdeadbeef")
	exp, err := types.ParseDateTime(time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("expiry: %v", err)
	}
	row.Set("expires_at", exp)
	if err := s.App.Save(row); err != nil {
		t.Fatalf("save file_links row: %v", err)
	}

	listStatus, listBody := doJSON(t, s, http.MethodGet, fileLinksBase, owner.token, nil)
	raw, _ := json.Marshal(listBody)
	if strings.Contains(string(raw), "deadbeefdeadbeef") {
		t.Fatalf("record list leaked a token hash")
	}
	if listStatus == http.StatusOK {
		items, _ := listBody["items"].([]any)
		if len(items) != 0 {
			t.Fatalf("record list exposed %d file_links rows to a normal user", len(items))
		}
	}

	viewStatus, viewBody := doJSON(t, s, http.MethodGet, fileLinksBase+"/"+row.Id, owner.token, nil)
	raw, _ = json.Marshal(viewBody)
	if strings.Contains(string(raw), "deadbeefdeadbeef") {
		t.Fatalf("record view leaked a token hash")
	}
	if viewStatus == http.StatusOK {
		t.Fatalf("record view exposed a file_links row to a normal user")
	}
}
