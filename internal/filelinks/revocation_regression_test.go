package filelinks_test

import (
	"bytes"
	"net/http"
	"testing"
	"time"

	"github.com/mode777/stratofold/internal/vdirtokens"
)

// TestTokenRevocationIsImmediateAcrossSurfaces pins the single
// revocation instant shared by the filesystem API, /files, and a
// token-minted link.
func TestTokenRevocationIsImmediateAcrossSurfaces(t *testing.T) {
	e := setup(t)
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load vdir: %v", err)
	}
	tokenID, token := makeLinkToken(t, e, priv.GetString("owner"), e.privID, vdirtokens.RoleViewer, time.Time{})
	linkURL := mintTokenURL(t, e, e.privID, "docs/a.txt", token)
	fileURL := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"

	ls := func() *http.Response {
		req, err := http.NewRequest(http.MethodPost,
			e.s.BaseURL+"/api/sf/vdirs/"+e.privID+"/ls",
			bytes.NewReader([]byte(`{"path":""}`)))
		if err != nil {
			t.Fatalf("ls request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		return e.s.Do(t, req)
	}
	file := func() *http.Response {
		req, err := http.NewRequest(http.MethodGet, fileURL, nil)
		if err != nil {
			t.Fatalf("file request: %v", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		return e.s.Do(t, req)
	}

	mustStatus(t, ls(), http.StatusOK)
	mustStatus(t, file(), http.StatusOK)
	mustStatus(t, e.get(t, linkURL, nil, nil), http.StatusOK)

	if err := vdirtokens.Delete(e.s.App, tokenID); err != nil {
		t.Fatalf("revoke token: %v", err)
	}
	mustStatus(t, e.get(t, linkURL, nil, nil), http.StatusNotFound)
	mustStatus(t, ls(), http.StatusUnauthorized)
	mustStatus(t, file(), http.StatusUnauthorized)

	// A bad bearer is not rescued by a valid cookie on /files.
	req, err := http.NewRequest(http.MethodGet, fileURL, nil)
	if err != nil {
		t.Fatalf("cookie+bad-bearer request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer not-a-valid-token")
	req.AddCookie(e.owner)
	mustStatus(t, e.s.Do(t, req), http.StatusUnauthorized)
}
