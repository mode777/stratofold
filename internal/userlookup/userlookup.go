// Package userlookup is the share-grantee resolution route (the
// sharing-access-control delta): GET /api/sf/users/lookup?email=…
// resolves an exact email address to the matching user's id and email
// for naming share grantees. Session required (authbridge middleware);
// at most one record returns and any other query shape — listing,
// pagination, prefix, search — is rejected, so the endpoint cannot
// enumerate the user directory.
package userlookup

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/authbridge"
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
		{http.MethodGet, "/api/sf/users/lookup"},
	}
}

// RegisterRoutes mounts the lookup route behind the session
// middleware: an anonymous request is rejected with 401 before the
// handler runs.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	sub := g.Group("/api/sf/users")
	sub.GET("/lookup", handleLookup).Bind(authbridge.RequireSession())
}

// handleLookup resolves one exact email to {id, email} (design D6):
// any query beyond the email parameter (listing/pagination forms) is
// an invalid request shape, a miss is 404, and only the id and email
// are ever returned. Matching is exact as stored (PocketBase's users
// email index is case-sensitive); surrounding whitespace is trimmed
// before the emptiness check and the lookup.
func handleLookup(e *core.RequestEvent) error {
	query := e.Request.URL.Query()
	if len(query) != 1 {
		return e.BadRequestError("Lookup accepts only the email parameter", nil)
	}
	email := strings.TrimSpace(query.Get("email"))
	if email == "" {
		return e.BadRequestError("Lookup needs a non-empty email parameter", nil)
	}

	record, err := e.App.FindAuthRecordByEmail(authbridge.UsersCollection, email)
	if err != nil {
		return e.NotFoundError("No user with this email", nil)
	}
	return e.JSON(http.StatusOK, map[string]string{"id": record.Id, "email": record.Email()})
}
