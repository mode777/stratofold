// Package fileserver serves remote files over GET /files/* — the
// user-visible read surface (file-server spec): every request is
// authorized against its vdir record before any SSH dial (design D2),
// resolved through the vdir sandbox (fail-closed, rejections are 404),
// and streamed from SFTP offset reads with Range, conditional, and
// content-header semantics. The percent-decoding of the virtual path
// happens once, in the HTTP mux (design D1); nothing here decodes
// again.
package fileserver

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/vdir"
	"github.com/mode777/stratofold/internal/vdirauthz"
)

// Route describes one route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers. All live
// outside the /api/ namespaces (PocketBase owns /api/files/* and every
// other built-in; custom API routes live under /api/sf/); the standing
// route-collision test asserts this.
func CustomRoutes() []Route {
	return []Route{
		{http.MethodGet, "/files/{vdirId}"},
		{http.MethodGet, "/files/{vdirId}/{path...}"},
	}
}

// RegisterRoutes mounts the /files/* read surface on the router:
// `GET /files/{vdirId}/{virtualPath...}` plus the bare
// `GET /files/{vdirId}` root form. middlewares (e.g. the streaming
// deadline clearer) bind to the whole group and run before the handler.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent], middlewares ...*hook.Handler[*core.RequestEvent]) {
	sub := g.Group("/files")
	sub.Bind(middlewares...)
	sub.GET("/{vdirId}", handle)
	sub.GET("/{vdirId}/{path...}", handle)
}

// handle serves one GET through the fail-closed order of design D2:
// vdir record (SQLite) → access decision → sandbox resolution (may
// dial) → stat → serve.
func handle(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	// PathValue is percent-decoded by the ServeMux — the single decode
	// at the HTTP edge; this value is the decoded virtual path ("" for
	// the bare root form).
	rawTail := e.Request.PathValue("path")
	hadSlash := strings.HasSuffix(rawTail, "/")
	virtualPath := strings.TrimRight(rawTail, "/")
	serveName := rawTail // the name Content-Type is derived from
	ctx := e.Request.Context()

	// (1) The vdir record — a local SQLite read, no dial.
	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return e.NotFoundError("Not found", nil)
	}

	// (2) Access decision — never behind a dial: non-public vdirs
	// serve the owner or a vdir_shares grant holder (viewer/editor);
	// public vdirs serve everyone (design D1/D3 via internal/vdirauthz).
	if !vd.GetBool("is_public") {
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
	}

	// (3) Sandbox resolution — may dial; lexical rejects, escapes and
	// missing targets all surface as 404 (never a listing of what
	// exists vs what is forbidden).
	res, st, err := StatResolved(ctx, e.App, vdirID, virtualPath)
	if err != nil {
		return e.NotFoundError("Not found", nil)
	}

	if st.IsDir() {
		if rawTail != "" && !hadSlash {
			// Directory URLs are canonicalized to the slashed form so
			// relative references inside a served index.html resolve.
			u := *e.Request.URL
			u.Path += "/"
			return e.Redirect(http.StatusMovedPermanently, u.String())
		}
		// index.html resolution; a directory without one is 404 —
		// listing stays API-only.
		res, st, err = StatResolved(ctx, e.App, vdirID, path.Join(virtualPath, "index.html"))
		if err != nil || st.IsDir() {
			return e.NotFoundError("Not found", nil)
		}
		// Content-Type follows the file actually served.
		serveName = path.Join(virtualPath, "index.html")
	} else if hadSlash {
		// A regular file addressed with a trailing slash is not found.
		return e.NotFoundError("Not found", nil)
	}

	return ServeFile(e, ctx, res, st, serveName)
}

// StatResolved resolves virtualPath through the sandbox and stats the
// resolved remote path with one SFTP call. It is exported so the
// temporary-link route shares the exact resolution behavior.
func StatResolved(ctx context.Context, app core.App, vdirID, virtualPath string) (*vdir.Resolution, os.FileInfo, error) {
	res, err := vdir.NewResolver(app).Resolve(ctx, vdirID, virtualPath)
	if err != nil {
		return nil, nil, err
	}
	cl, release, err := res.Provider.Client(ctx)
	if err != nil {
		return nil, nil, err
	}
	st, err := cl.Stat(res.RemotePath)
	release()
	if err != nil {
		return nil, nil, err
	}
	return res, st, nil
}

// ServeFile evaluates conditionals, computes headers, and streams the
// byte window. The temporary-link route calls it for linked files; a
// HEAD request stops after the headers (no SFTP read).
func ServeFile(e *core.RequestEvent, ctx context.Context, res *vdir.Resolution, st os.FileInfo, virtualName string) error {
	etag := entityTag(st)
	h := e.Response.Header()
	h.Set("Accept-Ranges", "bytes")
	h.Set("ETag", etag)
	h.Set("Last-Modified", httpTime(st.ModTime()))

	// Conditionals precede Range handling (design D5); a 304 carries
	// the validators and no body.
	if notModified(e.Request, st, etag) {
		return e.NoContent(http.StatusNotModified)
	}

	size := st.Size()
	start, length, kind := parseRange(e.Request.Header.Get("Range"), size)

	if kind == rangeUnsatisfiable {
		h.Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		return e.NoContent(http.StatusRequestedRangeNotSatisfiable)
	}

	h.Set("Content-Type", contentType(virtualName))
	h.Set("Content-Length", strconv.FormatInt(length, 10))
	status := http.StatusOK
	if kind == rangePartial {
		status = http.StatusPartialContent
		h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, start+length-1, size))
	}

	w := &countingWriter{w: e.Response}
	e.Response.WriteHeader(status)
	if e.Request.Method == http.MethodHead {
		return nil
	}

	tr := sftpreadwrite.New(res.Provider, res.RemotePath, sftpreadwrite.Options{})
	if _, err := tr.ReadRangeTo(ctx, w, start, length); err != nil || w.n != length {
		// The status and Content-Length are already on the wire, so
		// the failure can never be reported in-band. Abort the
		// connection instead: the client must see a truncated transfer
		// (and retry per the spec's Range-retry behavior), never a
		// silently completed short body. ErrAbortHandler is re-raised
		// by PocketBase's recover middleware by design.
		panic(http.ErrAbortHandler)
	}
	return nil
}

// countingWriter counts sink-confirmed bytes (the resume bookkeeping's
// notion of "served").
type countingWriter struct {
	w io.Writer
	n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}
