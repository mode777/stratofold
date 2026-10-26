package filelinks

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/fileserver"
	"github.com/mode777/stratofold/internal/vdirauthz"
)

// Route describes one route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers: the mint
// route under the /api/sf/ namespace, and the session-free redemption
// routes under /s/ (outside /api/, like /files/). The appserver
// collision tests assert both facts.
func CustomRoutes() []Route {
	return []Route{
		{http.MethodPost, "/api/sf/vdirs/{vdirId}/links"},
		{http.MethodGet, "/s/{token}"},
		{http.MethodHead, "/s/{token}"},
		{http.MethodOptions, "/s/{token}"},
	}
}

// RegisterRoutes mounts the mint route and the /s/ redemption group.
// The streaming deadline clearer binds to /s/ (the response can stream
// for as long as the receiver is playing); minting is a local SQLite
// operation. The /s/ group also gets the CORS/log-redaction middleware.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent], streamMiddlewares ...*hook.Handler[*core.RequestEvent]) {
	api := g.Group("/api/sf/vdirs")
	api.POST("/{vdirId}/links", handleMint)

	sub := g.Group("/s")
	sub.Bind(streamMiddlewares...)
	sub.BindFunc(linkMiddleware)
	sub.GET("/{token}", handleServe)
	sub.HEAD("/{token}", handleServe)
	sub.OPTIONS("/{token}", handleOptions)
}

// linkMiddleware sets the cross-origin headers a media receiver needs
// and redacts the token from the request path before PocketBase's
// activity logger records it.
func linkMiddleware(e *core.RequestEvent) error {
	h := e.Response.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Expose-Headers",
		"Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified")
	defer func() {
		// The activity logger reads the URL after e.Next() returns; the
		// response is already written, so only the logged path changes.
		e.Request.URL.Path = "/s/[redacted]"
		e.Request.URL.RawPath = ""
	}()
	if e.Request.Method == http.MethodOptions {
		h.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Range, If-Range, If-None-Match, If-Modified-Since")
		h.Set("Access-Control-Max-Age", "86400")
	}
	return e.Next()
}

// handleOptions answers the CORS preflight for a link URL.
func handleOptions(e *core.RequestEvent) error {
	return e.NoContent(http.StatusNoContent)
}

// handleMint creates a link for one virtual path. Authentication uses
// the same sf_session cookie as the filesystem API; access is the
// shared vdirauthz read decision, and the handler never dials SSH
// (design D4).
func handleMint(e *core.RequestEvent) error {
	vd, err := e.App.FindRecordById("vdirs", e.Request.PathValue("vdirId"))
	if err != nil {
		return e.NotFoundError("Not found", nil)
	}

	cookie, err := e.Request.Cookie(authbridge.SessionCookieName)
	if err != nil || cookie.Value == "" {
		return e.UnauthorizedError("Authentication required", nil)
	}
	user, err := e.App.FindAuthRecordByToken(cookie.Value, core.TokenTypeAuth)
	if err != nil {
		return e.UnauthorizedError("Invalid or expired session", nil)
	}
	if !vdirauthz.Resolve(e.App, vd, user.Id).CanRead() {
		return e.ForbiddenError("Forbidden", nil)
	}

	var body struct {
		Path string `json:"path"`
	}
	raw, err := io.ReadAll(io.LimitReader(e.Request.Body, 1<<20))
	if err != nil {
		return e.BadRequestError("Invalid request body", nil)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return e.BadRequestError("Path is required", nil)
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return e.BadRequestError("Invalid request body", nil)
	}
	virtualPath := strings.TrimSpace(body.Path)
	if virtualPath == "" {
		return e.BadRequestError("Path is required", nil)
	}

	now := time.Now().UTC()
	if err := sweepExpired(e.App, now); err != nil {
		// Housekeeping only: never fail a mint for it.
		e.App.Logger().Warn("file_links: sweep failed", "error", err)
	}
	if _, token, err := createLink(e.App, vd.Id, virtualPath, user.Id, now); err != nil {
		return e.InternalServerError("Could not create link", nil)
	} else {
		return e.JSON(http.StatusCreated, map[string]any{
			"url":        "/s/" + token,
			"expires_at": now.Add(LinkTTL).Format(time.RFC3339),
		})
	}
}

// handleServe redeems a link: expiry, then the creator's current access,
// then the vdir sandbox, then the shared file-server path. Every
// failure is an indistinguishable 404.
func handleServe(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")
	if token == "" {
		return e.NotFoundError("Not found", nil)
	}
	link, err := findLinkByToken(e.App, token)
	if err != nil {
		return e.NotFoundError("Not found", nil)
	}
	if !time.Now().Before(link.GetDateTime("expires_at").Time()) {
		return e.NotFoundError("Not found", nil)
	}
	vd, err := e.App.FindRecordById("vdirs", link.GetString("vdir"))
	if err != nil {
		return e.NotFoundError("Not found", nil)
	}
	if !vdirauthz.Resolve(e.App, vd, link.GetString("created_by")).CanRead() {
		return e.NotFoundError("Not found", nil)
	}

	virtualPath := link.GetString("path")
	res, st, err := fileserver.StatResolved(e.Request.Context(), e.App, vd.Id, virtualPath)
	if err != nil || st.IsDir() {
		return e.NotFoundError("Not found", nil)
	}

	name := path.Base(virtualPath)
	if disposition := mime.FormatMediaType("inline", map[string]string{"filename": name}); disposition != "" {
		e.Response.Header().Set("Content-Disposition", disposition)
	} else {
		e.Response.Header().Set("Content-Disposition", "inline")
	}
	return fileserver.ServeFile(e, e.Request.Context(), res, st, name)
}
