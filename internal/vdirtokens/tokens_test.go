package vdirtokens_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/mode777/stratofold/internal/testapp"
	"github.com/mode777/stratofold/internal/vdirtokens"
)

type env struct {
	s    *testapp.Server
	user *core.Record
	vdir *core.Record
}

func setup(t *testing.T) *env {
	t.Helper()
	s := testapp.Start(t)
	user, err := s.App.FindAuthRecordByEmail("users", testapp.TestUserEmail)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	connCol, err := s.App.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections collection: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", user.Id)
	conn.Set("label", "tokens")
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
	vdir := core.NewRecord(vdirCol)
	vdir.Set("owner", user.Id)
	vdir.Set("connection", conn.Id)
	vdir.Set("name", "tokens")
	vdir.Set("root_path", "/srv/tokens")
	if err := s.App.Save(vdir); err != nil {
		t.Fatalf("save vdir: %v", err)
	}
	return &env{s: s, user: user, vdir: vdir}
}

func TestTokenGeneration(t *testing.T) {
	p1, h1, hint1, err := vdirtokens.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	p2, h2, _, err := vdirtokens.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if p1 == p2 {
		t.Fatal("two generated tokens are identical")
	}
	if !strings.HasPrefix(p1, vdirtokens.TokenPrefix) {
		t.Fatalf("token %q lacks the %q prefix", p1, vdirtokens.TokenPrefix)
	}
	if got, want := len(p1), len(vdirtokens.TokenPrefix)+43; got != want {
		t.Fatalf("token length = %d, want %d", got, want)
	}
	if len(h1) != 64 || h1 != vdirtokens.Hash(p1) {
		t.Fatalf("hash = %q, want SHA-256 of the plaintext", h1)
	}
	if !strings.HasPrefix(hint1, vdirtokens.TokenPrefix) || !strings.HasSuffix(hint1, p1[len(p1)-4:]) || !strings.Contains(hint1, "…") {
		t.Fatalf("hint %q is not the expected prefix + last-four shape", hint1)
	}
	if h1 == h2 {
		t.Fatal("two generated tokens have the same hash")
	}
}

func TestTokenStorageAndLookup(t *testing.T) {
	e := setup(t)
	tok, plain, err := vdirtokens.Create(e.s.App, e.user.Id, e.vdir.Id, "laptop", vdirtokens.RoleViewer, time.Time{})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	if tok.ID == "" || tok.UserID != e.user.Id || tok.VdirID != e.vdir.Id || tok.Role != vdirtokens.RoleViewer {
		t.Fatalf("created token shape wrong: %+v", tok)
	}
	if !strings.HasPrefix(plain, vdirtokens.TokenPrefix) {
		t.Fatalf("plaintext %q lacks the prefix", plain)
	}
	if tok.ExpiresAt.IsZero() == false {
		t.Fatalf("no-expiry token got expiry %v", tok.ExpiresAt)
	}

	found, err := vdirtokens.FindByPlaintext(e.s.App, plain)
	if err != nil {
		t.Fatalf("find by plaintext: %v", err)
	}
	if found.ID != tok.ID || found.UserID != tok.UserID || found.VdirID != tok.VdirID {
		t.Fatalf("looked-up token mismatch: %+v vs %+v", found, tok)
	}
	if _, err := vdirtokens.FindByPlaintext(e.s.App, "sf_v1_not-a-real-token"); !errors.Is(err, vdirtokens.ErrNotFound) {
		t.Fatalf("unknown token error = %v, want ErrNotFound", err)
	}

	row, err := e.s.App.FindRecordById(vdirtokens.Collection, tok.ID)
	if err != nil {
		t.Fatalf("load token row: %v", err)
	}
	if got := row.GetString("token_hash"); got != vdirtokens.Hash(plain) {
		t.Fatalf("stored hash = %q, want %q", got, vdirtokens.Hash(plain))
	}
	if got := row.GetString("token_hint"); got != tok.Hint {
		t.Fatalf("stored hint = %q, want %q", got, tok.Hint)
	}
	if strings.Contains(row.GetString("token_hash"), plain) || strings.Contains(row.GetString("token_hint"), plain) {
		t.Fatal("stored row contains the plaintext token")
	}

	// A second user's token must not appear in this user's list.
	users, err := e.s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	other := core.NewRecord(users)
	other.SetEmail("tokens-other@stratofold.test")
	other.SetPassword("tokens-other-pass")
	if err := e.s.App.Save(other); err != nil {
		t.Fatalf("save other user: %v", err)
	}
	if _, _, err := vdirtokens.Create(e.s.App, other.Id, e.vdir.Id, "other", vdirtokens.RoleViewer, time.Time{}); err != nil {
		t.Fatalf("create other token: %v", err)
	}
	list, err := vdirtokens.ListByUser(e.s.App, e.user.Id)
	if err != nil {
		t.Fatalf("list tokens: %v", err)
	}
	if len(list) != 1 || list[0].ID != tok.ID {
		t.Fatalf("list = %+v, want only the owner's token", list)
	}

	if err := vdirtokens.Delete(e.s.App, tok.ID); err != nil {
		t.Fatalf("delete token: %v", err)
	}
	if _, err := vdirtokens.FindByPlaintext(e.s.App, plain); !errors.Is(err, vdirtokens.ErrNotFound) {
		t.Fatalf("revoked token error = %v, want ErrNotFound", err)
	}
	if _, err := vdirtokens.FindByID(e.s.App, tok.ID); !errors.Is(err, vdirtokens.ErrNotFound) {
		t.Fatalf("deleted token by id error = %v, want ErrNotFound", err)
	}
	if err := vdirtokens.Delete(e.s.App, "missing-token-id"); !errors.Is(err, vdirtokens.ErrNotFound) {
		t.Fatalf("deleting a missing token = %v, want ErrNotFound", err)
	}
}

