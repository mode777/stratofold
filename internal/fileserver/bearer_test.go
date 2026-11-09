package fileserver_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mode777/stratofold/internal/vdirtokens"
)

func makeFileToken(t *testing.T, e *env, userID, vdirID, role string, expires time.Time) (id, plain string) {
	t.Helper()
	tok, plain, err := vdirtokens.Create(e.s.App, userID, vdirID, "files bearer", role, expires)
	if err != nil {
		t.Fatalf("create vdir token: %v", err)
	}
	return tok.ID, plain
}

func TestFilesBearerAndCORS(t *testing.T) {
	e := setup(t)
	shareID := e.grant(t, e.privID, e.viewerID, "viewer")
	e.grant(t, e.privID, e.editorID, "editor")
	priv, err := e.s.App.FindRecordById("vdirs", e.privID)
	if err != nil {
		t.Fatalf("load private vdir: %v", err)
	}
	ownerID := priv.GetString("owner")

	_, ownerViewer := makeFileToken(t, e, ownerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	_, viewerToken := makeFileToken(t, e, e.viewerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	_, wrongVdir := makeFileToken(t, e, ownerID, e.pubID, vdirtokens.RoleViewer, time.Time{})
	_, expired := makeFileToken(t, e, ownerID, e.privID, vdirtokens.RoleViewer, time.Now().Add(-time.Hour))
	revokedID, revoked := makeFileToken(t, e, ownerID, e.privID, vdirtokens.RoleViewer, time.Time{})
	if err := vdirtokens.Delete(e.s.App, revokedID); err != nil {
		t.Fatalf("revoke setup: %v", err)
	}

	fileURL := e.s.BaseURL + "/files/" + e.privID + "/docs/a.txt"
	for name, token := range map[string]string{
		"viewer":       viewerToken,
		"owner viewer": ownerViewer,
	} {
		t.Run(name, func(t *testing.T) {
			resp := get(t, e, fileURL, nil, map[string]string{"Authorization": "Bearer " + token})
			mustStatus(t, resp, http.StatusOK)
			if got := string(body(t, resp)); got != docsATxt {
				t.Fatalf("body %q, want %q", got, docsATxt)
			}
		})
	}

	beforeDials := e.f.TotalConns()
	cases := []struct {
		name   string
		url    string
		token  string
		cookie *http.Cookie
		want   int
	}{
		{"wrong vdir", fileURL, wrongVdir, nil, http.StatusForbidden},
		{"expired", fileURL, expired, nil, http.StatusUnauthorized},
		{"revoked", fileURL, revoked, nil, http.StatusUnauthorized},
		{"anonymous private", fileURL, "", nil, http.StatusUnauthorized},
		{"bad bearer with cookie", fileURL, "not-a-token", ownerCookie(t, e), http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			headers := map[string]string{}
			if tc.token != "" {
				headers["Authorization"] = "Bearer " + tc.token
			}
			mustStatus(t, get(t, e, tc.url, tc.cookie, headers), tc.want)
		})
	}
	if got := e.f.TotalConns(); got != beforeDials {
		t.Fatalf("denied /files requests dialed SSH: conns %d -> %d", beforeDials, got)
	}

	// Public vdirs stay anonymous and do not require a token.
	resp := get(t, e, e.s.BaseURL+"/files/"+e.pubID+"/docs/a.txt", nil, nil)
	mustStatus(t, resp, http.StatusOK)

	// Removing the viewer share cuts the token immediately.
	resp = get(t, e, fileURL, nil, map[string]string{"Authorization": "Bearer " + viewerToken})
	mustStatus(t, resp, http.StatusOK)
	share, err := e.s.App.FindRecordById("vdir_shares", shareID)
	if err != nil {
		t.Fatalf("load share: %v", err)
	}
	if err := e.s.App.Delete(share); err != nil {
		t.Fatalf("delete share: %v", err)
	}
	resp = get(t, e, fileURL, nil, map[string]string{"Authorization": "Bearer " + viewerToken})
	mustStatus(t, resp, http.StatusForbidden)

	// Preflight from a foreign origin allows Authorization and Range.
	req, err := http.NewRequest(http.MethodOptions, fileURL, nil)
	if err != nil {
		t.Fatalf("preflight request: %v", err)
	}
	req.Header.Set("Origin", "https://app.example")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "authorization,range")
	pre := e.s.Do(t, req)
	defer pre.Body.Close()
	if pre.StatusCode >= 400 {
		t.Fatalf("preflight status %d", pre.StatusCode)
	}
	allowHeaders := strings.ToLower(pre.Header.Get("Access-Control-Allow-Headers"))
	if !strings.Contains(allowHeaders, "authorization") || !strings.Contains(allowHeaders, "range") {
		t.Fatalf("preflight allow-headers = %q", pre.Header.Get("Access-Control-Allow-Headers"))
	}
	if origin := pre.Header.Get("Access-Control-Allow-Origin"); origin != "*" && origin != "https://app.example" {
		t.Fatalf("preflight allow-origin = %q", origin)
	}

	// The actual response exposes the representation headers.
	resp = get(t, e, fileURL, nil, map[string]string{
		"Authorization": "Bearer " + ownerViewer,
		"Origin":        "https://app.example",
	})
	mustStatus(t, resp, http.StatusOK)
	exposed := resp.Header.Get("Access-Control-Expose-Headers")
	for _, h := range []string{"Content-Range", "ETag", "Content-Disposition", "Accept-Ranges"} {
		if !strings.Contains(exposed, h) {
			t.Fatalf("expose-headers %q lacks %q", exposed, h)
		}
	}
}
