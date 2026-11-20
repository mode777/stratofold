// Change add-pretty-public-urls: the vdirs public-name schema and the
// record-rule matrix around it. The behavior surface is tested in
// internal/publicurls; this file pins the data model, ownership, global
// uniqueness, and release semantics.
package migrations_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
)

func TestVdirPublicSlugSchema(t *testing.T) {
	s := testapp.Start(t)

	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	var field *core.TextField
	for _, f := range vdirs.Fields {
		if f.GetName() == "public_slug" {
			field, _ = f.(*core.TextField)
		}
	}
	if field == nil {
		t.Fatal("vdirs.public_slug field missing")
	}
	if field.Required || field.Min != 2 || field.Max != 63 {
		t.Fatalf("public_slug field wrong: %+v", field)
	}
	if field.Pattern != `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` {
		t.Fatalf("public_slug pattern = %q", field.Pattern)
	}

	found := false
	for _, idx := range vdirs.Indexes {
		if !strings.Contains(idx, "idx_vdirs_public_slug") {
			continue
		}
		found = true
		if !strings.Contains(strings.ToLower(idx), "unique") {
			t.Fatalf("public_slug index is not UNIQUE: %q", idx)
		}
		if !strings.Contains(idx, "public_slug != ''") {
			t.Fatalf("public_slug index lacks the partial WHERE clause: %q", idx)
		}
	}
	if !found {
		t.Fatalf("public_slug unique index missing: %v", vdirs.Indexes)
	}
}

func TestVdirPublicSlugMatrix(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	mkUser := func(email string) actor {
		rec := core.NewRecord(users)
		rec.SetEmail(email)
		rec.SetPassword("extra-pass-123")
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("seed user %s: %v", email, err)
		}
		return login(t, s, email, "extra-pass-123")
	}
	viewer := mkUser("public-slug-viewer@stratofold.test")
	editor := mkUser("public-slug-editor@stratofold.test")
	other := mkUser("public-slug-other@stratofold.test")
	anon := actor{name: "anonymous"}

	conn := seedConnection(t, s, owner, "slug-conn")
	otherConn := seedConnection(t, s, other, "slug-other-conn")

	create := func(act actor, connID, name, slug string) (int, map[string]any) {
		body := map[string]any{
			"owner": act.id, "connection": connID, "name": name, "root_path": "/srv/" + name,
		}
		if slug != "" {
			body["public_slug"] = slug
		}
		return doJSON(t, s, http.MethodPost, vdirBase, act.token, body)
	}

	// Owner claims a name; many unnamed vdirs coexist.
	st, out := create(owner, conn, "named", "my-folder")
	if st != http.StatusOK {
		t.Fatalf("create named vdir: status %d body %v", st, out)
	}
	namedID := out["id"].(string)
	if out["public_slug"] != "my-folder" {
		t.Fatalf("created public_slug = %v, want my-folder", out["public_slug"])
	}
	for _, name := range []string{"unnamed-a", "unnamed-b"} {
		if st, out := create(owner, conn, name, ""); st != http.StatusOK {
			t.Fatalf("create %s: status %d body %v", name, st, out)
		}
	}

	// Valid edge names are accepted.
	for _, slug := range []string{"ab", "a-b", "0-0", strings.Repeat("a", 63)} {
		st, out := create(owner, conn, "valid-"+slug, slug)
		if st != http.StatusOK {
			t.Fatalf("valid slug %q: status %d body %v", slug, st, out)
		}
	}

	// Invalid grammar is rejected by the field validators.
	invalid := []string{
		"A", "My-Folder", "a_b", "a.b", "a/b", "a b", "ä", "-lead", "trail-", "a", strings.Repeat("a", 64),
	}
	for _, slug := range invalid {
		st, out := create(owner, conn, "invalid-"+slug, slug)
		if st != http.StatusBadRequest {
			t.Fatalf("invalid slug %q: status %d, want 400 (body %v)", slug, st, out)
		}
	}

	// Global uniqueness: another owner cannot claim the same name, and
	// the rejection is a field error on public_slug.
	st, out = create(other, otherConn, "other-named", "my-folder")
	if st != http.StatusBadRequest {
		t.Fatalf("duplicate across owners: status %d, want 400 (body %v)", st, out)
	}
	data, _ := out["data"].(map[string]any)
	if _, ok := data["public_slug"]; !ok {
		t.Fatalf("duplicate response lacks a public_slug field error: %v", out)
	}

	// Rename frees the old name immediately; the other owner can claim it.
	st, out = doJSON(t, s, http.MethodPatch, vdirBase+"/"+namedID, owner.token, map[string]any{
		"public_slug": "renamed-folder",
	})
	if st != http.StatusOK || out["public_slug"] != "renamed-folder" {
		t.Fatalf("rename: status %d body %v", st, out)
	}
	st, out = create(other, otherConn, "other-claims-old", "my-folder")
	if st != http.StatusOK {
		t.Fatalf("claim freed name: status %d body %v", st, out)
	}

	// Owner-only management: shares grant reads, never record updates.
	for _, user := range []actor{viewer, editor} {
		role := "viewer"
		if user.name == editor.name {
			role = "editor"
		}
		st, out := doJSON(t, s, http.MethodPost, shareBase, owner.token, map[string]any{
			"vdir": namedID, "user": user.id, "role": role,
		})
		if st != http.StatusOK {
			t.Fatalf("create %s share: status %d body %v", role, st, out)
		}
	}
	for _, act := range []actor{viewer, editor, other, anon} {
		st, _ := doJSON(t, s, http.MethodPatch, vdirBase+"/"+namedID, act.token, map[string]any{
			"public_slug": "stolen-name",
		})
		if st != http.StatusNotFound {
			t.Fatalf("%s slug update: status %d, want 404", act.name, st)
		}
	}
	st, out = doJSON(t, s, http.MethodGet, vdirBase+"/"+namedID, owner.token, nil)
	if st != http.StatusOK || out["public_slug"] != "renamed-folder" {
		t.Fatalf("name changed after denied writes: status %d body %v", st, out)
	}

	// Clearing releases the name, and another owner may register it.
	st, out = doJSON(t, s, http.MethodPatch, vdirBase+"/"+namedID, owner.token, map[string]any{
		"public_slug": "",
	})
	if st != http.StatusOK || out["public_slug"] != "" {
		t.Fatalf("clear slug: status %d body %v", st, out)
	}
	st, out = create(other, otherConn, "other-reclaims", "renamed-folder")
	if st != http.StatusOK {
		t.Fatalf("reclaim cleared name: status %d body %v", st, out)
	}

	// Deleting a vdir frees its name.
	st, out = create(owner, conn, "to-delete", "freed-by-delete")
	if st != http.StatusOK {
		t.Fatalf("create delete candidate: status %d body %v", st, out)
	}
	deleteID := out["id"].(string)
	if st, _ := doJSON(t, s, http.MethodDelete, vdirBase+"/"+deleteID, owner.token, nil); st != http.StatusNoContent {
		t.Fatalf("delete vdir: status %d", st)
	}
	st, out = create(other, otherConn, "after-delete", "freed-by-delete")
	if st != http.StatusOK {
		t.Fatalf("claim name after delete: status %d body %v", st, out)
	}
}
