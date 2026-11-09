package filelinks_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/mode777/stratofold/internal/vdirtokens"
)

func makeLinkToken(t *testing.T, e *env, userID, vdirID, role string, expires time.Time) (id, plain string) {
	t.Helper()
	tok, plain, err := vdirtokens.Create(e.s.App, userID, vdirID, "file link bearer", role, expires)
	if err != nil {
		t.Fatalf("create vdir token: %v", err)
	}
	return tok.ID, plain
}

func (e *env) mintToken(t *testing.T, vdirID, path, token string) (int, map[string]any) {
	t.Helper()
	raw := fmt.Sprintf(`{"path":%q}`, path)
	req, err := http.NewRequest(http.MethodPost, e.s.BaseURL+"/api/sf/vdirs/"+vdirID+"/links", strings.NewReader(raw))
	if err != nil {
		t.Fatalf("mint request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp := e.s.Do(t, req)
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func mintTokenURL(t *testing.T, e *env, vdirID, path, token string) string {
	t.Helper()
	st, out := e.mintToken(t, vdirID, path, token)
	if st != http.StatusCreated {
		t.Fatalf("token mint %s: status %d body %v", path, st, out)
	}
	url, _ := out["url"].(string)
	if !strings.HasPrefix(url, "/s/") {
		t.Fatalf("token mint url = %q, want /s/<token>", url)
	}
	return e.s.BaseURL + url
}

func TestTokenMintedLinkRevokedWithToken(t *testing.T) {
	e := setup(t)
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load vdir: %v", err)
	}
	tokenID, token := makeLinkToken(t, e, priv.GetString("owner"), e.privID, vdirtokens.RoleViewer, time.Time{})

	url := mintTokenURL(t, e, e.privID, "docs/a.txt", token)
	resp := e.get(t, url, nil, nil)
	if resp.StatusCode != http.StatusOK {
		b := body(t, resp)
		t.Fatalf("token-minted link: status %d, want 200 (body %.160q)", resp.StatusCode, b)
	}
	if got := string(body(t, resp)); got != docsATxt {
		t.Fatalf("token-minted link body %q, want %q", got, docsATxt)
	}

	if err := vdirtokens.Delete(e.s.App, tokenID); err != nil {
		t.Fatalf("revoke token: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)
	rows, err := e.s.App.FindAllRecords("file_links")
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("revoking the token left %d link rows, want 0", len(rows))
	}
}

func TestTokenExpiryKillsItsLinks(t *testing.T) {
	e := setup(t)
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load vdir: %v", err)
	}
	tokenID, token := makeLinkToken(t, e, priv.GetString("owner"), e.privID, vdirtokens.RoleViewer, time.Time{})
	url := mintTokenURL(t, e, e.privID, "docs/a.txt", token)
	mustStatus(t, e.get(t, url, nil, nil), http.StatusOK)

	rec, err := e.s.App.FindRecordById(vdirtokens.Collection, tokenID)
	if err != nil {
		t.Fatalf("load token: %v", err)
	}
	past, err := types.ParseDateTime(time.Now().Add(-time.Minute))
	if err != nil {
		t.Fatalf("past date: %v", err)
	}
	rec.Set("expires_at", past)
	if err := e.s.App.Save(rec); err != nil {
		t.Fatalf("expire token: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)
}

func TestCookieMintedLinkUnaffectedByTokenRevocation(t *testing.T) {
	e := setup(t)
	url := mintURL(t, e, e.privID, "docs/a.txt", e.owner)
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load vdir: %v", err)
	}
	tokenID, _ := makeLinkToken(t, e, priv.GetString("owner"), e.privID, vdirtokens.RoleViewer, time.Time{})
	if err := vdirtokens.Delete(e.s.App, tokenID); err != nil {
		t.Fatalf("revoke token: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusOK)
}

func TestTokenMintWrongVdirAndAnonymousRejected(t *testing.T) {
	e := setup(t)
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load vdir: %v", err)
	}
	_, pubToken := makeLinkToken(t, e, priv.GetString("owner"), e.pubID, vdirtokens.RoleViewer, time.Time{})
	before := e.f.TotalConns()
	if st, _ := e.mintToken(t, e.privID, "docs/a.txt", pubToken); st != http.StatusForbidden {
		t.Fatalf("wrong-vdir token mint: status %d, want 403", st)
	}
	if st, _ := e.mintToken(t, e.pubID, "docs/a.txt", ""); st != http.StatusUnauthorized {
		t.Fatalf("anonymous public mint: status %d, want 401", st)
	}
	if got := e.f.TotalConns(); got != before {
		t.Fatalf("rejected token mint dialed SSH: conns %d -> %d", before, got)
	}
}

func TestTokenMintedLinkDiesWithShareRemoval(t *testing.T) {
	e := setup(t)
	shareID := e.grant(t, e.privID, e.viewerID, "viewer")
	_, token := makeLinkToken(t, e, e.viewerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	url := mintTokenURL(t, e, e.privID, "docs/a.txt", token)
	mustStatus(t, e.get(t, url, nil, nil), http.StatusOK)

	share, err := e.s.App.FindRecordById("vdir_shares", shareID)
	if err != nil {
		t.Fatalf("load share: %v", err)
	}
	if err := e.s.App.Delete(share); err != nil {
		t.Fatalf("delete share: %v", err)
	}
	mustStatus(t, e.get(t, url, nil, nil), http.StatusNotFound)
}
