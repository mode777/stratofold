package requestauth_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/requestauth"
	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/vdirtokens"
)

type env struct {
	s      *testapp.Server
	owner  *core.Record
	viewer *core.Record
	editor *core.Record
	other  *core.Record
	priv   *core.Record
	pub    *core.Record

	ownerCookie  *http.Cookie
	viewerCookie *http.Cookie
	editorCookie *http.Cookie
	otherCookie  *http.Cookie
}

func setup(t *testing.T) *env {
	t.Helper()
	s := testapp.Start(t)
	owner, err := s.App.FindAuthRecordByEmail("users", testapp.TestUserEmail)
	if err != nil {
		t.Fatalf("find owner: %v", err)
	}
	connCol, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", owner.Id)
	conn.Set("label", "auth")
	conn.Set("host", "127.0.0.1")
	conn.Set("port", 22)
	conn.Set("username", "fixture")
	conn.Set("auth_method", "password")
	conn.Set("password", "fixture-pass")
	conn.Set("host_key_fingerprint", "SHA256:fixture")
	if err := s.App.Save(conn); err != nil {
		t.Fatalf("save connection: %v", err)
	}
	vdirCol, err := s.App.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs collection: %v", err)
	}
	mkVdir := func(name string, pub bool) *core.Record {
		vd := core.NewRecord(vdirCol)
		vd.Set("owner", owner.Id)
		vd.Set("connection", conn.Id)
		vd.Set("name", name)
		vd.Set("root_path", "/srv/"+name)
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
		rec := core.NewRecord(usersCol)
		rec.SetEmail(email)
		rec.SetPassword("extra-pass-123")
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("save user %s: %v", email, err)
		}
		return rec
	}
	viewer := mkUser("auth-viewer@stratofold.test")
	editor := mkUser("auth-editor@stratofold.test")
	other := mkUser("auth-other@stratofold.test")

	shares, err := s.App.FindCollectionByNameOrId("vdir_shares")
	if err != nil {
		t.Fatalf("vdir_shares collection: %v", err)
	}
	grant := func(vdirID, userID, role string) {
		rec := core.NewRecord(shares)
		rec.Set("vdir", vdirID)
		rec.Set("user", userID)
		rec.Set("role", role)
		if err := s.App.Save(rec); err != nil {
			t.Fatalf("save share: %v", err)
		}
	}
	grant(priv.Id, viewer.Id, "viewer")
	grant(priv.Id, editor.Id, "editor")

	return &env{
		s: s, owner: owner, viewer: viewer, editor: editor, other: other, priv: priv, pub: pub,
		ownerCookie: cookieFor(t, s, owner), viewerCookie: cookieFor(t, s, viewer),
		editorCookie: cookieFor(t, s, editor), otherCookie: cookieFor(t, s, other),
	}
}

func cookieFor(t *testing.T, s *testapp.Server, user *core.Record) *http.Cookie {
	t.Helper()
	tok, err := user.NewAuthToken()
	if err != nil {
		t.Fatalf("user token: %v", err)
	}
	return &http.Cookie{Name: "sf_session", Value: tok}
}

func event(s *testapp.Server, cookie *http.Cookie, bearer string) *core.RequestEvent {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	return &core.RequestEvent{
		App:   s.App,
		Event: router.Event{Request: req, Response: httptest.NewRecorder()},
	}
}

func makeToken(t *testing.T, s *testapp.Server, userID, vdirID, role string, expires time.Time) (id, plain string) {
	t.Helper()
	tok, plain, err := vdirtokens.Create(s.App, userID, vdirID, "test", role, expires)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	return tok.ID, plain
}

func statusOf(err error) int {
	if err == nil {
		return 0
	}
	var api *router.ApiError
	if errors.As(err, &api) {
		return api.Status
	}
	return -1
}

