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

// TestVdirTokensCollectionShape pins the token collection's fields,
// cascade relations, indexes, and deliberately unset record rules.
func TestVdirTokensCollectionShape(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)
	vdirID := seedTokenVdir(t, s, owner, "tokens-shape")

	tokens, err := s.App.FindCollectionByNameOrId("vdir_tokens")
	if err != nil {
		t.Fatalf("vdir_tokens collection: %v", err)
	}
	fields := map[string]core.Field{}
	for _, f := range tokens.Fields {
		fields[f.GetName()] = f
	}
	usr, ok := fields["user"].(*core.RelationField)
	if !ok || !usr.Required || usr.MaxSelect != 1 || !usr.CascadeDelete {
		t.Fatalf("user field wrong: %+v", fields["user"])
	}
	vd, ok := fields["vdir"].(*core.RelationField)
	if !ok || !vd.Required || vd.MaxSelect != 1 || !vd.CascadeDelete {
		t.Fatalf("vdir field wrong: %+v", fields["vdir"])
	}
	if n, ok := fields["name"].(*core.TextField); !ok || !n.Required {
		t.Fatalf("name field wrong: %+v", fields["name"])
	}
	role, ok := fields["role"].(*core.SelectField)
	if !ok || !role.Required || role.MaxSelect != 1 || len(role.Values) != 2 {
		t.Fatalf("role field wrong: %+v", fields["role"])
	}
	for _, v := range role.Values {
		if v != "viewer" && v != "editor" {
			t.Fatalf("unexpected role value %q", v)
		}
	}
	for _, name := range []string{"token_hash", "token_hint"} {
		if f, ok := fields[name].(*core.TextField); !ok || !f.Required {
			t.Fatalf("%s field wrong: %+v", name, fields[name])
		}
	}
	for _, name := range []string{"expires_at", "last_used_at"} {
		if _, ok := fields[name].(*core.DateField); !ok {
			t.Fatalf("%s is not a date field: %+v", name, fields[name])
		}
	}
	indexes := strings.Join(tokens.Indexes, "\n")
	for _, idx := range []string{
		"idx_vdir_tokens_token_hash",
		"idx_vdir_tokens_user",
		"idx_vdir_tokens_vdir",
		"idx_vdir_tokens_expires_at",
	} {
		if !strings.Contains(indexes, idx) {
			t.Fatalf("vdir_tokens is missing index %q: %v", idx, tokens.Indexes)
		}
	}
	if !strings.Contains(indexes, "UNIQUE") || !strings.Contains(indexes, "token_hash") {
		t.Fatalf("vdir_tokens token_hash index is not unique: %v", tokens.Indexes)
	}
	if tokens.ListRule != nil || tokens.ViewRule != nil || tokens.CreateRule != nil ||
		tokens.UpdateRule != nil || tokens.DeleteRule != nil {
		t.Fatalf("vdir_tokens record rules must stay unset (superuser-only): %+v",
			[]*string{tokens.ListRule, tokens.ViewRule, tokens.CreateRule, tokens.UpdateRule, tokens.DeleteRule})
	}

	row := core.NewRecord(tokens)
	row.Set("user", owner.id)
	row.Set("vdir", vdirID)
	row.Set("name", "shape test")
	row.Set("role", "viewer")
	row.Set("token_hash", "deadbeefdeadbeef")
	row.Set("token_hint", "sf_v1_abcdef…1234")
	if err := s.App.Save(row); err != nil {
		t.Fatalf("save vdir_tokens row: %v", err)
	}

	listStatus, listBody := doJSON(t, s, http.MethodGet, "/api/collections/vdir_tokens/records", owner.token, nil)
	raw, _ := json.Marshal(listBody)
	if strings.Contains(string(raw), "deadbeefdeadbeef") {
		t.Fatalf("record list leaked a token hash")
	}
	if listStatus == http.StatusOK {
		if items, _ := listBody["items"].([]any); len(items) != 0 {
			t.Fatalf("record list exposed %d vdir_tokens rows to a normal user", len(items))
		}
	}

	viewStatus, viewBody := doJSON(t, s, http.MethodGet, "/api/collections/vdir_tokens/records/"+row.Id, owner.token, nil)
	raw, _ = json.Marshal(viewBody)
	if strings.Contains(string(raw), "deadbeefdeadbeef") {
		t.Fatalf("record view leaked a token hash")
	}
	if viewStatus == http.StatusOK {
		t.Fatalf("record view exposed a vdir_tokens row to a normal user")
	}
}

