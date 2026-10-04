package authbridge_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/testapp"
)

func withProbeRoute() testapp.Option {
	return testapp.WithApp(func(app core.App) {
		app.OnServe().BindFunc(func(se *core.ServeEvent) error {
			se.Router.GET("/api/sf/probe", func(e *core.RequestEvent) error {
				return e.JSON(http.StatusOK, map[string]string{"id": e.Auth.Id, "email": e.Auth.Email()})
			}).Bind(authbridge.RequireSession())
			return se.Next()
		})
	})
}

func login(t *testing.T, s *testapp.Server, identity, password, forwardedProto string) (string, *http.Response) {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"identity": identity, "password": password})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, s.BaseURL+"/api/sf/auth", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if forwardedProto != "" {
		req.Header.Set("X-Forwarded-Proto", forwardedProto)
	}
	resp := s.Do(t, req)
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	return string(body), resp
}

func setCookies(resp *http.Response) map[string]*http.Cookie {
	out := map[string]*http.Cookie{}
	for _, raw := range resp.Header.Values("Set-Cookie") {
		pair, _, _ := strings.Cut(raw, ";")
		name, value, _ := strings.Cut(pair, "=")
		out[strings.TrimSpace(name)] = &http.Cookie{Name: name, Value: value, Raw: raw}
	}
	return out
}

func TestLoginIssuesTokenAndSessionCookie(t *testing.T) {
	s := testapp.Start(t)

	body, resp := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword, "")

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: status %d, want 200", resp.StatusCode)
	}

	var out struct {
		Token  string `json:"token"`
		Record struct {
			Email string `json:"email"`
		} `json:"record"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("login body %q: %v", body, err)
	}
	if out.Token == "" {
		t.Fatal("login: empty token in body")
	}
	if out.Record.Email != testapp.TestUserEmail {
		t.Fatalf("login: record email %q, want %q", out.Record.Email, testapp.TestUserEmail)
	}

	cookies := setCookies(resp)
	c, ok := cookies[authbridge.SessionCookieName]
	if !ok {
		t.Fatalf("login: no %s Set-Cookie, got %v", authbridge.SessionCookieName, resp.Header.Values("Set-Cookie"))
	}
	if c.Value != out.Token {
		t.Fatalf("login: cookie carries a different token than the body")
	}
	if !strings.Contains(c.Raw, "HttpOnly") {
		t.Errorf("login: cookie not HttpOnly: %s", c.Raw)
	}
	if !strings.Contains(c.Raw, "SameSite=Lax") {
		t.Errorf("login: cookie SameSite not Lax: %s", c.Raw)
	}
	if strings.Contains(c.Raw, "Secure") {
		t.Errorf("login: cookie unexpectedly Secure over plain HTTP: %s", c.Raw)
	}
}

func TestLoginTokenAuthenticatesBuiltinEndpoint(t *testing.T) {
	s := testapp.Start(t)

	body, _ := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword, "")
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}

	req, err := http.NewRequest(http.MethodPost, s.BaseURL+"/api/collections/users/auth-refresh", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", out.Token)
	resp := s.Do(t, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("builtin auth-refresh with login token: status %d, want 200", resp.StatusCode)
	}
}

func TestLoginSetsSecureCookieOverHTTPS(t *testing.T) {
	s := testapp.Start(t)

	_, resp := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword, "https")

	c, ok := setCookies(resp)[authbridge.SessionCookieName]
	if !ok {
		t.Fatalf("login: no %s Set-Cookie", authbridge.SessionCookieName)
	}
	for _, flag := range []string{"HttpOnly", "SameSite=Lax", "Secure"} {
		if !strings.Contains(c.Raw, flag) {
			t.Errorf("login over HTTPS: cookie missing %s: %s", flag, c.Raw)
		}
	}
}

func TestFailedLoginSetsNoSession(t *testing.T) {
	s := testapp.Start(t)

	wrongPassBody, wrongPassResp := login(t, s, testapp.TestUserEmail, "not-the-password", "")
	unknownBody, unknownResp := login(t, s, "who@stratofold.test", "not-the-password", "")

	for name, resp := range map[string]*http.Response{"wrong password": wrongPassResp, "unknown user": unknownResp} {
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
		if cookies := setCookies(resp); len(cookies) != 0 {
			t.Errorf("%s: unexpected Set-Cookie %v", name, resp.Header.Values("Set-Cookie"))
		}
	}

	if wrongPassBody != unknownBody {
		t.Errorf("failed logins are distinguishable:\nwrong password: %s\nunknown user:  %s", wrongPassBody, unknownBody)
	}
}

func TestLogoutInvalidatesSession(t *testing.T) {
	s := testapp.Start(t, withProbeRoute())

	body, loginResp := login(t, s, testapp.TestUserEmail, testapp.TestUserPassword, "")
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	sessionCookie := setCookies(loginResp)[authbridge.SessionCookieName]

	user, err := s.App.FindAuthRecordByEmail(authbridge.UsersCollection, testapp.TestUserEmail)
	if err != nil {
		t.Fatal(err)
	}
	secondToken, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	logoutResp := s.Delete(t, "/api/sf/auth", []*http.Cookie{sessionCookie})
	defer logoutResp.Body.Close()
	if logoutResp.StatusCode != http.StatusOK {
		t.Fatalf("logout: status %d, want 200", logoutResp.StatusCode)
	}
	cleared, ok := setCookies(logoutResp)[authbridge.SessionCookieName]
	if !ok {
		t.Fatalf("logout: no %s Set-Cookie clearing the cookie", authbridge.SessionCookieName)
	}
	if cleared.Value != "" {
		t.Errorf("logout: cleared cookie should have empty value, got %q", cleared.Value)
	}
	if !strings.Contains(cleared.Raw, "Max-Age=0") {
		t.Errorf("logout: cleared cookie should expire immediately: %s", cleared.Raw)
	}

	replay := s.Do(t, func() *http.Request {
		req, err := http.NewRequest(http.MethodGet, s.BaseURL+"/api/sf/probe", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(sessionCookie)
		return req
	}())
	defer replay.Body.Close()
	if replay.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed session cookie after logout: status %d, want 401", replay.StatusCode)
	}

	for name, token := range map[string]string{"login token": out.Token, "second token": secondToken} {
		req, err := http.NewRequest(http.MethodPost, s.BaseURL+"/api/collections/users/auth-refresh", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", token)
		resp := s.Do(t, req)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s after logout on builtin endpoint: status %d, want 401", name, resp.StatusCode)
		}
	}
}

func TestLogoutWithoutSessionRejected(t *testing.T) {
	s := testapp.Start(t)

	resp := s.Delete(t, "/api/sf/auth", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("logout without session: status %d, want 401", resp.StatusCode)
	}
}

func TestCustomRoutesStayInNamespace(t *testing.T) {
	for _, r := range authbridge.CustomRoutes() {
		if !strings.HasPrefix(r.Path, "/api/sf/") {
			t.Errorf("custom route %s %s is outside the /api/sf/ namespace", r.Method, r.Path)
		}
	}
	registered := authbridge.CustomRoutes()
	want := []authbridge.Route{
		{http.MethodPost, "/api/sf/auth"},
		{http.MethodDelete, "/api/sf/auth"},
	}
	if !reflect.DeepEqual(registered, want) {
		t.Errorf("registered routes changed: got %v, want %v", registered, want)
	}
}