func TestExpirySweepAndLastUsed(t *testing.T) {
	e := setup(t)
	now := time.Now().UTC()
	expired, _, err := vdirtokens.Create(e.s.App, e.user.Id, e.vdir.Id, "expired", vdirtokens.RoleViewer, now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("create expired token: %v", err)
	}
	live, _, err := vdirtokens.Create(e.s.App, e.user.Id, e.vdir.Id, "live", vdirtokens.RoleViewer, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("create live token: %v", err)
	}

	links, err := e.s.App.FindCollectionByNameOrId("file_links")
	if err != nil {
		t.Fatalf("file_links collection: %v", err)
	}
	link := core.NewRecord(links)
	link.Set("vdir", e.vdir.Id)
	link.Set("path", "docs/a.txt")
	link.Set("created_by", e.user.Id)
	link.Set("token_hash", "link-hash")
	link.Set("minted_by_token", expired.ID)
	exp, err := types.ParseDateTime(now.Add(time.Hour))
	if err != nil {
		t.Fatalf("parse link expiry: %v", err)
	}
	link.Set("expires_at", exp)
	if err := e.s.App.Save(link); err != nil {
		t.Fatalf("save link: %v", err)
	}

	if err := vdirtokens.SweepExpired(e.s.App, now); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if _, err := vdirtokens.FindByID(e.s.App, expired.ID); !errors.Is(err, vdirtokens.ErrNotFound) {
		t.Fatalf("expired token survived the sweep: %v", err)
	}
	if _, err := e.s.App.FindRecordById("file_links", link.Id); err == nil {
		t.Fatal("expired token's link survived the sweep")
	}
	if _, err := vdirtokens.FindByID(e.s.App, live.ID); err != nil {
		t.Fatalf("live token was swept: %v", err)
	}

	// A recent last-use is coalesced; an old one is written.
	recent := now.Add(-time.Minute)
	if _, err := e.s.App.DB().NewQuery("UPDATE vdir_tokens SET last_used_at = {:now} WHERE id = {:id}").
		Bind(dbx.Params{"now": recent.Format(types.DefaultDateLayout), "id": live.ID}).Execute(); err != nil {
		t.Fatalf("seed recent last use: %v", err)
	}
	live, err = vdirtokens.FindByID(e.s.App, live.ID)
	if err != nil {
		t.Fatalf("reload live token: %v", err)
	}
	if err := vdirtokens.Touch(e.s.App, live, now); err != nil {
		t.Fatalf("touch recent: %v", err)
	}
	row, _ := e.s.App.FindRecordById(vdirtokens.Collection, live.ID)
	if got := row.GetDateTime("last_used_at").Time(); !got.Truncate(time.Millisecond).Equal(recent.Truncate(time.Millisecond)) {
		t.Fatalf("recent last_used_at = %v, want unchanged %v", got, recent)
	}

	old := now.Add(-10 * time.Minute)
	if _, err := e.s.App.DB().NewQuery("UPDATE vdir_tokens SET last_used_at = {:now} WHERE id = {:id}").
		Bind(dbx.Params{"now": old.Format(types.DefaultDateLayout), "id": live.ID}).Execute(); err != nil {
		t.Fatalf("seed old last use: %v", err)
	}
	live, err = vdirtokens.FindByID(e.s.App, live.ID)
	if err != nil {
		t.Fatalf("reload live token: %v", err)
	}
	if err := vdirtokens.Touch(e.s.App, live, now); err != nil {
		t.Fatalf("touch old: %v", err)
	}
	row, _ = e.s.App.FindRecordById(vdirtokens.Collection, live.ID)
	if got := row.GetDateTime("last_used_at").Time(); got.Before(now.Add(-time.Second)) {
		t.Fatalf("old last_used_at was not refreshed: %v", got)
	}
}
