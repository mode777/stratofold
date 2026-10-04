// Package authbridge implements the PocketBase ⇄ browser session bridge
// (ADR 0002): POST/DELETE /api/sf/auth routes and the sf_session cookie
// middleware shared by later capabilities (/files/*, /api/sf/*).
package authbridge

import (
	"net/http"
	"strings"
)

// SessionCookieName is the HttpOnly cookie carrying the PocketBase auth
// token for browser-native access (/files/* etc.).
const SessionCookieName = "sf_session"

// UsersCollection is the built-in PocketBase users auth collection.
const UsersCollection = "users"

// sessionCookie builds the sf_session cookie. HttpOnly + SameSite=Lax
// always; Secure when the request arrived over HTTPS (direct TLS or a
// trusted X-Forwarded-Proto, docs/architecture.md deployment).
func sessionCookie(token string, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	}
}

// clearSessionCookie expires the sf_session cookie in the browser.
func clearSessionCookie(secure bool) *http.Cookie {
	c := sessionCookie("", secure)
	c.MaxAge = -1
	return c
}

// requestIsSecure reports whether the request should be treated as
// HTTPS for the Secure cookie attribute (r.TLS or X-Forwarded-Proto,
// per design D4).
func requestIsSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}
