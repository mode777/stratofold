package appserver_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/mode777/stratofold/internal/testapp"
)

// TestCrossOriginPreflightForClientRoutes pins the browser behavior
// @stratofold/client depends on: a foreign origin may preflight the
// bearer JSON and upload requests, and /files exposes the
// representation headers the client reads. PocketBase's global CORS
// middleware provides this; the test fails if a future middleware
// change narrows it.
func TestCrossOriginPreflightForClientRoutes(t *testing.T) {
	s := testapp.Start(t)

	paths := []struct {
		name   string
		path   string
		method string
	}{
		{"list", "/api/sf/vdirs/any/ls", http.MethodPost},
		{"upload", "/api/sf/vdirs/any/upload", http.MethodPost},
		{"link mint", "/api/sf/vdirs/any/links", http.MethodPost},
		{"token scope", "/api/sf/tokens/me", http.MethodGet},
	}

	for _, tc := range paths {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodOptions, s.BaseURL+tc.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Origin", "https://client.example")
			req.Header.Set("Access-Control-Request-Method", tc.method)
			req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusNoContent {
				t.Fatalf("preflight status = %d, want 204", resp.StatusCode)
			}
			if origin := resp.Header.Get("Access-Control-Allow-Origin"); origin != "*" && origin != "https://client.example" {
				t.Fatalf("allow-origin = %q", origin)
			}
			allowed := strings.ToLower(resp.Header.Get("Access-Control-Allow-Headers"))
			for _, header := range []string{"authorization", "content-type"} {
				if !strings.Contains(allowed, header) {
					t.Fatalf("allow-headers = %q, missing %s", allowed, header)
				}
			}
			if methods := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(methods, tc.method) {
				t.Fatalf("allow-methods = %q, missing %s", methods, tc.method)
			}
		})
	}
}

// TestFilesExposeRepresentationHeaders checks the cross-origin header
// list the client reads from a plain file response.
func TestFilesExposeRepresentationHeaders(t *testing.T) {
	s := testapp.Start(t)

	resp, err := http.Get(s.BaseURL + "/files/unknown-vdir/hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	exposed := strings.ToLower(resp.Header.Get("Access-Control-Expose-Headers"))
	for _, header := range []string{"accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified", "content-disposition"} {
		if !strings.Contains(exposed, header) {
			t.Fatalf("expose-headers = %q, missing %s", exposed, header)
		}
	}
}
