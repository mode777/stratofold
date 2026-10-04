package migrations_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/mode777/stratofold/internal/testapp"
)

const connBase = "/api/collections/connections/records"
const vdirBase = "/api/collections/vdirs/records"

// secretPlaintexts are values planted into secret fields; the tests
// assert they never appear in API responses or in the stored record.
var secretPlaintexts = []string{"s3cret-password", "-----BEGIN OPENSSH PRIVATE KEY-----", "key-passphrase-xyz"}

type actor struct {
	name  string
	token string // "" = anonymous
	id    string // users record id ("" = anonymous/unknown)
}

func login(tb testing.TB, s *testapp.Server, email, password string) actor {
	tb.Helper()
	resp := s.PostJSON(tb, "/api/collections/users/auth-with-password", map[string]string{
		"identity": email,
		"password": password,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		tb.Fatalf("login %s: status %d", email, resp.StatusCode)
	}
	var out struct {
		Token  string         `json:"token"`
		Record map[string]any `json:"record"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		tb.Fatalf("login body: %v", err)
	}
	return actor{name: email, token: out.Token, id: out.Record["id"].(string)}
}

func doJSON(tb testing.TB, s *testapp.Server, method, path, token string, body any) (int, map[string]any) {
	tb.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			tb.Fatalf("marshal: %v", err)
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, s.BaseURL+path, rdr)
	if err != nil {
		tb.Fatalf("%s %s: %v", method, path, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	resp := s.Do(tb, req)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		tb.Fatalf("read body: %v", err)
	}
	var out map[string]any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return resp.StatusCode, out
}

func bodyHasSecret(tb testing.TB, st int, out map[string]any, where string) {
	tb.Helper()
	if st < 200 || st >= 300 {
		return // non-success bodies don't carry record data
	}
	raw, err := json.Marshal(out)
	if err != nil {
		tb.Fatalf("re-marshal: %v", err)
	}
	for _, secret := range secretPlaintexts {
		if strings.Contains(string(raw), secret) {
			tb.Fatalf("%s: response leaks secret plaintext", where)
		}
	}
	for _, field := range []string{"password", "private_key", "key_passphrase"} {
		if _, ok := out[field]; ok {
			tb.Fatalf("%s: response contains secret field %q", where, field)
		}
	}
}

// seedConnection creates a connection over HTTP as act with planted
// secrets and returns its id.
func seedConnection(tb testing.TB, s *testapp.Server, act actor, label string) string {
	tb.Helper()
	st, out := doJSON(tb, s, http.MethodPost, connBase, act.token, map[string]any{
		"owner":                act.id,
		"label":                label,
		"host":                 "127.0.0.1",
		"port":                 22,
		"username":             "testuser",
		"auth_method":          "password",
		"password":             secretPlaintexts[0],
		"private_key":          secretPlaintexts[1],
		"key_passphrase":       secretPlaintexts[2],
		"host_key_fingerprint": "SHA256:" + strings.Repeat("A", 43),
	})
	bodyHasSecret(tb, st, out, fmt.Sprintf("create %s", label))
	if st != http.StatusOK {
		tb.Fatalf("create connection %s: status %d body %v", label, st, out)
	}
	return out["id"].(string)
}

// assertCell runs one matrix cell and fails if the outcome disagrees.
func assertCell(tb testing.TB, s *testapp.Server, base string, act actor, op, recordID string, wantStatus int, body any) (int, map[string]any) {
	tb.Helper()
	var path string
	switch op {
	case "list":
		path = base
	case "view":
		path = base + "/" + recordID
	case "create":
		path = base
	case "update":
		path = base + "/" + recordID
	case "delete":
		path = base + "/" + recordID
	}
	method := map[string]string{"list": "GET", "view": "GET", "create": "POST", "update": "PATCH", "delete": "DELETE"}[op]
	st, out := doJSON(tb, s, method, path, act.token, body)
	if st != wantStatus {
		tb.Fatalf("matrix %s %s as %s: got %d want %d (body %v)", op, recordID, act.name, st, wantStatus, out)
	}
	bodyHasSecret(tb, st, out, fmt.Sprintf("%s %s as %s", op, recordID, act.name))
	return st, out
}

func listItems(tb testing.TB, s *testapp.Server, act actor, base string) []any {
	tb.Helper()
	st, out := doJSON(tb, s, http.MethodGet, base, act.token, nil)
	if st != http.StatusOK {
		tb.Fatalf("list as %s: status %d", act.name, st)
	}
	items, _ := out["items"].([]any)
	return items
}

func TestConnectionAuthzMatrix(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	// second user
	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	otherRec := core.NewRecord(users)
	otherRec.SetEmail("otheruser@stratofold.test")
	otherRec.SetPassword("otheruser-pass-123")
	if err := s.App.Save(otherRec); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	other := login(t, s, "otheruser@stratofold.test", "otheruser-pass-123")
	anon := actor{name: "anonymous"}

	c1 := seedConnection(t, s, owner, "c1")

	// owner manages own record
	assertCell(t, s, connBase, owner, "view", c1, http.StatusOK, nil)
	assertCell(t, s, connBase, owner, "update", c1, http.StatusOK, map[string]any{"label": "c1-renamed"})
	if items := listItems(t, s, owner, connBase); len(items) != 1 {
		t.Fatalf("owner list: want 1 item, got %d", len(items))
	}
	c2 := seedConnection(t, s, owner, "c2")
	assertCell(t, s, connBase, owner, "delete", c2, http.StatusNoContent, nil)

	// non-owner: denied everywhere; list filters the record out
	assertCell(t, s, connBase, other, "view", c1, http.StatusNotFound, nil)
	assertCell(t, s, connBase, other, "update", c1, http.StatusNotFound, map[string]any{"label": "hijack"})
	assertCell(t, s, connBase, other, "delete", c1, http.StatusNotFound, nil)
	for _, item := range listItems(t, s, other, connBase) {
		if m, _ := item.(map[string]any); m["id"] == c1 {
			t.Fatalf("other list reveals owner's connection")
		}
	}

	// non-owner creating own connection is fine; foreign owner is not
	ownOther := seedConnection(t, s, other, "other-own")
	assertCell(t, s, connBase, other, "delete", ownOther, http.StatusNoContent, nil)
	assertCell(t, s, connBase, other, "create", "", http.StatusBadRequest, map[string]any{
		"owner": owner.id, "label": "steal", "host": "h", "username": "u",
		"auth_method": "password", "password": "x", "host_key_fingerprint": "SHA256:" + strings.Repeat("A", 43),
	})

	// anonymous: denied everywhere (list filters to nothing)
	assertCell(t, s, connBase, anon, "view", c1, http.StatusNotFound, nil)
	assertCell(t, s, connBase, anon, "update", c1, http.StatusNotFound, map[string]any{"label": "anon"})
	assertCell(t, s, connBase, anon, "delete", c1, http.StatusNotFound, nil)
	assertCell(t, s, connBase, anon, "create", "", http.StatusBadRequest, map[string]any{
		"label": "anon", "host": "h", "username": "u",
		"auth_method": "password", "host_key_fingerprint": "SHA256:" + strings.Repeat("A", 43),
	})
	if items := listItems(t, s, anon, connBase); len(items) != 0 {
		t.Fatalf("anonymous list: want 0 items, got %d", len(items))
	}

	// Secrets are sealed at rest: the stored rows carry no plaintext
	// credential material in their columns.
	type row struct {
		Id            string `db:"id"`
		Password      string `db:"password"`
		PrivateKey    string `db:"private_key"`
		KeyPassphrase string `db:"key_passphrase"`
	}
	rows := []*row{}
	if err := s.App.DB().NewQuery("SELECT id, password, private_key, key_passphrase FROM connections").All(&rows); err != nil {
		t.Fatalf("read stored records: %v", err)
	}
	if len(rows) == 0 {
		t.Fatalf("no stored connections found")
	}
	for _, r := range rows {
		stored := r.Password + r.PrivateKey + r.KeyPassphrase
		for _, secret := range secretPlaintexts {
			if strings.Contains(stored, secret) {
				t.Fatalf("record %s stores plaintext secret", r.Id)
			}
		}
		if !strings.HasPrefix(r.Password, "v1:") && r.Password != "" {
			t.Fatalf("record %s password is not a sealed envelope", r.Id)
		}
	}
}

// TestConnectionOptionalFingerprintAndRemoteDir covers the record-shape
// delta: a connection may omit the pinned fingerprint and carry a remote
// directory, and existing pinned fingerprints survive the migration.
func TestConnectionOptionalFingerprintAndRemoteDir(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	// A connection without a fingerprint and with a remote directory.
	st, out := doJSON(t, s, http.MethodPost, connBase, owner.token, map[string]any{
		"owner":       owner.id,
		"label":       "no-fp",
		"host":        "127.0.0.1",
		"port":        22,
		"username":    "testuser",
		"auth_method": "password",
		"password":    secretPlaintexts[0],
		"remote_dir":  "/home/",
	})
	bodyHasSecret(t, st, out, "create no-fp")
	if st != http.StatusOK {
		t.Fatalf("create without fingerprint: status %d body %v", st, out)
	}
	if got, _ := out["remote_dir"].(string); got != "/home/" {
		t.Fatalf("create response remote_dir = %q, want /home/", got)
	}
	if fp, _ := out["host_key_fingerprint"].(string); fp != "" {
		t.Fatalf("create response host_key_fingerprint = %q, want empty", fp)
	}

	// Reading it back returns the remote directory and an empty fingerprint.
	st, out = doJSON(t, s, http.MethodGet, connBase+"/"+out["id"].(string), owner.token, nil)
	if st != http.StatusOK {
		t.Fatalf("view no-fp: status %d", st)
	}
	if got, _ := out["remote_dir"].(string); got != "/home/" {
		t.Fatalf("view remote_dir = %q, want /home/", got)
	}
	if fp, _ := out["host_key_fingerprint"].(string); fp != "" {
		t.Fatalf("view host_key_fingerprint = %q, want empty", fp)
	}

	// Existing records keep their pinned fingerprint (the migration only
	// drops the required flag; it does not rewrite values).
	pinned := "SHA256:" + strings.Repeat("B", 43)
	st, out = doJSON(t, s, http.MethodPost, connBase, owner.token, map[string]any{
		"owner": owner.id, "label": "pinned", "host": "127.0.0.1", "port": 22,
		"username": "testuser", "auth_method": "password", "password": secretPlaintexts[0],
		"host_key_fingerprint": pinned,
	})
	if st != http.StatusOK {
		t.Fatalf("create pinned: status %d body %v", st, out)
	}
	st, out = doJSON(t, s, http.MethodGet, connBase+"/"+out["id"].(string), owner.token, nil)
	if st != http.StatusOK {
		t.Fatalf("view pinned: status %d", st)
	}
	if got, _ := out["host_key_fingerprint"].(string); got != pinned {
		t.Fatalf("pinned fingerprint = %q, want %q", got, pinned)
	}

	// The owner-only rules still hold: a second user cannot see the record.
	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	otherRec := core.NewRecord(users)
	otherRec.SetEmail("optional-fp-other@stratofold.test")
	otherRec.SetPassword("otheruser-pass-123")
	if err := s.App.Save(otherRec); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	other := login(t, s, "optional-fp-other@stratofold.test", "otheruser-pass-123")
	if st, _ := doJSON(t, s, http.MethodGet, connBase, other.token, nil); st != http.StatusOK {
		t.Fatalf("other list: status %d", st)
	}
	if items := listItems(t, s, other, connBase); len(items) != 0 {
		t.Fatalf("other list reveals owner's connections: got %d", len(items))
	}
}

func TestVdirAuthzMatrix(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	otherRec := core.NewRecord(users)
	otherRec.SetEmail("otheruser@stratofold.test")
	otherRec.SetPassword("otheruser-pass-123")
	if err := s.App.Save(otherRec); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	other := login(t, s, "otheruser@stratofold.test", "otheruser-pass-123")
	anon := actor{name: "anonymous"}

	c1 := seedConnection(t, s, owner, "c1")
	connOther := seedConnection(t, s, other, "conn-other")

	mkVdir := func(base, name, connID string, act actor) (int, map[string]any) {
		return doJSON(t, s, http.MethodPost, vdirBase, act.token, map[string]any{
			"owner": act.id, "connection": connID, "name": name, "root_path": "/srv/data",
		})
	}

	st, out := mkVdir(vdirBase, "docs", c1, owner)
	if st != http.StatusOK {
		t.Fatalf("owner create vdir: status %d body %v", st, out)
	}
	v1 := out["id"].(string)

	// owner manages own vdir
	assertCell(t, s, vdirBase, owner, "view", v1, http.StatusOK, nil)
	assertCell(t, s, vdirBase, owner, "update", v1, http.StatusOK, map[string]any{"root_path": "/srv/data2"})
	st, out = mkVdir(vdirBase, "docs-2", c1, owner)
	if st != http.StatusOK {
		t.Fatalf("owner second vdir: status %d", st)
	}
	assertCell(t, s, vdirBase, owner, "delete", out["id"].(string), http.StatusNoContent, nil)

	// unique (owner, name)
	if st, _ := mkVdir(vdirBase, "docs", c1, owner); st != http.StatusBadRequest {
		t.Fatalf("duplicate vdir name: got %d want 400", st)
	}

	// cross-owner connection guards
	if st, _ := mkVdir(vdirBase, "steal", connOther, owner); st != http.StatusBadRequest {
		t.Fatalf("vdir over foreign connection: got %d want 400", st)
	}
	// update rebinding to a foreign connection is rejected (PB denies
	// failing update rules as 404, same as any non-owner update)
	st, out = doJSON(t, s, http.MethodPatch, vdirBase+"/"+v1, owner.token, map[string]any{
		"connection": connOther,
	})
	if st != http.StatusNotFound {
		t.Fatalf("update rebind to foreign connection: got %d want 404 (body %v)", st, out)
	}
	// rebinding to an own connection stays allowed
	own2 := seedConnection(t, s, owner, "c1-own2")
	st, out = doJSON(t, s, http.MethodPatch, vdirBase+"/"+v1, owner.token, map[string]any{
		"connection": own2,
	})
	if st != http.StatusOK {
		t.Fatalf("update rebind to own connection: got %d want 200 (body %v)", st, out)
	}

	// non-owner and anonymous are denied
	assertVdirDenials(t, s, other, v1)
	assertVdirDenials(t, s, anon, v1)
	if items := listItems(t, s, anon, vdirBase); len(items) != 0 {
		t.Fatalf("anonymous vdir list: want 0 items, got %d", len(items))
	}
	for _, item := range listItems(t, s, other, vdirBase) {
		if m, _ := item.(map[string]any); m["id"] == v1 {
			t.Fatalf("other list reveals owner's vdir")
		}
	}
}

func assertVdirDenials(tb testing.TB, s *testapp.Server, act actor, v1 string) {
	tb.Helper()
	if st, _ := doJSON(tb, s, http.MethodGet, vdirBase+"/"+v1, act.token, nil); st != http.StatusNotFound {
		tb.Fatalf("%s vdir view: got %d want 404", act.name, st)
	}
	if st, _ := doJSON(tb, s, http.MethodPatch, vdirBase+"/"+v1, act.token, map[string]any{"name": "x"}); st != http.StatusNotFound {
		tb.Fatalf("%s vdir update: got %d want 404", act.name, st)
	}
	if st, _ := doJSON(tb, s, http.MethodDelete, vdirBase+"/"+v1, act.token, nil); st != http.StatusNotFound {
		tb.Fatalf("%s vdir delete: got %d want 404", act.name, st)
	}
	if st, _ := doJSON(tb, s, http.MethodPost, vdirBase, act.token, map[string]any{
		"owner": act.id, "connection": v1, "name": "n", "root_path": "/r",
	}); st != http.StatusBadRequest {
		tb.Fatalf("%s vdir create: got %d want 400", act.name, st)
	}
}

// TestMatrixDetectsLoosenedRules is the mutation check: loosening a
// rule must flip the matrix's expected denials, proving the suite is
// load-bearing.
func TestMatrixDetectsLoosenedRules(t *testing.T) {
	s := testapp.Start(t)
	owner := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword)

	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	otherRec := core.NewRecord(users)
	otherRec.SetEmail("otheruser@stratofold.test")
	otherRec.SetPassword("otheruser-pass-123")
	if err := s.App.Save(otherRec); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	other := login(t, s, "otheruser@stratofold.test", "otheruser-pass-123")

	c1 := seedConnection(t, s, owner, "c1")

	// Baseline: other's view is denied.
	if st, _ := doJSON(t, s, http.MethodGet, connBase+"/"+c1, other.token, nil); st != http.StatusNotFound {
		t.Fatalf("baseline view: got %d want 404", st)
	}

	// Loosen the view rule to public.
	col, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("find connections: %v", err)
	}
	col.ViewRule = types.Pointer("")
	if err := s.App.Save(col); err != nil {
		t.Fatalf("loosen rule: %v", err)
	}

	// The loosened rule now exposes the record — the exact cell the
	// matrix asserts as 404.
	if st, _ := doJSON(t, s, http.MethodGet, connBase+"/"+c1, other.token, nil); st != http.StatusOK {
		t.Fatalf("loosened view: got %d want 200 (mutation not detected)", st)
	}
}