// TestFileLinksMintedByTokenRelation pins the nullable source-token
// relation: existing cookie-minted links keep an empty field, and a
// deleted token cascades its links away.
func TestFileLinksMintedByTokenRelation(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)
	vdirID := seedTokenVdir(t, s, owner, "tokens-links")

	tokens, err := s.App.FindCollectionByNameOrId("vdir_tokens")
	if err != nil {
		t.Fatalf("vdir_tokens collection: %v", err)
	}
	links, err := s.App.FindCollectionByNameOrId("file_links")
	if err != nil {
		t.Fatalf("file_links collection: %v", err)
	}
	rel, ok := links.Fields.GetByName("minted_by_token").(*core.RelationField)
	if !ok {
		t.Fatalf("file_links.minted_by_token is missing or not a relation")
	}
	if rel.Required || rel.MaxSelect != 1 || !rel.CascadeDelete || rel.CollectionId != tokens.Id {
		t.Fatalf("minted_by_token field wrong: %+v", rel)
	}

	token := core.NewRecord(tokens)
	token.Set("user", owner.id)
	token.Set("vdir", vdirID)
	token.Set("name", "link source")
	token.Set("role", "viewer")
	token.Set("token_hash", "feedfacefeedface")
	token.Set("token_hint", "sf_v1_abcdef…1234")
	if err := s.App.Save(token); err != nil {
		t.Fatalf("save token: %v", err)
	}

	cookieLink := core.NewRecord(links)
	cookieLink.Set("vdir", vdirID)
	cookieLink.Set("path", "docs/a.txt")
	cookieLink.Set("created_by", owner.id)
	cookieLink.Set("token_hash", "cookielinkhash")
	exp, err := types.ParseDateTime(time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("parse expiry: %v", err)
	}
	cookieLink.Set("expires_at", exp)
	if err := s.App.Save(cookieLink); err != nil {
		t.Fatalf("save cookie link: %v", err)
	}
	if got := cookieLink.GetString("minted_by_token"); got != "" {
		t.Fatalf("cookie-minted link got source token %q, want empty", got)
	}

	tokenLink := core.NewRecord(links)
	tokenLink.Set("vdir", vdirID)
	tokenLink.Set("path", "docs/a.txt")
	tokenLink.Set("created_by", owner.id)
	tokenLink.Set("token_hash", "tokenlinkhash")
	tokenLink.Set("minted_by_token", token.Id)
	tokenLink.Set("expires_at", exp)
	if err := s.App.Save(tokenLink); err != nil {
		t.Fatalf("save token link: %v", err)
	}

	if err := s.App.Delete(token); err != nil {
		t.Fatalf("delete token: %v", err)
	}
	if _, err := s.App.FindRecordById("file_links", tokenLink.Id); err == nil {
		t.Fatalf("token-minted link survived its token's deletion")
	}
	if _, err := s.App.FindRecordById("file_links", cookieLink.Id); err != nil {
		t.Fatalf("cookie-minted link was removed by an unrelated token delete: %v", err)
	}
}

func seedTokenVdir(t *testing.T, s *testapp.Server, owner actor, label string) string {
	t.Helper()
	conn := seedConnection(t, s, owner, label+"-conn")
	st, out := doJSON(t, s, http.MethodPost, vdirBase, owner.token, map[string]any{
		"owner": owner.id, "connection": conn, "name": label, "root_path": "/srv/" + label,
	})
	if st != http.StatusOK {
		t.Fatalf("create vdir %s: status %d body %v", label, st, out)
	}
	return out["id"].(string)
}
