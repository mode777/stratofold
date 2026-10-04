package userlookup_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/userlookup"
)

// seedUser creates an additional auth user directly on the app.
func seedUser(tb testing.TB, s *testapp.Server, email, password string) *core.Record {
	tb.Helper()
	col, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		tb.Fatalf("users collection: %v", err)
	}
	rec := core.NewRecord(col)
	rec.SetEmail(email)
	rec.SetPassword(password)
	if err := s.App.Save(rec); err != nil {
		tb.Fatalf("seed user %s: %v", email, err)
	}
	return rec
}

func lookup(tb testing.TB, s *testapp.Server, cookie *http.Cookie, rawQuery string) *http.Response {
	tb.Helper()
	req, err := http.NewRequest(http.MethodGet, s.BaseURL+"/api/sf/users/lookup"+rawQuery, nil)
	if err != nil {
		tb.Fatalf("lookup request: %v", err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	return s.Do(tb, req)
}

func TestLookupResolvesExactEmail(t *testing.T) {
	s := testapp.Start(t)
	grantee := seedUser(t, s, "grantee@stratofold.test", "grantee-pass-123")
	cookie := s.LoginSessionCookie(t)

	resp := lookup(t, s, cookie, "?email=grantee@stratofold.test")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lookup: status %d, want 200", resp.StatusCode)
	}
	var out struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.ID != grantee.Id || out.Email != "grantee@stratofold.test" {
		t.Fatalf("lookup: got id=%q email=%q, want %q/grantee@stratofold.test", out.ID, out.Email, grantee.Id)
	}
}

func TestLookupMatchesExactStoredCasingOnly(t *testing.T) {
	s := testapp.Start(t)
	grantee := seedUser(t, s, "Case.User@stratofold.test", "grantee-pass-123")
	cookie := s.LoginSessionCookie(t)

	// PocketBase's users email index is case-sensitive, so the lookup
	// is exact as stored: the stored casing resolves, any other
	// casing is a miss.
	resp := lookup(t, s, cookie, "?email=Case.User@stratofold.test")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stored casing: status %d, want 200", resp.StatusCode)
	}
	var out struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.ID != grantee.Id || out.Email != "Case.User@stratofold.test" {
		t.Fatalf("stored casing: got id=%q email=%q, want %q/Case.User@stratofold.test", out.ID, out.Email, grantee.Id)
	}

	miss := lookup(t, s, cookie, "?email=case.user@stratofold.test")
	defer miss.Body.Close()
	if miss.StatusCode != http.StatusNotFound {
		t.Fatalf("different casing: status %d, want 404", miss.StatusCode)
	}
}

func TestLookupMissIsNotFound(t *testing.T) {
	s := testapp.Start(t)
	cookie := s.LoginSessionCookie(t)

	resp := lookup(t, s, cookie, "?email=nobody@stratofold.test")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("miss: status %d, want 404", resp.StatusCode)
	}
}

func TestLookupRequiresSession(t *testing.T) {
	s := testapp.Start(t)
	seedUser(t, s, "grantee@stratofold.test", "grantee-pass-123")

	resp := lookup(t, s, nil, "?email=grantee@stratofold.test")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous: status %d, want 401", resp.StatusCode)
	}
}

func TestLookupRejectsNonExactQueryShapes(t *testing.T) {
	s := testapp.Start(t)
	seedUser(t, s, "grantee@stratofold.test", "grantee-pass-123")
	cookie := s.LoginSessionCookie(t)

	for name, q := range map[string]string{
		"missing param":     "",
		"empty value":       "?email=",
		"whitespace value":  "?email=%20%20",
		"pagination params": "?email=grantee@stratofold.test&perPage=10",
		"search param":      "?q=grantee",
		"prefix param":      "?filter=grantee",
	} {
		t.Run(name, func(t *testing.T) {
			resp := lookup(t, s, cookie, q)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("%s: status %d, want 400", name, resp.StatusCode)
			}
		})
	}
}

func TestCustomRoutesStayInsideSfNamespace(t *testing.T) {
	routes := userlookup.CustomRoutes()
	if len(routes) == 0 {
		t.Fatal("no lookup routes registered")
	}
	for _, r := range routes {
		if r.Path != "/api/sf/users/lookup" || r.Method != http.MethodGet {
			t.Errorf("unexpected route %s %s", r.Method, r.Path)
		}
	}
}