func TestFromRequest(t *testing.T) {
	e := setup(t)
	_, ownerToken := makeToken(t, e.s, e.owner.Id, e.priv.Id, vdirtokens.RoleViewer, time.Time{})
	_, otherToken := makeToken(t, e.s, e.other.Id, e.priv.Id, vdirtokens.RoleViewer, time.Time{})
	_, expiredToken := makeToken(t, e.s, e.owner.Id, e.priv.Id, vdirtokens.RoleViewer, time.Now().Add(-time.Hour))

	cred, err := requestauth.FromRequest(event(e.s, nil, ownerToken))
	if err != nil || cred.UserID() != e.owner.Id || cred.Token == nil {
		t.Fatalf("bearer-only: cred=%+v err=%v", cred, err)
	}
	cred, err = requestauth.FromRequest(event(e.s, e.ownerCookie, ""))
	if err != nil || cred.UserID() != e.owner.Id || cred.Token != nil {
		t.Fatalf("cookie-only: cred=%+v err=%v", cred, err)
	}
	cred, err = requestauth.FromRequest(event(e.s, e.viewerCookie, otherToken))
	if err != nil || cred.UserID() != e.other.Id || cred.Token == nil {
		t.Fatalf("bearer precedence: cred=%+v err=%v", cred, err)
	}
	if _, err := requestauth.FromRequest(event(e.s, e.ownerCookie, "not-a-valid-token")); !errors.Is(err, requestauth.ErrInvalidToken) {
		t.Fatalf("invalid bearer + valid cookie err=%v, want requestauth.ErrInvalidToken", err)
	}
	cred, err = requestauth.FromRequest(event(e.s, e.ownerCookie, ""))
	if err != nil {
		t.Fatalf("cookie setup: %v", err)
	}
	// A non-Bearer scheme is ignored and the cookie still authenticates.
	ev := event(e.s, e.ownerCookie, "")
	ev.Request.Header.Set("Authorization", "Basic Zm9vOmJhcg==")
	cred, err = requestauth.FromRequest(ev)
	if err != nil || cred.UserID() != e.owner.Id {
		t.Fatalf("non-bearer scheme: cred=%+v err=%v", cred, err)
	}
	if _, err := requestauth.FromRequest(event(e.s, nil, "")); !errors.Is(err, requestauth.ErrNoCredential) {
		t.Fatalf("anonymous err=%v, want requestauth.ErrNoCredential", err)
	}
	malformed := event(e.s, nil, "")
	malformed.Request.Header.Set("Authorization", "Bearer ")
	if _, err := requestauth.FromRequest(malformed); !errors.Is(err, requestauth.ErrInvalidToken) {
		t.Fatalf("malformed bearer err=%v, want requestauth.ErrInvalidToken", err)
	}
	if _, err := requestauth.FromRequest(event(e.s, nil, expiredToken)); !errors.Is(err, requestauth.ErrInvalidToken) {
		t.Fatalf("expired token err=%v, want requestauth.ErrInvalidToken", err)
	}
	if _, err := requestauth.FromRequest(event(e.s, nil, "sf_v1_revoked")); !errors.Is(err, requestauth.ErrInvalidToken) {
		t.Fatalf("unknown token err=%v, want requestauth.ErrInvalidToken", err)
	}
	if _, err := requestauth.FromRequest(event(e.s, nil, "sf_v2_wrong-prefix")); !errors.Is(err, requestauth.ErrInvalidToken) {
		t.Fatalf("wrong-prefix token err=%v, want requestauth.ErrInvalidToken", err)
	}

	old := requestauth.TouchToken
	requestauth.TouchToken = func(core.App, *vdirtokens.Token, time.Time) error {
		return errors.New("audit unavailable")
	}
	defer func() { requestauth.TouchToken = old }()
	cred, err = requestauth.FromRequest(event(e.s, nil, ownerToken))
	if err != nil || cred.UserID() != e.owner.Id {
		t.Fatalf("audit failure broke authentication: cred=%+v err=%v", cred, err)
	}
}

