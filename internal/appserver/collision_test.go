package appserver_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/filelinks"
	"github.com/mode777/stratofold/internal/fileserver"
	"github.com/mode777/stratofold/internal/fsapi"
	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/userlookup"
	"github.com/mode777/stratofold/internal/vdirmeta"
)

func bodyBytes(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestAllCustomRoutesUnderSfNamespace(t *testing.T) {
	if got := len(authbridge.CustomRoutes()); got == 0 {
		t.Fatal("no custom routes registered")
	}
	for _, r := range authbridge.CustomRoutes() {
		if !strings.HasPrefix(r.Path, "/api/sf/") {
			t.Errorf("custom route %s %s escaped the /api/sf/ namespace", r.Method, r.Path)
		}
	}
}

func TestFilesRoutesStayOutsideEveryApiNamespace(t *testing.T) {
	if got := len(fileserver.CustomRoutes()); got == 0 {
		t.Fatal("no /files routes registered")
	}
	for _, r := range fileserver.CustomRoutes() {
		if strings.HasPrefix(r.Path, "/api/") {
			t.Errorf("/files route %s %s entered the /api/ namespace (PocketBase owns /api/files/*)", r.Method, r.Path)
		}
		if !strings.HasPrefix(r.Path, "/files/") {
			t.Errorf("/files route %s %s is not under /files/", r.Method, r.Path)
		}
	}
}

func TestFileLinksRouteNamespaces(t *testing.T) {
	routes := filelinks.CustomRoutes()
	if len(routes) == 0 {
		t.Fatal("no file-link routes registered")
	}
	for _, r := range routes {
		if strings.HasPrefix(r.Path, "/api/") {
			if !strings.HasPrefix(r.Path, "/api/sf/") {
				t.Errorf("file-link API route %s %s escaped /api/sf/", r.Method, r.Path)
			}
			continue
		}
		if !strings.HasPrefix(r.Path, "/s/") {
			t.Errorf("file-link file route %s %s is not under /s/", r.Method, r.Path)
		}
	}
}

func TestFilesystemApiRoutesStayInsideSfNamespace(t *testing.T) {
	if got := len(fsapi.CustomRoutes()); got == 0 {
		t.Fatal("no filesystem API routes registered")
	}
	for _, r := range fsapi.CustomRoutes() {
		if !strings.HasPrefix(r.Path, "/api/sf/") {
			t.Errorf("filesystem API route %s %s escaped the /api/sf/ namespace", r.Method, r.Path)
		}
	}
}

func TestUserLookupRoutesStayInsideSfNamespace(t *testing.T) {
	if got := len(userlookup.CustomRoutes()); got == 0 {
		t.Fatal("no lookup routes registered")
	}
	for _, r := range userlookup.CustomRoutes() {
		if !strings.HasPrefix(r.Path, "/api/sf/") {
			t.Errorf("lookup route %s %s escaped the /api/sf/ namespace", r.Method, r.Path)
		}
	}
}

func TestVdirMetaRoutesStayInsideSfNamespace(t *testing.T) {
	if got := len(vdirmeta.CustomRoutes()); got == 0 {
		t.Fatal("no vdir-meta routes registered")
	}
	for _, r := range vdirmeta.CustomRoutes() {
		if !strings.HasPrefix(r.Path, "/api/sf/") {
			t.Errorf("vdir-meta route %s %s escaped the /api/sf/ namespace", r.Method, r.Path)
		}
	}
}

func TestBuiltinEndpointsStillBehaveAsBuiltins(t *testing.T) {
	s := testapp.Start(t)

	t.Run("health endpoint", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("/api/health: status %d, want 200", resp.StatusCode)
		}
	})

	t.Run("users builtin auth endpoint", func(t *testing.T) {
		resp := s.PostJSON(t, "/api/collections/users/auth-with-password", map[string]string{
			"identity": testapp.TestUserEmail,
			"password": testapp.TestUserPassword,
		})
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("users auth-with-password: status %d, want 200", resp.StatusCode)
		}
	})

	t.Run("superusers builtin auth endpoint", func(t *testing.T) {
		resp := s.PostJSON(t, "/api/collections/_superusers/auth-with-password", map[string]string{
			"identity": testapp.TestAdminEmail,
			"password": testapp.TestAdminPassword,
		})
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("superusers auth-with-password: status %d, want 200", resp.StatusCode)
		}
	})

	t.Run("api/files record attachment namespace is PocketBase's", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/api/files/missingrecord/missingfile.bin")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("/api/files probe: status %d, want 404", resp.StatusCode)
		}
		if !bytes.Contains(body, []byte(`"status":404`)) {
			t.Fatalf("/api/files probe: not a PocketBase error body: %s", body)
		}
	})

	t.Run("admin dashboard served", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/_/")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("/_/: status %d, want 200", resp.StatusCode)
		}
		body := bodyBytes(t, resp)
		if !bytes.Contains(body, []byte("<!doctype html")) && !bytes.Contains(body, []byte("<!DOCTYPE html")) {
			t.Fatalf("/_/: not the admin UI HTML: %.80s", body)
		}
	})

	t.Run("custom auth route coexists with builtin routes", func(t *testing.T) {
		resp := s.PostJSON(t, "/api/sf/auth", map[string]string{"identity": testapp.TestUserEmail, "password": "definitely-wrong"})
		defer resp.Body.Close()
		var out struct {
			Status int `json:"status"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		if out.Status != http.StatusBadRequest {
			t.Fatalf("/api/sf/auth wrong creds: status %d, want 400", out.Status)
		}
	})

	t.Run("/files/* routes are the file server's, not PocketBase's", func(t *testing.T) {
		// An unknown vdir reaches the file-server handler (message
		// "Not found."), whereas an unrouted path falls through to
		// PocketBase's own 404 ("The requested resource wasn't found.").
		resp, err := http.Get(s.BaseURL + "/files/000000000000000/x")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("/files probe: status %d, want 404", resp.StatusCode)
		}
		if !bytes.Contains(b, []byte(`"message":"Not found."`)) {
			t.Fatalf("/files probe did not reach the file-server handler: %s", b)
		}
	})

	t.Run("/api/sf/vdirs/* routes are the filesystem API's", func(t *testing.T) {
		// An unknown vdir reaches the fsapi handler (message "Not
		// found."); the built-in namespaces still answer as builtins.
		resp := s.PostJSON(t, "/api/sf/vdirs/000000000000000/ls", map[string]string{"path": ""})
		defer resp.Body.Close()
		b := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("fsapi probe: status %d, want 404", resp.StatusCode)
		}
		if !bytes.Contains(b, []byte(`"message":"Not found."`)) {
			t.Fatalf("fsapi probe did not reach the fsapi handler: %s", b)
		}
		resp2, err := http.Get(s.BaseURL + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer resp2.Body.Close()
		if resp2.StatusCode != http.StatusOK {
			t.Fatalf("/api/health after fsapi wiring: status %d", resp2.StatusCode)
		}
	})

	t.Run("/api/sf/users/lookup is the userlookup route's", func(t *testing.T) {
		// An anonymous request reaches the lookup route's session
		// middleware (401 "Authentication required"), whereas an
		// unrouted path falls through to PocketBase's own 404.
		resp, err := http.Get(s.BaseURL + "/api/sf/users/lookup?email=x@y.z")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("lookup probe: status %d, want 401", resp.StatusCode)
		}
		if !bytes.Contains(b, []byte(`"message":"Authentication required.`)) {
			t.Fatalf("lookup probe did not reach the session middleware: %s", b)
		}
		resp3, err := http.Get(s.BaseURL + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer resp3.Body.Close()
		if resp3.StatusCode != http.StatusOK {
			t.Fatalf("/api/health after userlookup wiring: status %d", resp3.StatusCode)
		}
	})

	t.Run("/api/sf/vdirs/*/meta is the vdirmeta route's", func(t *testing.T) {
		// An unknown vdir id reaches the vdirmeta handler (message
		// "Not found.") and is never answered by the SPA fallback
		// (which would return the index.html with 200) or by
		// PocketBase's built-in API 404 (different message).
		resp, err := http.Get(s.BaseURL + "/api/sf/vdirs/000000000000000/meta")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("vdir-meta probe: status %d, want 404", resp.StatusCode)
		}
		if !bytes.Contains(b, []byte(`"message":"Not found."`)) {
			t.Fatalf("vdir-meta probe did not reach the vdirmeta handler: %s", b)
		}
		if bytes.Contains(bytes.ToLower(b), []byte("<!doctype")) {
			t.Fatalf("vdir-meta probe fell through to the SPA shell: %s", b)
		}
		resp4, err := http.Get(s.BaseURL + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer resp4.Body.Close()
		if resp4.StatusCode != http.StatusOK {
			t.Fatalf("/api/health after vdirmeta wiring: status %d", resp4.StatusCode)
		}
	})
}
