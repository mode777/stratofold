package appserver_test

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/mode777/stratofold/internal/testapp"
)

// The committed placeholder marks the embedded SPA shell; the real
// Vite build replaces it but keeps the same serving contract.
const placeholderMarker = "Stratofold SPA placeholder"

func TestSPAServing(t *testing.T) {
	s := testapp.Start(t)

	t.Run("shell is served at the site root", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /: status %d, want 200", resp.StatusCode)
		}
		if !bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatalf("GET / did not return the SPA shell: %.120s", body)
		}
	})

	t.Run("built assets are served with their content type", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/assets/app.js")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /assets/app.js: status %d, want 200", resp.StatusCode)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
			t.Fatalf("GET /assets/app.js: content-type %q, want a javascript type", ct)
		}
		if bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatal("GET /assets/app.js returned the SPA shell instead of the asset")
		}
	})

	t.Run("extensionless client routes fall back to the shell", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/vdirs/abc/browse")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /vdirs/abc/browse: status %d, want 200", resp.StatusCode)
		}
		if !bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatalf("client route did not return the SPA shell: %.120s", body)
		}
	})

	t.Run("SPA serving does not shadow server routes", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /api/health: status %d, want 200", resp.StatusCode)
		}
		if bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatal("GET /api/health was answered by the SPA catch-all")
		}
	})

	t.Run("missing asset-like paths are a real 404", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/assets/missing.js")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /assets/missing.js: status %d, want 404", resp.StatusCode)
		}
		if bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatal("missing asset returned the SPA shell")
		}
	})

	t.Run("reserved namespace misses never fall back", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/api/definitely-missing")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /api/definitely-missing: status %d, want 404", resp.StatusCode)
		}
		if bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatal("reserved namespace miss returned the SPA shell")
		}
	})

	t.Run("link namespace misses never fall back", func(t *testing.T) {
		resp, err := http.Get(s.BaseURL + "/s/definitely-missing")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body := bodyBytes(t, resp)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("GET /s/definitely-missing: status %d, want 404", resp.StatusCode)
		}
		if bytes.Contains(body, []byte(placeholderMarker)) {
			t.Fatal("link namespace miss returned the SPA shell")
		}
	})

	t.Run("non-GET methods are rejected with 405", func(t *testing.T) {
		resp, err := http.Post(s.BaseURL+"/some/client/route", "text/plain", strings.NewReader("x"))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, resp.Body)
		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("POST client route: status %d, want 405", resp.StatusCode)
		}
	})
}
