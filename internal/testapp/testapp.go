// Package testapp boots the real embedded Stratofold server for tests:
// an isolated PocketBase app (temp SQLite dir, no env or state shared
// with other instances), a seeded regular user and superuser, and a
// live HTTP listener on 127.0.0.1:0.
package testapp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	// system migrations register the schema creation hooks the bare
	// core.NewBaseApp needs at Bootstrap time.
	_ "github.com/pocketbase/pocketbase/migrations"

	"github.com/mode777/stratofold/internal/appserver"
)

const (
	TestUserEmail     = "testuser@stratofold.test"
	TestUserPassword  = "testuser-pass-123"
	TestAdminEmail    = "testadmin@stratofold.test"
	TestAdminPassword = "testadmin-pass-123"
)

// Server is a running test instance.
type Server struct {
	App     core.App
	BaseURL string

	listener net.Listener
}

type bootstrap struct {
	opts   appserver.Options
	setups []func(core.App)
}

// Option mutates the bootstrap options (e.g. appserver timeouts) or
// registers extra hooks on the app before it starts.
type Option func(*bootstrap)

// WithOptions applies raw bootstrap option overrides.
func WithOptions(f func(*appserver.Options)) Option {
	return func(b *bootstrap) { f(&b.opts) }
}

// WithApp registers extra hooks/setup on the app before serving
// (e.g. test-only routes). Called after appserver.Install.
func WithApp(f func(app core.App)) Option {
	return func(b *bootstrap) { b.setups = append(b.setups, f) }
}

// Start boots a fresh server with the production wiring (appserver.Install).
func Start(tb testing.TB, opts ...Option) *Server {
	tb.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		tb.Fatalf("testapp: listener: %v", err)
	}

	b := bootstrap{opts: appserver.Options{DataDir: tb.TempDir(), Listener: ln}}
	for _, opt := range opts {
		opt(&b)
	}

	app := core.NewBaseApp(core.BaseAppConfig{
		DataDir:      b.opts.DataDir,
		QueryTimeout: core.DefaultQueryTimeout,
	})
	appserver.Install(app, b.opts)
	for _, setup := range b.setups {
		setup(app)
	}

	if err := app.Bootstrap(); err != nil {
		tb.Fatalf("testapp: bootstrap: %v", err)
	}

	if err := seedAuthRecord(app, core.CollectionNameSuperusers, TestAdminEmail, TestAdminPassword); err != nil {
		tb.Fatalf("testapp: seed superuser: %v", err)
	}
	if err := seedAuthRecord(app, "users", TestUserEmail, TestUserPassword); err != nil {
		tb.Fatalf("testapp: seed user: %v", err)
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- apis.Serve(app, apis.ServeConfig{
			HttpAddr:        ln.Addr().String(),
			ShowStartBanner: false,
		})
	}()

	s := &Server{App: app, BaseURL: "http://" + ln.Addr().String(), listener: ln}

	waitForHealth(tb, s.BaseURL)

	tb.Cleanup(func() {
		te := new(core.TerminateEvent)
		te.App = app
		if err := app.OnTerminate().Trigger(te, func(e *core.TerminateEvent) error {
			return e.App.ClearBootstrap()
		}); err != nil {
			tb.Errorf("testapp: terminate: %v", err)
		}
		select {
		case err := <-serveErr:
			if err != nil {
				tb.Errorf("testapp: serve: %v", err)
			}
		case <-time.After(5 * time.Second):
			tb.Errorf("testapp: serve did not stop after terminate")
		}
	})

	return s
}

func seedAuthRecord(app core.App, collection, email, password string) error {
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return fmt.Errorf("collection %q: %w", collection, err)
	}
	rec := core.NewRecord(col)
	rec.SetEmail(email)
	rec.SetPassword(password)
	return app.Save(rec)
}

func waitForHealth(tb testing.TB, baseURL string) {
	tb.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(baseURL + "/api/health")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	tb.Fatalf("testapp: server did not become healthy at %s", baseURL)
}

// Do sends an arbitrary request against the server.
func (s *Server) Do(tb testing.TB, req *http.Request) *http.Response {
	tb.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		tb.Fatalf("testapp: %s %s: %v", req.Method, req.URL, err)
	}
	return resp
}

// PostJSON sends a JSON request body and returns the response (caller
// closes the body).
func (s *Server) PostJSON(tb testing.TB, path string, body any) *http.Response {
	tb.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		tb.Fatalf("testapp: marshal: %v", err)
	}
	resp, err := http.Post(s.BaseURL+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		tb.Fatalf("testapp: POST %s: %v", path, err)
	}
	return resp
}

// Delete sends a DELETE with the given cookies (nil slice for none) and
// returns the response (caller closes the body).
func (s *Server) Delete(tb testing.TB, path string, cookies []*http.Cookie) *http.Response {
	tb.Helper()
	req, err := http.NewRequest(http.MethodDelete, s.BaseURL+path, nil)
	if err != nil {
		tb.Fatalf("testapp: delete request: %v", err)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	return s.Do(tb, req)
}

// LoginBody authenticates the seeded test user, returning the parsed
// {token, record} response body.
func (s *Server) LoginBody(tb testing.TB) (token string, record map[string]any) {
	tb.Helper()
	resp := s.PostJSON(tb, "/api/sf/auth", map[string]string{
		"identity": TestUserEmail,
		"password": TestUserPassword,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		tb.Fatalf("testapp: login: status %d", resp.StatusCode)
	}
	var out struct {
		Token  string         `json:"token"`
		Record map[string]any `json:"record"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		tb.Fatalf("testapp: login body: %v", err)
	}
	return out.Token, out.Record
}

// LoginSessionCookie authenticates the seeded test user and returns the
// sf_session cookie from the response.
func (s *Server) LoginSessionCookie(tb testing.TB) *http.Cookie {
	tb.Helper()
	_, resp := s.LoginBodyWithResponse(tb)
	defer resp.Body.Close()
	for _, c := range resp.Cookies() {
		if c.Name == "sf_session" {
			return c
		}
	}
	tb.Fatalf("testapp: login: no sf_session cookie in response")
	return nil
}

// LoginBodyWithResponse is LoginBody keeping the response for its
// headers (caller closes the body).
func (s *Server) LoginBodyWithResponse(tb testing.TB) (string, *http.Response) {
	tb.Helper()
	resp := s.PostJSON(tb, "/api/sf/auth", map[string]string{
		"identity": TestUserEmail,
		"password": TestUserPassword,
	})
	if resp.StatusCode != http.StatusOK {
		tb.Fatalf("testapp: login: status %d", resp.StatusCode)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		tb.Fatalf("testapp: login body: %v", err)
	}
	return out.Token, resp
}
