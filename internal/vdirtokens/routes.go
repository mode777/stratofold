package vdirtokens

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/vdirauthz"
)

// Route describes one route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers. All live
// under /api/sf/, the custom-route namespace invariant.
func CustomRoutes() []Route {
	return []Route{
		{http.MethodPost, "/api/sf/tokens"},
		{http.MethodGet, "/api/sf/tokens"},
		{http.MethodDelete, "/api/sf/tokens/{id}"},
		{http.MethodGet, "/api/sf/tokens/me"},
	}
}

// RegisterRoutes mounts token management (session cookie only) and the
// bearer-only introspection route. A bearer deliberately cannot manage
// tokens, so the management routes bind the cookie middleware while
// /me stays outside it.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.POST("/api/sf/tokens", handleMint).Bind(authbridge.RequireSession())
	g.GET("/api/sf/tokens", handleList).Bind(authbridge.RequireSession())
	g.DELETE("/api/sf/tokens/{id}", handleRevoke).Bind(authbridge.RequireSession())
	g.GET("/api/sf/tokens/me", handleMe)
}

type mintBody struct {
	Vdir      string `json:"vdir"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	ExpiresAt string `json:"expires_at"`
}

// handleMint creates one token, capped by the requester's current role
// on the vdir. The plaintext appears only in this response.
func handleMint(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.UnauthorizedError("Authentication required", nil)
	}
	var body mintBody
	raw, err := io.ReadAll(io.LimitReader(e.Request.Body, 1<<20))
	if err != nil {
		return e.BadRequestError("Invalid request body", nil)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return e.BadRequestError("Invalid request body", nil)
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return e.BadRequestError("Invalid request body", nil)
	}
	body.Vdir = strings.TrimSpace(body.Vdir)
	body.Name = strings.TrimSpace(body.Name)
	body.Role = strings.TrimSpace(body.Role)
	body.ExpiresAt = strings.TrimSpace(body.ExpiresAt)

	now := time.Now().UTC()
	if body.Vdir == "" || body.Name == "" || len(body.Name) > 100 || !ValidRole(body.Role) {
		return e.BadRequestError("Invalid token shape", nil)
	}
	var expires time.Time
	if body.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, body.ExpiresAt)
		if err != nil || !t.After(now) {
			return e.BadRequestError("expires_at must be a future RFC3339 timestamp", nil)
		}
		expires = t.UTC()
	}

	vd, err := e.App.FindRecordById("vdirs", body.Vdir)
	if err != nil {
		return e.NotFoundError("Not found.", nil)
	}
	d := vdirauthz.Resolve(e.App, vd, e.Auth.Id)
	if d.Access < vdirauthz.Viewer {
		return e.ForbiddenError("Forbidden", nil)
	}
	if body.Role == RoleEditor && d.Access < vdirauthz.Editor {
		return e.ForbiddenError("Forbidden", nil)
	}

	if err := SweepExpired(e.App, now); err != nil {
		e.App.Logger().Warn("vdir_tokens: sweep failed", "error", err)
	}
	tok, plain, err := Create(e.App, e.Auth.Id, vd.Id, body.Name, body.Role, expires)
	if err != nil {
		return e.InternalServerError("Could not create token", nil)
	}
	return e.JSON(http.StatusCreated, map[string]any{
		"id":           tok.ID,
		"name":         tok.Name,
		"token":        plain,
		"token_hint":   tok.Hint,
		"vdir":         tok.VdirID,
		"vdir_name":    vd.GetString("name"),
		"role":         tok.Role,
		"expires_at":   isoOrNil(tok.ExpiresAt),
		"last_used_at": isoOrNil(tok.LastUsedAt),
		"created":      tok.Created.UTC().Format(time.RFC3339),
	})
}

// handleList returns the requester's own token metadata only.
func handleList(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.UnauthorizedError("Authentication required", nil)
	}
	now := time.Now().UTC()
	if err := SweepExpired(e.App, now); err != nil {
		e.App.Logger().Warn("vdir_tokens: sweep failed", "error", err)
	}
	tokens, err := ListByUser(e.App, e.Auth.Id)
	if err != nil {
		return e.InternalServerError("Could not list tokens", nil)
	}
	out := make([]map[string]any, 0, len(tokens))
	for _, tok := range tokens {
		out = append(out, tokenJSON(e.App, tok))
	}
	return e.JSON(http.StatusOK, map[string]any{"tokens": out})
}

// handleRevoke deletes an owned token; a missing own id is idempotent
// success, another user's id is indistinguishable from not-found.
func handleRevoke(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.UnauthorizedError("Authentication required", nil)
	}
	id := strings.TrimSpace(e.Request.PathValue("id"))
	if id == "" {
		return e.NoContent(http.StatusNoContent)
	}
	rec, err := e.App.FindRecordById(Collection, id)
	if err != nil {
		return e.NoContent(http.StatusNoContent)
	}
	if rec.GetString("user") != e.Auth.Id {
		return e.NotFoundError("Not found.", nil)
	}
	if err := e.App.Delete(rec); err != nil {
		return e.InternalServerError("Could not revoke token", nil)
	}
	return e.NoContent(http.StatusNoContent)
}

// handleMe is the bearer-only scope discovery route.
func handleMe(e *core.RequestEvent) error {
	plain, ok := BearerToken(e.Request.Header)
	if !ok || plain == "" {
		return e.UnauthorizedError("Bearer token required", nil)
	}
	tok, err := FindByPlaintext(e.App, plain)
	if err != nil {
		return e.UnauthorizedError("Invalid or expired token", nil)
	}
	if err := Touch(e.App, tok, time.Now().UTC()); err != nil {
		e.App.Logger().Warn("vdir_tokens: last-used update failed", "error", err)
	}
	vd, err := e.App.FindRecordById("vdirs", tok.VdirID)
	if err != nil {
		return e.UnauthorizedError("Invalid or expired token", nil)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"id":           tok.ID,
		"name":         tok.Name,
		"vdir":         map[string]string{"id": vd.Id, "name": vd.GetString("name")},
		"role":         tok.Role,
		"expires_at":   isoOrNil(tok.ExpiresAt),
		"last_used_at": isoOrNil(tok.LastUsedAt),
		"token_hint":   tok.Hint,
	})
}

func tokenJSON(app core.App, tok *Token) map[string]any {
	vdirName := ""
	if vd, err := app.FindRecordById("vdirs", tok.VdirID); err == nil {
		vdirName = vd.GetString("name")
	}
	return map[string]any{
		"id":           tok.ID,
		"name":         tok.Name,
		"vdir":         tok.VdirID,
		"vdir_name":    vdirName,
		"role":         tok.Role,
		"token_hint":   tok.Hint,
		"expires_at":   isoOrNil(tok.ExpiresAt),
		"last_used_at": isoOrNil(tok.LastUsedAt),
		"created":      tok.Created.UTC().Format(time.RFC3339),
	}
}

func isoOrNil(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}
