// Package vdirmeta is the public-vdir metadata route (the
// sharing-access-control delta): GET /api/sf/vdirs/<vdir-id>/meta
// returns the minimal metadata the anonymous browse view needs — the
// vdir's name and public marker — for vdirs marked public. Non-public
// and unknown ids yield 404 with no disclosure of the record's
// existence or any of its fields; the route never requires, creates,
// or inspects a session.
package vdirmeta

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// Route describes one route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers. It lives
// under the /api/sf/ prefix (the auth-session spec's route-collision
// invariant; PocketBase keeps /api/files/* and every other built-in).
func CustomRoutes() []Route {
	return []Route{
		{http.MethodGet, "/api/sf/vdirs/{vdirId}/meta"},
	}
}

// RegisterRoutes mounts the metadata route deliberately without any
// session middleware: publicness is decided per request inside the
// handler, so the same anonymous request shape the SPA sends is what
// the route answers.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	sub := g.Group("/api/sf/vdirs")
	sub.GET("/{vdirId}/meta", handleMeta)
}

// handleMeta answers {name, is_public: true} for a public vdir and 404
// for everything else — a miss and a non-public vdir are
// indistinguishable, and only the two public fields are ever returned
// (never the owner, connection binding, or root path).
func handleMeta(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById("vdirs", e.Request.PathValue("vdirId"))
	if err != nil || !record.GetBool("is_public") {
		return e.NotFoundError("Not found.", nil)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"name":      record.GetString("name"),
		"is_public": true,
	})
}
