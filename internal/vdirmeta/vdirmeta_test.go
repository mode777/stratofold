package vdirmeta_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/vdirmeta"
)

// seedVdirs creates a connection and two vdirs owned by the seeded
// test user — one public, one not — and returns their ids.
func seedVdirs(tb testing.TB, s *testapp.Server) (pubID, privID string) {
	tb.Helper()

	owner, err := s.App.FindAuthRecordByEmail("users", testapp.TestUserEmail)
	if err != nil {
		tb.Fatalf("seed vdirs: owner: %v", err)
	}
	connections, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		tb.Fatalf("seed vdirs: connections collection: %v", err)
	}
	conn := core.NewRecord(connections)
	conn.Set("owner", owner.Id)
	conn.Set("label", "box")
	conn.Set("host", "127.0.0.1")
	conn.Set("port", 22)
	conn.Set("username", "testuser")
	conn.Set("auth_method", "password")
	conn.Set("password", "not-a-real-secret")
	conn.Set("host_key_fingerprint", "SHA256:"+strings.Repeat("A", 43))
	if err := s.App.Save(conn); err != nil {
		tb.Fatalf("seed vdirs: connection: %v", err)
	}

	vdirs, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		tb.Fatalf("seed vdirs: vdirs collection: %v", err)
	}
	mk := func(name string, public bool) string {
		tb.Helper()
		vd := core.NewRecord(vdirs)
		vd.Set("owner", owner.Id)
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", "/srv/"+strings.ToLower(name))
		vd.Set("is_public", public)
		if err := s.App.Save(vd); err != nil {
			tb.Fatalf("seed vdirs: vdir %s: %v", name, err)
		}
		return vd.Id
	}
	return mk("Public", true), mk("Private", false)
}

func getMeta(tb testing.TB, s *testapp.Server, vdirID string, cookie *http.Cookie) (int, []byte) {
	tb.Helper()
	req, err := http.NewRequest(http.MethodGet, s.BaseURL+"/api/sf/vdirs/"+vdirID+"/meta", nil)
	if err != nil {
		tb.Fatalf("meta request: %v", err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp := s.Do(tb, req)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		tb.Fatalf("meta body: %v", err)
	}
	return resp.StatusCode, body
}

func TestMetaServesPublicVdirAnonymously(t *testing.T) {
	s := testapp.Start(t)
	pubID, privID := seedVdirs(t, s)

	st, body := getMeta(t, s, pubID, nil)
	if st != http.StatusOK {
		t.Fatalf("public meta: status %d, want 200 (body %.200s)", st, body)
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("public meta body: %v", err)
	}
	if out["name"] != "Public" || out["is_public"] != true {
		t.Fatalf("public meta: got %v, want name=Public is_public=true", out)
	}
	// Only the two public fields are ever returned: no owner,
	// connection binding, root path, or anything else.
	if len(out) != 2 {
		t.Fatalf("public meta: response carries extra fields: %v", out)
	}
	raw := string(body)
	if strings.Contains(raw, privID) || strings.Contains(raw, "/srv/public") {
		t.Fatalf("public meta leaks non-public data: %s", raw)
	}
}

func TestMetaHidesNonPublicVdirsFromEveryone(t *testing.T) {
	s := testapp.Start(t)
	_, privID := seedVdirs(t, s)
	cookie := s.LoginSessionCookie(t)

	for name, cookieArg := range map[string]*http.Cookie{"anonymous": nil, "authenticated owner": cookie} {
		t.Run(name, func(t *testing.T) {
			st, body := getMeta(t, s, privID, cookieArg)
			if st != http.StatusNotFound {
				t.Fatalf("non-public meta (%s): status %d, want 404", name, st)
			}
			if strings.Contains(string(body), "Private") {
				t.Fatalf("non-public meta (%s) leaks the vdir name: %s", name, body)
			}
		})
	}
}

func TestMetaUnknownIdIsNotFound(t *testing.T) {
	s := testapp.Start(t)
	seedVdirs(t, s)

	for name, id := range map[string]string{
		"unknown id": "000000000000000",
		"empty id":   "",
		"garbage id": "not-a-record-id",
	} {
		t.Run(name, func(t *testing.T) {
			st, _ := getMeta(t, s, id, nil)
			if st != http.StatusNotFound {
				t.Fatalf("%s: status %d, want 404", name, st)
			}
		})
	}
}

func TestMetaRejectsOtherMethods(t *testing.T) {
	s := testapp.Start(t)
	pubID, _ := seedVdirs(t, s)

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			req, err := http.NewRequest(method, s.BaseURL+"/api/sf/vdirs/"+pubID+"/meta", nil)
			if err != nil {
				t.Fatal(err)
			}
			resp := s.Do(t, req)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			// Never served: either the router's method rejection or a
			// catch-all 404 — but never the metadata and never a
			// mutation of the record.
			if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("%s meta: status %d, want 404/405", method, resp.StatusCode)
			}
			if strings.Contains(string(body), `"name"`) {
				t.Fatalf("%s meta leaked metadata: %s", method, body)
			}
		})
	}
}

func TestCustomRoutesStayInsideSfNamespace(t *testing.T) {
	routes := vdirmeta.CustomRoutes()
	if len(routes) == 0 {
		t.Fatal("no meta routes registered")
	}
	for _, r := range routes {
		if r.Path != "/api/sf/vdirs/{vdirId}/meta" || r.Method != http.MethodGet {
			t.Errorf("unexpected route %s %s", r.Method, r.Path)
		}
		if !strings.HasPrefix(r.Path, "/api/sf/") {
			t.Errorf("meta route %s escaped the /api/sf/ namespace", r.Path)
		}
	}
}
