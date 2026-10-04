package migrations_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
)

const shareBase = "/api/collections/vdir_shares/records"

// TestVdirSharesSchema pins the sharing collections' shape (task 1.1):
// fields, cascade flags, the unique (vdir, user) index, and the rule
// families. The behavior itself is the matrix below.
func TestVdirSharesSchema(t *testing.T) {
	s := testapp.Start(t)

	shares, err := s.App.FindCollectionByNameOrId("vdir_shares")
	if err != nil {
		t.Fatalf("vdir_shares collection: %v", err)
	}
	fields := map[string]core.Field{}
	for _, f := range shares.Fields {
		fields[f.GetName()] = f
	}
	rel, ok := fields["vdir"].(*core.RelationField)
	if !ok || !rel.Required || rel.MaxSelect != 1 || !rel.CascadeDelete {
		t.Fatalf("vdir field wrong: %+v", fields["vdir"])
	}
	usr, ok := fields["user"].(*core.RelationField)
	if !ok || !usr.Required || usr.MaxSelect != 1 || !usr.CascadeDelete {
		t.Fatalf("user field wrong: %+v", fields["user"])
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
	foundIdx := false
	for _, idx := range shares.Indexes {
		if strings.Contains(idx, "idx_vdir_shares_vdir_user") {
			foundIdx = true
		}
		if !strings.Contains(strings.ToLower(idx), "unique") {
			t.Fatalf("index %q is not UNIQUE", idx)
		}
	}
	if !foundIdx {
		t.Fatalf("unique (vdir, user) index missing: %v", shares.Indexes)
	}
	for name, rule := range map[string]*string{
		"list":   shares.ListRule,
		"view":   shares.ViewRule,
		"create": shares.CreateRule,
		"update": shares.UpdateRule,
		"delete": shares.DeleteRule,
	} {
		if rule == nil || *rule == "" {
			t.Fatalf("%s rule must be set (owner/grantee pinned), got nil/empty", name)
		}
	}
	if !strings.Contains(*shares.UpdateRule, ":isset") {
		t.Fatalf("update rule lacks the rebind guard: %q", *shares.UpdateRule)
	}

	// vdirs reads extend to shared users; mutation rules keep their
	// owner-only shape.
	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	for name, rule := range map[string]*string{"list": vdirs.ListRule, "view": vdirs.ViewRule} {
		if rule == nil || !strings.Contains(*rule, "vdir_shares_via_vdir") {
			t.Fatalf("vdirs %s rule does not grant shared users: %v", name, rule)
		}
	}
	if !strings.Contains(*vdirs.CreateRule, "@request.body.owner = @request.auth.id") {
		t.Fatalf("vdirs create rule changed: %q", *vdirs.CreateRule)
	}
	if !strings.Contains(*vdirs.UpdateRule, ":isset") {
		t.Fatalf("vdirs update rule lost its rebind guard: %q", *vdirs.UpdateRule)
	}
}

// seedUser creates a user record and returns a logged-in actor.
func seedUser(tb testing.TB, s *testapp.Server, email, password string) actor {
	tb.Helper()
	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		tb.Fatalf("users collection: %v", err)
	}
	rec := core.NewRecord(users)
	rec.SetEmail(email)
	rec.SetPassword(password)
	if err := s.App.Save(rec); err != nil {
		tb.Fatalf("seed user %s: %v", email, err)
	}
	return login(tb, s, email, password)
}

