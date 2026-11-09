package vdirtokens_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/testssh"
	"github.com/mode777/stratofold/internal/vdirtokens"
)

type routeEnv struct {
	s      *testapp.Server
	f      *testssh.Fixture
	privID string
	pubID  string

	ownerID  string
	viewerID string
	editorID string
	otherID  string

	owner  *http.Cookie
	viewer *http.Cookie
	editor *http.Cookie
	other  *http.Cookie
}

func routeSetup(t *testing.T) *routeEnv {
	t.Helper()
	f := testssh.Start(t, testssh.Options{Mode: testssh.ModeInproc})
	s := testapp.Start(t)
	_, ownerRec := s.LoginBody(t)
	ownerID := ownerRec["id"].(string)
	ownerCookie := s.LoginSessionCookie(t)

	connCol, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", ownerID)
	conn.Set("label", "tokens")
	conn.Set("host", f.Host)
	conn.Set("port", f.Port)
	conn.Set("username", f.User)
	conn.Set("auth_method", "password")
	conn.Set("password", f.Password)
	conn.Set("host_key_fingerprint", f.Fingerprint)
	if err := s.App.Save(conn); err != nil {
		t.Fatalf("save connection: %v", err)
	}
	vdirCol, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	mkVdir := func(name string, pub bool) *core.Record {
		vd := core.NewRecord(vdirCol)
		vd.Set("owner", ownerID)
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", f.Path("sandbox"))
		vd.Set("is_public", pub)
		if err := s.App.Save(vd); err != nil {
			t.Fatalf("save vdir %s: %v", name, err)
		}
		return vd
	}
	priv := mkVdir("private", false)
	pub := mkVdir("public", true)

	usersCol, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	mkUser := func(email string) *core.Record {
		t.Helper()
		rec := core.NewRecord(usersCol)
		rec.SetEmail(email)
		rec.SetPassword("extra-pass-123")
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("seed user %s: %v", email, err)
		}
		return rec
	}
	viewer := mkUser("tokens-viewer@stratofold.test")
	editor := mkUser("tokens-editor@stratofold.test")
	other := mkUser("tokens-other@stratofold.test")
	shares, err := s.App.FindCollectionByNameOrId("vdir_shares")
	if err != nil {
		t.Fatalf("vdir_shares collection: %v", err)
	}
	mkShare := func(userID, role string) {
		rec := core.NewRecord(shares)
		rec.Set("vdir", priv.Id)
		rec.Set("user", userID)
		rec.Set("role", role)
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("save share %s: %v", role, err)
		}
	}
	mkShare(viewer.Id, "viewer")
	mkShare(editor.Id, "editor")

	return &routeEnv{
		s: s, f: f, privID: priv.Id, pubID: pub.Id,
		ownerID: ownerID, viewerID: viewer.Id, editorID: editor.Id, otherID: other.Id,
		owner: ownerCookie, viewer: cookieFor(t, s, viewer.Id),
		editor: cookieFor(t, s, editor.Id), other: cookieFor(t, s, other.Id),
	}
}

func cookieFor(t *testing.T, s *testapp.Server, userID string) *http.Cookie {
	t.Helper()
	rec, err := s.App.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	tok, err := rec.NewAuthToken()
	if err != nil {
		t.Fatalf("user token: %v", err)
	}
	return &http.Cookie{Name: "sf_session", Value: tok}
}

func routeDo(t *testing.T, s *testapp.Server, method, path string, body any, cookie *http.Cookie, bearer string) (int, map[string]any) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, s.BaseURL+path, rdr)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp := s.Do(t, req)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var out map[string]any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return resp.StatusCode, out
}

func mintToken(t *testing.T, s *testapp.Server, cookie *http.Cookie, vdir, name, role, expires string) (int, map[string]any) {
	t.Helper()
	body := map[string]any{"vdir": vdir, "name": name, "role": role}
	if expires != "" {
		body["expires_at"] = expires
	}
	return routeDo(t, s, http.MethodPost, "/api/sf/tokens", body, cookie, "")
}

