package fsapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/vdirtokens"
)

func makeVdirToken(t *testing.T, e *env, userID, vdirID, role string, expires time.Time) (id, plain string) {
	t.Helper()
	tok, plain, err := vdirtokens.Create(e.s.App, userID, vdirID, "fsapi bearer", role, expires)
	if err != nil {
		t.Fatalf("create vdir token: %v", err)
	}
	return tok.ID, plain
}

func opJSONToken(t *testing.T, e *env, vdirID, op string, body any, token string) *http.Response {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/api/sf/vdirs/%s/%s", e.s.BaseURL, vdirID, op),
		bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	return e.s.Do(t, req)
}

func uploadBytesToken(t *testing.T, e *env, vdirID, vpath string, content []byte, token string) *http.Response {
	t.Helper()
	u := fmt.Sprintf("%s/api/sf/vdirs/%s/upload?%s", e.s.BaseURL, vdirID, url.Values{"path": {vpath}}.Encode())
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(content))
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	req.ContentLength = int64(len(content))
	req.Header.Set("Authorization", "Bearer "+token)
	return e.s.Do(t, req)
}

func TestFilesystemApiBearerMatrix(t *testing.T) {
	e := setup(t)
	e.grant(t, e.privID, e.viewerID, "viewer")
	e.grant(t, e.privID, e.editorID, "editor")
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load private vdir: %v", err)
	}
	ownerID := priv.GetString("owner")

	_, ownerViewer := makeVdirToken(t, e, ownerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	_, viewerToken := makeVdirToken(t, e, e.viewerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	_, editorToken := makeVdirToken(t, e, e.editorID, e.privID, vdirtokens.RoleEditor, time.Time{})
	otherUser, err := e.s.App.FindAuthRecordByToken(e.otherToken, core.TokenTypeAuth)
	if err != nil {
		t.Fatalf("find other user: %v", err)
	}
	_, otherToken := makeVdirToken(t, e, otherUser.Id, e.privID, vdirtokens.RoleViewer, time.Time{})
	_, wrongVdir := makeVdirToken(t, e, ownerID, e.pubID, vdirtokens.RoleViewer, time.Time{})
	_, expired := makeVdirToken(t, e, ownerID, e.privID, vdirtokens.RoleViewer, time.Now().Add(-time.Hour))
	revokedID, revoked := makeVdirToken(t, e, ownerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	if err := vdirtokens.Delete(e.s.App, revokedID); err != nil {
		t.Fatalf("revoke setup: %v", err)
	}

	// Successful reads and writes.
	mustStatus(t, opJSONToken(t, e, e.privID, "ls", map[string]string{"path": ""}, viewerToken), http.StatusOK)
	mustStatus(t, opJSONToken(t, e, e.privID, "ls", map[string]string{"path": ""}, editorToken), http.StatusOK)
	mustStatus(t, opJSONToken(t, e, e.privID, "mkdir", map[string]string{"path": "mut/token-dir"}, editorToken), http.StatusNoContent)
	mustStatus(t, opJSONToken(t, e, e.privID, "mv", map[string]string{"path": "mut/seed.txt", "to": "mut/seed-moved.txt"}, editorToken), http.StatusNoContent)
	mustStatus(t, opJSONToken(t, e, e.privID, "rm", map[string]string{"path": "mut/seed-moved.txt"}, editorToken), http.StatusNoContent)
	mustStatus(t, uploadBytesToken(t, e, e.privID, "up/editor-token.txt", []byte("token upload"), editorToken), http.StatusOK)

	beforeDials := e.f.TotalConns()
	mustStatus(t, opJSONToken(t, e, e.privID, "mkdir", map[string]string{"path": "mut/viewer-no"}, viewerToken), http.StatusForbidden)
	mustStatus(t, uploadBytesToken(t, e, e.privID, "up/owner-viewer.txt", []byte("no"), ownerViewer), http.StatusForbidden)
	mustStatus(t, opJSONToken(t, e, e.privID, "ls", map[string]string{"path": ""}, otherToken), http.StatusForbidden)
	mustStatus(t, opJSONToken(t, e, e.privID, "ls", map[string]string{"path": ""}, wrongVdir), http.StatusForbidden)
	mustStatus(t, opJSONToken(t, e, e.privID, "ls", map[string]string{"path": ""}, expired), http.StatusUnauthorized)
	mustStatus(t, opJSONToken(t, e, e.privID, "ls", map[string]string{"path": ""}, revoked), http.StatusUnauthorized)

	// A bad bearer is not rescued by a valid cookie.
	req, err := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/api/sf/vdirs/%s/ls", e.s.BaseURL, e.privID),
		bytes.NewReader([]byte(`{"path":""}`)))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-a-valid-token")
	req.AddCookie(tokenCookie(t, e, ownerID))
	mustStatus(t, e.s.Do(t, req), http.StatusUnauthorized)

	if got := e.f.TotalConns(); got != beforeDials {
		t.Fatalf("denied bearer requests dialed SSH: conns %d -> %d", beforeDials, got)
	}

	// A token for a public vdir still needs the user's grant when used
	// on the filesystem API; public anonymous listing remains available
	// without a token.
	mustStatus(t, opJSONToken(t, e, e.pubID, "ls", map[string]string{"path": ""}, wrongVdir), http.StatusOK)
}
