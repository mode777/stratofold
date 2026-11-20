package publicurls

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/fileserver"
	"github.com/mode777/stratofold/internal/webassets"
)

// Route describes one route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers. The resolver
// lives under /api/sf/ (the auth-session route-collision invariant);
// the alias surface lives under /apps/ and must stay outside every API
// namespace.
func CustomRoutes() []Route {
	return []Route{
		{http.MethodGet, "/api/sf/public-urls/{name}"},
		{http.MethodGet, "/apps/{name}"},
		{http.MethodGet, "/apps/{name}/{path...}"},
	}
}

// RegisterRoutes mounts the session-free resolver and the /apps alias
// group. middlewares (the streaming deadline clearer in production)
// bind to the whole /apps group and run before each handler. The
// resolver deliberately has no session middleware: it only answers for
// public aliases.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent], middlewares ...*hook.Handler[*core.RequestEvent]) {
	g.GET("/api/sf/public-urls/{name}", handleResolve)

	sub := g.Group("/apps")
	sub.Bind(middlewares...)
	sub.BindFunc(exposeHeaders)
	sub.GET("/{name}", handleRoot)
	sub.GET("/{name}/{path...}", handlePath)
}

// exposeHeaders makes the representation headers a cross-origin client
// needs readable from alias file responses, matching /files.
func exposeHeaders(e *core.RequestEvent) error {
	e.Response.Header().Set("Access-Control-Expose-Headers",
		"Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified, Content-Disposition")
	return e.Next()
}

// findPublicAlias resolves one exact public name to its vdir. Every
// miss — unknown, released, or non-public — is indistinguishable to the
// caller and never reaches SSH.
func findPublicAlias(app core.App, name string) (*core.Record, bool) {
	if name == "" {
		return nil, false
	}
	record, err := app.FindFirstRecordByData(Collection, SlugField, name)
	if err != nil || !record.GetBool("is_public") {
		return nil, false
	}
	return record, true
}

// handleResolve is the session-free resolver the SPA uses to turn an
// alias into the vdir id it needs for ls/stat. It reveals only the id
// and display name of a public vdir.
func handleResolve(e *core.RequestEvent) error {
	record, ok := findPublicAlias(e.App, e.Request.PathValue("name"))
	if !ok {
		return e.NotFoundError("Not found.", nil)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"vdir": record.Id,
		"name": record.GetString(NameField),
	})
}

// handleRoot canonicalizes the bare alias to its slashed browse form.
func handleRoot(e *core.RequestEvent) error {
	if _, ok := findPublicAlias(e.App, e.Request.PathValue("name")); !ok {
		return e.NotFoundError("Not found.", nil)
	}
	u := *e.Request.URL
	u.Path += "/"
	return e.Redirect(http.StatusMovedPermanently, u.String())
}

// handlePath is the design D4 split: slashed paths (and the root-level
// view namespace) are the SPA's browse/preview routes and need no SSH
// dial; an unslashed path is a direct-file request resolved through the
// vdir sandbox.
func handlePath(e *core.RequestEvent) error {
	record, ok := findPublicAlias(e.App, e.Request.PathValue("name"))
	if !ok {
		return e.NotFoundError("Not found.", nil)
	}

	rawTail := e.Request.PathValue("path")
	hadSlash := strings.HasSuffix(rawTail, "/")
	virtualPath := strings.TrimRight(rawTail, "/")

	if virtualPath == "" || hadSlash || isPreviewPath(virtualPath) {
		return serveShell(e)
	}

	ctx := e.Request.Context()
	res, st, version, err := fileserver.StatResolved(ctx, e.App, record.Id, virtualPath)
	if err != nil {
		if errors.Is(err, fileserver.ErrVersionStore) {
			return e.InternalServerError("Internal error.", nil)
		}
		return e.NotFoundError("Not found.", nil)
	}

	if st.IsDir() {
		u := *e.Request.URL
		u.Path += "/"
		return e.Redirect(http.StatusMovedPermanently, u.String())
	}
	return fileserver.ServeFile(e, ctx, res, st, version, rawTail)
}

// isPreviewPath reserves only the root-level view segment, mirroring
// the /v/<vdir-id>/view namespace; a nested docs/view/... stays a
// normal virtual path.
func isPreviewPath(virtualPath string) bool {
	return virtualPath == "view" || strings.HasPrefix(virtualPath, "view/")
}

// serveShell returns the embedded SPA shell. The browse/preview view
// resolves the path and owns its not-found/unavailable states.
func serveShell(e *core.RequestEvent) error {
	return e.FileFS(webassets.FS, router.IndexPage)
}
