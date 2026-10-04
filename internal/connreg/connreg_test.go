package connreg_test

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/connreg"
	"github.com/mode777/stratofold/internal/ssherr"
	"github.com/mode777/stratofold/internal/testapp"
)

// createConnection persists a connection record via the app (the
// sealing hooks run on Save) and returns its id.
func createConnection(tb testing.TB, s *testapp.Server, host string) string {
	tb.Helper()
	_, rec := s.LoginBody(tb)
	col, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		tb.Fatalf("connections collection: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("owner", rec["id"])
	r.Set("label", "lbl-"+host)
	r.Set("host", host)
	r.Set("port", 22)
	r.Set("username", "testuser")
	r.Set("auth_method", "password")
	r.Set("password", "plaintext-pw")
	r.Set("host_key_fingerprint", "SHA256:"+strings.Repeat("A", 43))
	if err := s.App.Save(r); err != nil {
		tb.Fatalf("save connection: %v", err)
	}
	return r.Id
}

func TestManagerSharedPerRecord(t *testing.T) {
	s := testapp.Start(t)
	id := createConnection(t, s, "127.0.0.1")

	reg := connreg.FromApp(s.App)
	if reg == nil {
		t.Fatalf("registry not registered on app")
	}
	m1, err := reg.Manager(id)
	if err != nil {
		t.Fatalf("Manager: %v", err)
	}
	m2, err := reg.Manager(id)
	if err != nil {
		t.Fatalf("Manager: %v", err)
	}
	if m1 != m2 {
		t.Fatalf("same record returned different managers")
	}
	if cfg := m1.Config(); cfg.Host != "127.0.0.1" || cfg.Password != "plaintext-pw" {
		t.Fatalf("unexpected config: host=%q pw=%q", cfg.Host, cfg.Password)
	}
}

func TestUpdateReplacesManager(t *testing.T) {
	s := testapp.Start(t)
	id := createConnection(t, s, "127.0.0.1")
	reg := connreg.FromApp(s.App)

	m1, err := reg.Manager(id)
	if err != nil {
		t.Fatalf("Manager: %v", err)
	}

	rec, err := s.App.FindRecordById("connections", id)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	rec.Set("host", "10.1.2.3")
	if err := s.App.Save(rec); err != nil {
		t.Fatalf("update: %v", err)
	}

	m2, err := reg.Manager(id)
	if err != nil {
		t.Fatalf("Manager after update: %v", err)
	}
	if m1 == m2 {
		t.Fatalf("manager not replaced after record update")
	}
	if cfg := m2.Config(); cfg.Host != "10.1.2.3" {
		t.Fatalf("manager config stale: host=%q", cfg.Host)
	}
}

func TestDeleteDropsManager(t *testing.T) {
	s := testapp.Start(t)
	id := createConnection(t, s, "127.0.0.1")
	reg := connreg.FromApp(s.App)

	if _, err := reg.Manager(id); err != nil {
		t.Fatalf("Manager: %v", err)
	}
	rec, err := s.App.FindRecordById("connections", id)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if err := s.App.Delete(rec); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := reg.Manager(id); err == nil {
		t.Fatalf("manager built for deleted record")
	}
}

func TestUnsealFailureIsPermanent(t *testing.T) {
	s := testapp.Start(t)
	id := createConnection(t, s, "127.0.0.1")
	reg := connreg.FromApp(s.App)

	// Corrupt the stored envelope behind the hooks' back.
	if _, err := s.App.DB().NewQuery("UPDATE connections SET password = {:v} WHERE id = {:id}").
		Bind(map[string]any{"v": "v1:garbage", "id": id}).Execute(); err != nil {
		t.Fatalf("corrupt: %v", err)
	}
	reg.Invalidate(id)

	_, err := reg.Manager(id)
	if err == nil {
		t.Fatalf("unseal failure not surfaced")
	}
	if !ssherr.IsPermanent(err) {
		t.Fatalf("unseal failure not classified permanent: %v", err)
	}
}

func TestCloseAll(t *testing.T) {
	s := testapp.Start(t)
	id := createConnection(t, s, "127.0.0.1")
	reg := connreg.FromApp(s.App)

	if _, err := reg.Manager(id); err != nil {
		t.Fatalf("Manager: %v", err)
	}
	reg.CloseAll()
	// A subsequent Manager call rebuilds from scratch (no cached entry).
	rec, err := s.App.FindRecordById("connections", id)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	rec.Set("host", "10.9.9.9")
	if err := s.App.Save(rec); err != nil {
		t.Fatalf("resave: %v", err)
	}
	m, err := connreg.FromApp(s.App).Manager(id)
	if err != nil {
		t.Fatalf("Manager after CloseAll: %v", err)
	}
	if cfg := m.Config(); cfg.Host != "10.9.9.9" {
		t.Fatalf("stale manager survived CloseAll: host=%q", cfg.Host)
	}
}
