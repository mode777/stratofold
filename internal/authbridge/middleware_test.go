package authbridge_test

import (
	"net/http"
	"testing"
	"time"

	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/testapp"
)

func probeGet(t *testing.T, s *testapp.Server, cookieValue string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, s.BaseURL+"/api/sf/probe", nil)
	if err != nil {
		t.Fatal(err)
	}
	if cookieValue != "" {
		req.AddCookie(&http.Cookie{Name: authbridge.SessionCookieName, Value: cookieValue})
	}
	return s.Do(t, req)
}

// expiredSessionToken crafts a correctly signed but already expired
// auth token for the seeded user.
func expiredSessionToken(t *testing.T, s *testapp.Server) string {
	t.Helper()
	user, err := s.App.FindAuthRecordByEmail(authbridge.UsersCollection, testapp.TestUserEmail)
	if err != nil {
		t.Fatal(err)
	}
	col, err := s.App.FindCollectionByNameOrId(authbridge.UsersCollection)
	if err != nil {
		t.Fatal(err)
	}
	secret := user.TokenKey() + col.AuthToken.Secret
	token, err := security.NewJWT(jwt.MapClaims{
		"id":           user.Id,
		"collectionId": col.Id,
		"type":         core.TokenTypeAuth,
	}, secret, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestRequireSessionAnonymousRejected(t *testing.T) {
	s := testapp.Start(t, withProbeRoute())

	resp := probeGet(t, s, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous probe: status %d, want 401", resp.StatusCode)
	}
}

func TestRequireSessionValidCookieAuthenticates(t *testing.T) {
	s := testapp.Start(t, withProbeRoute())

	cookie := s.LoginSessionCookie(t)
	resp := probeGet(t, s, cookie.Value)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid cookie probe: status %d, want 200", resp.StatusCode)
	}
}

func TestRequireSessionExpiredAndForgedRejected(t *testing.T) {
	s := testapp.Start(t, withProbeRoute())

	expired := expiredSessionToken(t, s)
	resp := probeGet(t, s, expired)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired token probe: status %d, want 401", resp.StatusCode)
	}

	forged := probeGet(t, s, "forged.token.value")
	defer forged.Body.Close()
	if forged.StatusCode != http.StatusUnauthorized {
		t.Fatalf("forged token probe: status %d, want 401", forged.StatusCode)
	}
}

func TestRequireSessionIgnoresOtherCookies(t *testing.T) {
	s := testapp.Start(t, withProbeRoute())

	req, err := http.NewRequest(http.MethodGet, s.BaseURL+"/api/sf/probe", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "other_session", Value: "x"})
	resp := s.Do(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong cookie name: status %d, want 401", resp.StatusCode)
	}
}