func TestAuthorizeVdirMatrix(t *testing.T) {
	e := setup(t)
	_, ownerViewer := makeToken(t, e.s, e.owner.Id, e.priv.Id, vdirtokens.RoleViewer, time.Time{})
	_, ownerEditor := makeToken(t, e.s, e.owner.Id, e.priv.Id, vdirtokens.RoleEditor, time.Time{})
	_, viewerViewer := makeToken(t, e.s, e.viewer.Id, e.priv.Id, vdirtokens.RoleViewer, time.Time{})
	_, viewerEditor := makeToken(t, e.s, e.viewer.Id, e.priv.Id, vdirtokens.RoleEditor, time.Time{})
	_, editorEditor := makeToken(t, e.s, e.editor.Id, e.priv.Id, vdirtokens.RoleEditor, time.Time{})
	_, wrongVdir := makeToken(t, e.s, e.owner.Id, e.pub.Id, vdirtokens.RoleViewer, time.Time{})
	_, expired := makeToken(t, e.s, e.owner.Id, e.priv.Id, vdirtokens.RoleViewer, time.Now().Add(-time.Hour))
	revokedID, revoked := makeToken(t, e.s, e.owner.Id, e.priv.Id, vdirtokens.RoleViewer, time.Time{})
	if err := vdirtokens.Delete(e.s.App, revokedID); err != nil {
		t.Fatalf("revoke setup: %v", err)
	}

	cases := []struct {
		name   string
		vd     *core.Record
		write  bool
		cookie *http.Cookie
		bearer string
		want   int
	}{
		{"owner cookie read", e.priv, false, e.ownerCookie, "", 0},
		{"owner cookie write", e.priv, true, e.ownerCookie, "", 0},
		{"viewer cookie read", e.priv, false, e.viewerCookie, "", 0},
		{"viewer cookie write", e.priv, true, e.viewerCookie, "", http.StatusForbidden},
		{"editor cookie write", e.priv, true, e.editorCookie, "", 0},
		{"other cookie read", e.priv, false, e.otherCookie, "", http.StatusForbidden},
		{"anonymous private read", e.priv, false, nil, "", http.StatusUnauthorized},
		{"anonymous public read", e.pub, false, nil, "", 0},
		{"anonymous public write", e.pub, true, nil, "", http.StatusUnauthorized},
		{"owner viewer token read", e.priv, false, nil, ownerViewer, 0},
		{"owner viewer token write", e.priv, true, nil, ownerViewer, http.StatusForbidden},
		{"owner editor token read", e.priv, false, nil, ownerEditor, 0},
		{"owner editor token write", e.priv, true, nil, ownerEditor, 0},
		{"viewer viewer token read", e.priv, false, nil, viewerViewer, 0},
		{"viewer viewer token write", e.priv, true, nil, viewerViewer, http.StatusForbidden},
		{"viewer editor token write", e.priv, true, nil, viewerEditor, http.StatusForbidden},
		{"editor editor token write", e.priv, true, nil, editorEditor, 0},
		{"wrong vdir token", e.priv, false, nil, wrongVdir, http.StatusForbidden},
		{"expired token", e.priv, false, nil, expired, http.StatusUnauthorized},
		{"revoked token", e.priv, false, nil, revoked, http.StatusUnauthorized},
		{"invalid bearer with cookie", e.priv, false, e.ownerCookie, "not-a-token", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cred, err := requestauth.AuthorizeVdir(event(e.s, tc.cookie, tc.bearer), tc.vd, tc.write)
			if got := statusOf(err); got != tc.want {
				t.Fatalf("status = %d, want %d (err %v)", got, tc.want, err)
			}
			if tc.want == 0 && tc.bearer != "" && (cred.Token == nil || cred.Token.ID == "") {
				t.Fatalf("successful bearer auth did not return the token credential: %+v", cred)
			}
		})
	}

	// Share removal and role downgrade apply immediately.
	recs, err := e.s.App.FindRecordsByFilter("vdir_shares", "vdir = {:v}", "", 0, 0, dbx.Params{"v": e.priv.Id})
	if err != nil {
		t.Fatalf("find shares: %v", err)
	}
	for _, rec := range recs {
		if err := e.s.App.Delete(rec); err != nil {
			t.Fatalf("delete share: %v", err)
		}
	}
	if _, err := requestauth.AuthorizeVdir(event(e.s, nil, viewerViewer), e.priv, false); statusOf(err) != http.StatusForbidden {
		t.Fatalf("removed viewer token read: %v, want 403", err)
	}
	if _, err := requestauth.AuthorizeVdir(event(e.s, nil, editorEditor), e.priv, true); statusOf(err) != http.StatusForbidden {
		t.Fatalf("removed editor token write: %v, want 403", err)
	}

	// A cookie-only user on a public vdir can mint (AuthorizeReader),
	// while anonymous public readers cannot.
	if _, err := requestauth.AuthorizeReader(event(e.s, nil, ""), e.pub); statusOf(err) != http.StatusUnauthorized {
		t.Fatalf("anonymous public AuthorizeReader: %v, want 401", err)
	}
	if _, err := requestauth.AuthorizeReader(event(e.s, e.ownerCookie, ""), e.pub); err != nil {
		t.Fatalf("cookie public AuthorizeReader: %v", err)
	}
	if _, err := requestauth.AuthorizeReader(event(e.s, nil, viewerViewer), e.priv); statusOf(err) != http.StatusForbidden {
		t.Fatalf("revoked viewer AuthorizeReader: %v, want 403", err)
	}
	if _, err := requestauth.AuthorizeReader(event(e.s, nil, ownerViewer), e.priv); err != nil {
		t.Fatalf("owner AuthorizeReader after share removal: %v", err)
	}
}