func TestTokenMintMatrix(t *testing.T) {
	e := routeSetup(t)
	beforeDials := e.f.TotalConns()

	st, out := mintToken(t, e.s, e.owner, e.privID, "owner-editor", "editor", "")
	if st != http.StatusCreated {
		t.Fatalf("owner editor mint: status %d body %v", st, out)
	}
	token, _ := out["token"].(string)
	if !strings.HasPrefix(token, vdirtokens.TokenPrefix) || out["role"] != "editor" || out["vdir"] != e.privID {
		t.Fatalf("mint response wrong: %v", out)
	}
	if _, ok := out["token_hash"]; ok {
		t.Fatal("mint response exposed a token hash")
	}

	if st, out := mintToken(t, e.s, e.viewer, e.privID, "viewer-viewer", "viewer", ""); st != http.StatusCreated {
		t.Fatalf("viewer viewer mint: status %d body %v", st, out)
	}
	if st, _ := mintToken(t, e.s, e.viewer, e.privID, "viewer-editor", "editor", ""); st != http.StatusForbidden {
		t.Fatalf("viewer editor mint: status %d, want 403", st)
	}
	if st, _ := mintToken(t, e.s, e.editor, e.privID, "editor-editor", "editor", ""); st != http.StatusCreated {
		t.Fatalf("editor editor mint: status %d, want 201", st)
	}
	if st, _ := mintToken(t, e.s, e.owner, e.privID, "owner-viewer", "viewer", ""); st != http.StatusCreated {
		t.Fatalf("owner viewer mint: status %d, want 201", st)
	}
	if st, _ := mintToken(t, e.s, e.other, e.privID, "other", "viewer", ""); st != http.StatusForbidden {
		t.Fatalf("non-grantee mint: status %d, want 403", st)
	}
	if st, _ := mintToken(t, e.s, e.other, e.pubID, "public-only", "viewer", ""); st != http.StatusForbidden {
		t.Fatalf("public-only mint: status %d, want 403", st)
	}
	if st, _ := mintToken(t, e.s, nil, e.privID, "anon", "viewer", ""); st != http.StatusUnauthorized {
		t.Fatalf("anonymous mint: status %d, want 401", st)
	}
	if st, _ := mintToken(t, e.s, e.owner, "missing-vdir", "missing", "viewer", ""); st != http.StatusNotFound {
		t.Fatalf("unknown vdir mint: status %d, want 404", st)
	}
	for _, body := range []map[string]any{
		{"vdir": e.privID, "role": "viewer"},
		{"vdir": e.privID, "name": "x", "role": "admin"},
		{"vdir": e.privID, "name": "x", "role": "viewer", "expires_at": time.Now().Add(-time.Hour).Format(time.RFC3339)},
		{"vdir": e.privID, "name": "x", "role": "viewer", "expires_at": "not-a-time"},
	} {
		if st, _ := routeDo(t, e.s, http.MethodPost, "/api/sf/tokens", body, e.owner, ""); st != http.StatusBadRequest {
			t.Fatalf("invalid mint %v: status %d, want 400", body, st)
		}
	}
	if got := e.f.TotalConns(); got != beforeDials {
		t.Fatalf("token mint dialed SSH: conns %d -> %d", beforeDials, got)
	}
}

func TestTokenListOwnOnlyAndNoSecret(t *testing.T) {
	e := routeSetup(t)
	_, ownerMint := mintToken(t, e.s, e.owner, e.privID, "owner-laptop", "viewer", "")
	ownerToken, _ := ownerMint["token"].(string)
	if _, out := mintToken(t, e.s, e.owner, e.privID, "owner-tablet", "editor", ""); out["token"] == nil {
		t.Fatal("second owner mint did not return a token")
	}
	if st, out := mintToken(t, e.s, e.viewer, e.privID, "viewer-token", "viewer", ""); st != http.StatusCreated {
		t.Fatalf("viewer mint: status %d body %v", st, out)
	}

	st, out := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens", nil, e.owner, "")
	if st != http.StatusOK {
		t.Fatalf("owner list: status %d body %v", st, out)
	}
	items, _ := out["tokens"].([]any)
	if len(items) != 2 {
		t.Fatalf("owner list has %d tokens, want 2: %v", len(items), out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), ownerToken) {
		t.Fatal("list response exposed a plaintext token")
	}
	for _, item := range items {
		row := item.(map[string]any)
		if _, ok := row["token_hash"]; ok {
			t.Fatal("list row exposed a token hash")
		}
		if row["vdir_name"] != "private" {
			t.Fatalf("list row vdir_name = %v, want private", row["vdir_name"])
		}
	}

	if st, _ := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens", nil, e.other, ""); st != http.StatusOK {
		t.Fatalf("other list: status %d, want 200", st)
	}
	if st, _ := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens", nil, nil, ""); st != http.StatusUnauthorized {
		t.Fatalf("anonymous list: status %d, want 401", st)
	}
	if st, _ := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens", nil, nil, ownerToken); st != http.StatusUnauthorized {
		t.Fatalf("bearer-only list: status %d, want 401", st)
	}
}

