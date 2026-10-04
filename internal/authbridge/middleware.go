package authbridge

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// RequireSession is a route middleware that resolves the sf_session
// cookie to an auth record via PocketBase's own token lookup (signature
// + expiry, D2), populates e.Auth, and lets the chain proceed.
// Anonymous/expired/invalid sessions are rejected with 401 and the
// route action is never executed.
func RequireSession() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sfRequireSession",
		Func: func(e *core.RequestEvent) error {
			cookie, err := e.Request.Cookie(SessionCookieName)
			if err != nil || cookie.Value == "" {
				return e.UnauthorizedError("Authentication required", nil)
			}

			record, err := e.App.FindAuthRecordByToken(cookie.Value, core.TokenTypeAuth)
			if err != nil {
				return e.UnauthorizedError("Invalid or expired session", nil)
			}

			e.Auth = record
			return e.Next()
		},
	}
}
