// Package requestauth is the shared HTTP credential seam for the
// filesystem API, /files, and file-link minting (change
// add-vdir-access-tokens, design D2): it resolves either a vdir-scoped
// bearer token or the sf_session cookie into one identity, then applies
// the shared vdirauthz decision. Keeping both paths here is what keeps
// precedence and 401/403 mapping from drifting between handlers.
package requestauth

import (
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/vdirauthz"
	"github.com/mode777/stratofold/internal/vdirtokens"
)

// Credential is the resolved requester. User is nil for anonymous
// requests; Token is non-nil only for bearer-authenticated requests.
type Credential struct {
	User  *core.Record
	Token *vdirtokens.Token
}

// UserID returns the authenticated user id, or "" for anonymous.
func (c Credential) UserID() string {
	if c.User == nil {
		return ""
	}
	return c.User.Id
}

// Sentinel errors from FromRequest. The HTTP layer maps them to 401s.
var (
	ErrNoCredential   = errors.New("requestauth: no credential")
	ErrInvalidToken   = errors.New("requestauth: invalid or expired token")
	ErrInvalidSession = errors.New("requestauth: invalid or expired session")
)

// TouchToken is the token-audit seam; tests may replace it to prove a
// failed last-used update never fails authentication. It is internal
// to the module.
var TouchToken = vdirtokens.Touch

// FromRequest resolves the request credential. A Bearer credential is
// authoritative when present (even with a valid cookie); without one a
// present sf_session cookie is validated; otherwise the request is
// anonymous. A non-Bearer Authorization scheme is ignored.
func FromRequest(e *core.RequestEvent) (Credential, error) {
	if plain, ok := vdirtokens.BearerToken(e.Request.Header); ok {
		if plain == "" {
			return Credential{}, ErrInvalidToken
		}
		tok, err := vdirtokens.FindByPlaintext(e.App, plain)
		if err != nil {
			return Credential{}, ErrInvalidToken
		}
		user, err := e.App.FindRecordById(authbridge.UsersCollection, tok.UserID)
		if err != nil {
			return Credential{}, ErrInvalidToken
		}
		if err := TouchToken(e.App, tok, time.Now().UTC()); err != nil {
			e.App.Logger().Warn("requestauth: last-used update failed", "error", err)
		}
		return Credential{User: user, Token: tok}, nil
	}

	cookie, err := e.Request.Cookie(authbridge.SessionCookieName)
	if err == nil && cookie.Value != "" {
		user, err := e.App.FindAuthRecordByToken(cookie.Value, core.TokenTypeAuth)
		if err != nil {
			return Credential{}, ErrInvalidSession
		}
		return Credential{User: user}, nil
	}
	return Credential{}, ErrNoCredential
}

// AuthorizeVdir returns the credential when it may perform a read or
// write on vd, or a response-ready 401/403. Cookie and anonymous
// requests keep the existing CanRead/CanWrite rules; a bearer token
// must match the vdir and its user must still hold a real grant
// (public access alone does not keep a token alive).
func AuthorizeVdir(e *core.RequestEvent, vd *core.Record, write bool) (Credential, error) {
	cred, err := FromRequest(e)
	if err != nil && !errors.Is(err, ErrNoCredential) {
		return cred, unauthorized(e, err)
	}

	d := vdirauthz.Resolve(e.App, vd, cred.UserID())
	if cred.Token != nil {
		if cred.Token.VdirID != vd.Id {
			return cred, e.ForbiddenError("Forbidden", nil)
		}
		if write {
			if !cred.Token.IsEditor() || d.Access < vdirauthz.Editor {
				return cred, e.ForbiddenError("Forbidden", nil)
			}
			return cred, nil
		}
		if d.Access < vdirauthz.Viewer {
			return cred, e.ForbiddenError("Forbidden", nil)
		}
		return cred, nil
	}

	allowed := d.CanRead()
	if write {
		allowed = d.CanWrite()
	}
	if allowed {
		return cred, nil
	}
	if cred.User == nil {
		return cred, e.UnauthorizedError("Authentication required", nil)
	}
	return cred, e.ForbiddenError("Forbidden", nil)
}

// AuthorizeReader is the file-link mint rule: the request must carry a
// credential (cookie or token) and that credential must be allowed to
// read the vdir. Anonymous public reads do not mint links.
func AuthorizeReader(e *core.RequestEvent, vd *core.Record) (Credential, error) {
	cred, err := AuthorizeVdir(e, vd, false)
	if err != nil {
		return cred, err
	}
	if cred.User == nil {
		return cred, e.UnauthorizedError("Authentication required", nil)
	}
	return cred, nil
}

func unauthorized(e *core.RequestEvent, err error) error {
	if errors.Is(err, ErrInvalidToken) {
		return e.UnauthorizedError("Invalid or expired token", nil)
	}
	return e.UnauthorizedError("Invalid or expired session", nil)
}