func TestTokenRevoke(t *testing.T) {
	e := routeSetup(t)
	_, ownerMint := mintToken(t, e.s, e.owner, e.privID, "owner", "viewer", "")
	ownerToken := ownerMint["token"].(string)
	ownerID := ownerMint["id"].(string)
	_, viewerMint := mintToken(t, e.s, e.viewer, e.privID, "viewer", "viewer", "")
	viewerToken := viewerMint["token"].(string)
	viewerID := viewerMint["id"].(string)

	if st, _ := routeDo(t, e.s, http.MethodDelete, "/api/sf/tokens/"+ownerID, nil, e.owner, ""); st != http.StatusNoContent {
		t.Fatalf("revoke own: status %d, want 204", st)
	}
	if _, err := vdirtokens.FindByPlaintext(e.s.App, ownerToken); err == nil {
		t.Fatal("revoked token still resolves")
	}
	if st, _ := routeDo(t, e.s, http.MethodDelete, "/api/sf/tokens/"+viewerID, nil, e.owner, ""); st != http.StatusNotFound {
		t.Fatalf("revoke other's token: status %d, want 404", st)
	}
	if _, err := vdirtokens.FindByPlaintext(e.s.App, viewerToken); err != nil {
		t.Fatalf("another user's revoke killed the viewer token: %v", err)
	}
	if st, _ := routeDo(t, e.s, http.MethodDelete, "/api/sf/tokens/"+ownerID, nil, e.owner, ""); st != http.StatusNoContent {
		t.Fatalf("repeat revoke: status %d, want 204", st)
	}
	if st, _ := routeDo(t, e.s, http.MethodDelete, "/api/sf/tokens/"+viewerID, nil, nil, viewerToken); st != http.StatusUnauthorized {
		t.Fatalf("bearer revoke: status %d, want 401", st)
	}
}

func TestTokenMe(t *testing.T) {
	e := routeSetup(t)
	_, minted := mintToken(t, e.s, e.owner, e.privID, "me", "viewer", "")
	token := minted["token"].(string)

	st, out := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens/me", nil, nil, token)
	if st != http.StatusOK {
		t.Fatalf("me: status %d body %v", st, out)
	}
	vd, _ := out["vdir"].(map[string]any)
	if out["role"] != "viewer" || vd["id"] != e.privID || vd["name"] != "private" {
		t.Fatalf("me response wrong: %v", out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), token) || strings.Contains(string(raw), vdirtokens.Hash(token)) {
		t.Fatal("me exposed the secret or its hash")
	}
	if out["last_used_at"] == nil {
		t.Fatal("me did not record last use")
	}

	if st, _ := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens/me", nil, e.owner, ""); st != http.StatusUnauthorized {
		t.Fatalf("cookie-only me: status %d, want 401", st)
	}
	if st, _ := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens/me", nil, nil, "bad-token"); st != http.StatusUnauthorized {
		t.Fatalf("invalid me: status %d, want 401", st)
	}
	if st, _ := routeDo(t, e.s, http.MethodDelete, "/api/sf/tokens/"+minted["id"].(string), nil, e.owner, ""); st != http.StatusNoContent {
		t.Fatalf("revoke for me test: status %d", st)
	}
	if st, _ := routeDo(t, e.s, http.MethodGet, "/api/sf/tokens/me", nil, nil, token); st != http.StatusUnauthorized {
		t.Fatalf("revoked me: status %d, want 401", st)
	}
}