// TestVdirShareAuthzMatrix is the record-API permission matrix for the
// sharing model (task 1.2): owner / grantee (viewer, editor) /
// third parties × share CRUD and vdir record reads/mutations.
func TestVdirShareAuthzMatrix(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)
	other := seedUser(t, s, "sharer@stratofold.test", "sharer-pass-123")
	third := seedUser(t, s, "thirduser@stratofold.test", "thirduser-pass-123")
	outsider := seedUser(t, s, "outsider@stratofold.test", "outsider-pass-123")
	anon := actor{name: "anonymous"}

	c1 := seedConnection(t, s, owner, "c1")
	st, out := doJSON(t, s, http.MethodPost, vdirBase, owner.token, map[string]any{
		"owner": owner.id, "connection": c1, "name": "docs", "root_path": "/srv/data",
	})
	if st != http.StatusOK {
		t.Fatalf("create vdir: status %d body %v", st, out)
	}
	v1 := out["id"].(string)
	// A second vdir that stays unshared.
	st, out = doJSON(t, s, http.MethodPost, vdirBase, owner.token, map[string]any{
		"owner": owner.id, "connection": c1, "name": "private", "root_path": "/srv/priv",
	})
	if st != http.StatusOK {
		t.Fatalf("create second vdir: status %d", st)
	}
	v2 := out["id"].(string)

	// --- share creation ---
	st, out = doJSON(t, s, http.MethodPost, shareBase, owner.token, map[string]any{
		"vdir": v1, "user": other.id, "role": "viewer",
	})
	if st != http.StatusOK {
		t.Fatalf("owner grants viewer: status %d body %v", st, out)
	}
	shareOther := out["id"].(string)
	st, out = doJSON(t, s, http.MethodPost, shareBase, owner.token, map[string]any{
		"vdir": v1, "user": third.id, "role": "editor",
	})
	if st != http.StatusOK {
		t.Fatalf("owner grants editor: status %d body %v", st, out)
	}
	shareThird := out["id"].(string)
	_ = shareThird

	// duplicate (vdir, user)
	if st, _ := doJSON(t, s, http.MethodPost, shareBase, owner.token, map[string]any{
		"vdir": v1, "user": other.id, "role": "editor",
	}); st != http.StatusBadRequest {
		t.Fatalf("duplicate share: got %d want 400", st)
	}
	// owner-self share is rejected
	if st, _ := doJSON(t, s, http.MethodPost, shareBase, owner.token, map[string]any{
		"vdir": v1, "user": owner.id, "role": "editor",
	}); st != http.StatusBadRequest {
		t.Fatalf("self share: got %d want 400", st)
	}
	// a non-owner cannot grant shares on a foreign vdir (not even naming themselves)
	if st, _ := doJSON(t, s, http.MethodPost, shareBase, other.token, map[string]any{
		"vdir": v1, "user": other.id, "role": "viewer",
	}); st != http.StatusBadRequest {
		t.Fatalf("grantee self-grants: got %d want 400", st)
	}
	// anonymous cannot create
	if st, _ := doJSON(t, s, http.MethodPost, shareBase, anon.token, map[string]any{
		"vdir": v1, "user": other.id, "role": "viewer",
	}); st != http.StatusBadRequest {
		t.Fatalf("anonymous share create: got %d want 400", st)
	}

	// --- share visibility ---
	// grantees see exactly their own shares
	if st, out := doJSON(t, s, http.MethodGet, shareBase+"/"+shareOther, other.token, nil); st != http.StatusOK {
		t.Fatalf("grantee view own share: got %d (body %v)", st, out)
	}
	if items := listItems(t, s, other, shareBase); len(items) != 1 {
		t.Fatalf("grantee share list: want 1, got %d", len(items))
	}
	if items := listItems(t, s, owner, shareBase); len(items) != 2 {
		t.Fatalf("owner share list: want 2 (vdir owner), got %d", len(items))
	}
	// third parties and anonymous are denied, contents unrevealed
	assertCell(t, s, shareBase, outsider, "view", shareOther, http.StatusNotFound, nil)
	assertCell(t, s, shareBase, anon, "view", shareOther, http.StatusNotFound, nil)
	if items := listItems(t, s, outsider, shareBase); len(items) != 0 {
		t.Fatalf("outsider share list: want 0, got %d", len(items))
	}

	// --- share management stays owner-only ---
	// owner changes the role
	st, _ = doJSON(t, s, http.MethodPatch, shareBase+"/"+shareOther, owner.token, map[string]any{"role": "editor"})
	if st != http.StatusOK {
		t.Fatalf("owner role change: got %d want 200", st)
	}
	st, _ = doJSON(t, s, http.MethodPatch, shareBase+"/"+shareOther, owner.token, map[string]any{"role": "viewer"})
	if st != http.StatusOK {
		t.Fatalf("owner role change back: got %d want 200", st)
	}
	// grantee cannot update or delete the share
	assertCell(t, s, shareBase, other, "update", shareOther, http.StatusNotFound, map[string]any{"role": "editor"})
	assertCell(t, s, shareBase, other, "delete", shareOther, http.StatusNotFound, nil)
	// an update cannot re-point a share at a foreign vdir or at the owner
	connOther := seedConnection(t, s, other, "conn-other")
	st, out = doJSON(t, s, http.MethodPost, vdirBase, other.token, map[string]any{
		"owner": other.id, "connection": connOther, "name": "foreign", "root_path": "/srv/foreign",
	})
	if st != http.StatusOK {
		t.Fatalf("create foreign vdir: status %d", st)
	}
	assertCell(t, s, shareBase, owner, "update", shareOther, http.StatusNotFound, map[string]any{"vdir": out["id"].(string)})
	assertCell(t, s, shareBase, owner, "update", shareOther, http.StatusNotFound, map[string]any{"user": owner.id})

	// --- vdirs record reads extend to shared users ---
	for _, grantee := range []actor{other, third} {
		if st, _ := doJSON(t, s, http.MethodGet, vdirBase+"/"+v1, grantee.token, nil); st != http.StatusOK {
			t.Fatalf("grantee %s vdir view: got %d want 200", grantee.name, st)
		}
	}
	// lists include the shared vdir but not the unshared one
	seen := map[string]bool{}
	for _, item := range listItems(t, s, other, vdirBase) {
		if m, _ := item.(map[string]any); m["id"] != nil {
			seen[m["id"].(string)] = true
		}
	}
	if !seen[v1] || seen[v2] {
		t.Fatalf("grantee vdir list: shared=%v unshared-visible=%v", seen[v1], seen[v2])
	}
	// a user without a share is still denied
	assertCell(t, s, vdirBase, outsider, "view", v1, http.StatusNotFound, nil)
	if items := listItems(t, s, outsider, vdirBase); len(items) != 0 {
		t.Fatalf("outsider vdir list: want 0, got %d", len(items))
	}

	// --- vdir record management stays owner-only, even for grantees ---
	for _, grantee := range []actor{other, third} {
		assertCell(t, s, vdirBase, grantee, "update", v1, http.StatusNotFound, map[string]any{"name": "hijack"})
		assertCell(t, s, vdirBase, grantee, "update", v1, http.StatusNotFound, map[string]any{"is_public": true})
		assertCell(t, s, vdirBase, grantee, "delete", v1, http.StatusNotFound, nil)
	}

	// --- deleting the vdir removes its shares ---
	assertCell(t, s, vdirBase, owner, "delete", v1, http.StatusNoContent, nil)
	remaining, err := s.App.FindRecordsByFilter("vdir_shares", "vdir = {:v}", "", 0, 0, dbx.Params{"v": v1})
	if err != nil {
		t.Fatalf("count shares: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("vdir delete left %d orphan shares", len(remaining))
	}
	assertCell(t, s, shareBase, owner, "view", shareOther, http.StatusNotFound, nil)
}
