// Package webassets embeds the production SPA build and serves it from
// the server binary (ADR 0004, deployment spec): existing files are
// served as-is, extensionless client routes fall back to the SPA shell,
// and reserved server namespaces never fall back. The embedded dist is
// a committed placeholder until the Docker/CI build overwrites it with
// the Vite output.
package webassets

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

//go:embed all:dist
var embedded embed.FS

// FS is the SPA build root (the embedded dist directory).
var FS fs.FS

const indexPage = router.IndexPage

func init() {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic("webassets: embedded dist: " + err.Error())
	}
	FS = sub
}

// reservedPrefixes are server-owned namespaces the SPA must never
// answer for: a miss there is a server 404, not the SPA shell.
var reservedPrefixes = []string{"/api", "/files", "/_"}

// RegisterRoutes mounts the SPA catch-all at the site root. It is
// registered after the API routes so those (more specific patterns)
// always win; non-GET/HEAD methods are rejected with 405.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.Route("", "/", Handler)
}

// Handler serves one request from the embedded SPA: an existing file
// as-is, the shell for extensionless client routes, and 404 for
// reserved namespaces and missing asset-like paths.
func Handler(e *core.RequestEvent) error {
	if e.Request.Method != http.MethodGet && e.Request.Method != http.MethodHead {
		return e.Error(http.StatusMethodNotAllowed, "Method not allowed", nil)
	}

	urlPath := e.Request.URL.Path
	if !strings.HasPrefix(urlPath, "/") {
		urlPath = "/" + urlPath
	}
	clean := path.Clean(urlPath)

	if isReserved(clean) {
		return e.NotFoundError("Not found", nil)
	}

	name := strings.TrimPrefix(clean, "/")
	if name == "" {
		return e.FileFS(FS, indexPage)
	}

	if f, err := FS.Open(name); err == nil {
		_ = f.Close()
		return e.FileFS(FS, name)
	}

	// Client-side routes have no extension; anything that looks like a
	// missing asset (has an extension) is a real 404, never the shell.
	if path.Ext(clean) == "" {
		return e.FileFS(FS, indexPage)
	}
	return e.NotFoundError("Not found", nil)
}

func isReserved(p string) bool {
	for _, prefix := range reservedPrefixes {
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			return true
		}
	}
	return false
}
