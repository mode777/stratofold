package authbridge

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// Route describes one custom route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers. All live under
// the /api/sf/ prefix (ADR 0002 namespace discipline); the standing
// route-collision test asserts this.
func CustomRoutes() []Route {
	return []Route{
		{http.MethodPost, "/api/sf/auth"},
		{http.MethodDelete, "/api/sf/auth"},
	}
}

// RegisterRoutes mounts the session-bridge routes on the PocketBase
// router (call from an OnServe hook).
func RegisterRoutes(r *router.RouterGroup[*core.RequestEvent]) {
	r.POST("/api/sf/auth", handleAuthLogin)
	r.DELETE("/api/sf/auth", handleAuthLogout)
}

// handleAuthLogin exchanges user credentials for a PocketBase auth token
// (response body, PB-SDK compatible {token, record}) and an sf_session
// cookie carrying the same token (D2/D4).
func handleAuthLogin(e *core.RequestEvent) error {
	data := struct {
		Identity string `json:"identity"`
		Password string `json:"password"`
	}{}
	if err := e.BindBody(&data); err != nil {
		return e.BadRequestError("Failed to read request data", err)
	}

	record, err := e.App.FindAuthRecordByEmail(UsersCollection, data.Identity)
	if err != nil || !record.ValidatePassword(data.Password) {
		// generic error as basic enumeration protection
		return e.BadRequestError("Invalid credentials", nil)
	}

	token, err := record.NewAuthToken()
	if err != nil {
		return e.InternalServerError("Failed to create auth token", err)
	}

	// The cookie lives exactly as long as the token (design D2): the
	// users collection's auth-token duration is the single source of
	// truth (migration 1770000004 pins it to the platform maximum).
	users, err := e.App.FindCollectionByNameOrId(UsersCollection)
	if err != nil {
		return e.InternalServerError("Failed to load users collection", err)
	}

	// same convention as apis.RecordAuthResponse: the authenticated
	// record always exposes its own email
	record.IgnoreEmailVisibility(true)

	http.SetCookie(e.Response, sessionCookie(token, int(users.AuthToken.Duration), requestIsSecure(e.Request)))
	return e.JSON(http.StatusOK, map[string]any{"token": token, "record": record})
}

// handleAuthLogout rotates the user's token key (D3) — invalidating all
// of the user's outstanding tokens at once (all-devices logout, a known
// limitation) — and clears the sf_session cookie.
func handleAuthLogout(e *core.RequestEvent) error {
	secure := requestIsSecure(e.Request)

	invalidated := false
	if cookie, err := e.Request.Cookie(SessionCookieName); err == nil && cookie.Value != "" {
		if record, err := e.App.FindAuthRecordByToken(cookie.Value, core.TokenTypeAuth); err == nil {
			record.RefreshTokenKey()
			if err := e.App.Save(record); err != nil {
				return e.InternalServerError("Failed to invalidate session", err)
			}
			invalidated = true
		}
	}

	http.SetCookie(e.Response, clearSessionCookie(secure))

	if !invalidated {
		return e.UnauthorizedError("Authentication required", nil)
	}
	return e.NoContent(http.StatusOK)
}
