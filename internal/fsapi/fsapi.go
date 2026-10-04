// Package fsapi is the /api/sf/vdirs/* filesystem surface (the
// filesystem-api spec): directory listings, remote mutations, and
// uploads that stream straight to the SSH host through the vdir
// sandbox. Handler order mirrors the file server (design D2): vdir
// record (SQLite) → access decision → sandbox resolution → operate,
// so a rejected request never wakes an SSH connection. Retries live
// in the operation layer (ops.go), not at call sites — the
// architecture's failure/retry model — with idempotency semantics
// declared per operation (design D3).
package fsapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"time"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/mode777/stratofold/internal/authbridge"
	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/vdir"
	"github.com/mode777/stratofold/internal/vdirauthz"
	"github.com/mode777/stratofold/internal/vdirpath"
)

// Route describes one route registered by RegisterRoutes.
type Route struct {
	Method string
	Path   string
}

// CustomRoutes lists every route this package registers. All live
// under the /api/sf/ prefix (the auth-session spec's route-collision
// invariant; PocketBase keeps /api/files/* and every other built-in).
func CustomRoutes() []Route {
	return []Route{
		{http.MethodPost, "/api/sf/vdirs/{vdirId}/ls"},
		{http.MethodPost, "/api/sf/vdirs/{vdirId}/mkdir"},
		{http.MethodPost, "/api/sf/vdirs/{vdirId}/mv"},
		{http.MethodPost, "/api/sf/vdirs/{vdirId}/rm"},
		{http.MethodPost, "/api/sf/vdirs/{vdirId}/upload"},
	}
}

// RegisterRoutes mounts the filesystem API. middlewares (e.g. the
// streaming deadline clearer — uploads stream unbounded request
// bodies) bind to the whole group and run before the handlers. The
// upload route unbinds PocketBase's default body limit (the same
// treatment PB gives its own backup-upload route): the body IS the
// file stream and tens-of-gigabyte uploads are the product.
func RegisterRoutes(g *router.RouterGroup[*core.RequestEvent], middlewares ...*hook.Handler[*core.RequestEvent]) {
	sub := g.Group("/api/sf/vdirs")
	sub.Bind(middlewares...)
	sub.POST("/{vdirId}/ls", handleLs)
	sub.POST("/{vdirId}/mkdir", handleMkdir)
	sub.POST("/{vdirId}/mv", handleMv)
	sub.POST("/{vdirId}/rm", handleRm)
	sub.POST("/{vdirId}/upload", handleUpload).Unbind(apis.DefaultBodyLimitMiddlewareId)
}

// pathBody is the JSON request shape of the non-upload operations
// (design D1): {"path": …}, plus "to" for mv. Paths are handed to the
// sandbox resolver verbatim — the JSON layer does no percent-decoding.
type pathBody struct {
	Path string `json:"path"`
	To   string `json:"to"`
}

// bindPathBody decodes the JSON body. An empty body is allowed only
// where the shape permits it (ls's root listing); anything
// unparseable is errBadRequest.
func bindPathBody(e *core.RequestEvent, allowEmpty bool) (pathBody, error) {
	var b pathBody
	raw, err := io.ReadAll(io.LimitReader(e.Request.Body, 1<<20))
	if err != nil {
		return b, fmt.Errorf("%w: read body: %w", errBadRequest, err)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		if allowEmpty {
			return b, nil
		}
		return b, fmt.Errorf("%w: empty body", errBadRequest)
	}
	if err := json.Unmarshal(raw, &b); err != nil {
		return b, fmt.Errorf("%w: body: %w", errBadRequest, err)
	}
	return b, nil
}

// authorize is the design-D2 access decision, made before any remote
// operation and resolved through the shared seam (design D1): `ls` is
// a read (public vdirs also serve it anonymously); mkdir/mv/rm/upload
// are writes (owner or editor everywhere — public never implies
// write). Denied requests map to `401` when unauthenticated or
// carrying an invalid session, `403` when authenticated without a
// sufficient grant. Returned errors are response-ready.
func authorize(e *core.RequestEvent, vd *core.Record, writeOp bool) error {
	cookieVal := cookieValue(e)
	user, _ := e.App.FindAuthRecordByToken(cookieVal, core.TokenTypeAuth)
	var userID string
	if user != nil {
		userID = user.Id
	}

	d := vdirauthz.Resolve(e.App, vd, userID)
	allowed := d.CanRead()
	if writeOp {
		allowed = d.CanWrite()
	}
	if allowed {
		return nil
	}

	if user == nil {
		if cookieVal == "" {
			return e.UnauthorizedError("Authentication required", nil)
		}
		return e.UnauthorizedError("Invalid or expired session", nil)
	}
	return e.ForbiddenError("Forbidden", nil)
}

func cookieValue(e *core.RequestEvent) string {
	cookie, err := e.Request.Cookie(authbridge.SessionCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// entry is one listing row.
type entry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Dir     bool   `json:"dir"`
	ModTime string `json:"modtime"`
}

func handleLs(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	ctx := e.Request.Context()

	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if err := authorize(e, vd, false); err != nil {
		return err
	}
	body, err := bindPathBody(e, true)
	if err != nil {
		return respondErr(e, err)
	}

	res, err := vdir.NewResolver(e.App).Resolve(ctx, vdirID, body.Path)
	if err != nil {
		return respondErr(e, err)
	}

	var entries []entry
	err = withRetry(ctx, res.Provider, MaxAttempts, func(cl *sftp.Client) error {
		es, rerr := readDirEntries(cl, res.RemotePath)
		if rerr == nil {
			entries = es
		}
		return rerr
	})
	if err != nil {
		return respondErr(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"path": body.Path, "entries": entries})
}

// readDirEntries lists one remote directory (a pure read: retry-safe
// by re-running). A missing target or a target that is not a
// directory maps to 404 per the spec.
func readDirEntries(cl *sftp.Client, dir string) ([]entry, error) {
	fi, err := cl.Lstat(dir)
	if err != nil {
		return nil, err
	}
	if !fi.IsDir() {
		return nil, fmt.Errorf("%w: %s", errNotADirectory, dir)
	}
	list, err := cl.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]entry, 0, len(list))
	for _, en := range list {
		out = append(out, entry{
			Name:    en.Name(),
			Size:    en.Size(),
			Dir:     en.IsDir(),
			ModTime: en.ModTime().UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func handleMkdir(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	ctx := e.Request.Context()

	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if err := authorize(e, vd, true); err != nil {
		return err
	}
	body, err := bindPathBody(e, false)
	if err != nil {
		return respondErr(e, err)
	}
	lex, err := vdirpath.Resolve(body.Path)
	if err != nil {
		return respondErr(e, err)
	}
	if lex == "" {
		return respondErr(e, fmt.Errorf("%w: mkdir of the vdir root", errBadRequest))
	}

	anch, err := vdir.NewResolver(e.App).ResolveAncestor(ctx, vdirID, body.Path)
	if err != nil {
		return respondErr(e, err)
	}

	err = withRetry(ctx, anch.Provider, MaxAttempts, func(cl *sftp.Client) error {
		if len(anch.Remaining) == 0 {
			return mkdirExistsDir(cl, anch.RemotePath)
		}
		return remoteMkdirAll(cl, anch.RemotePath, anch.Remaining)
	})
	if err != nil {
		return respondErr(e, err)
	}
	return e.NoContent(http.StatusNoContent)
}

func handleMv(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	ctx := e.Request.Context()

	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if err := authorize(e, vd, true); err != nil {
		return err
	}
	body, err := bindPathBody(e, false)
	if err != nil {
		return respondErr(e, err)
	}
	if body.Path == "" || body.To == "" {
		return respondErr(e, fmt.Errorf("%w: mv needs path and to", errBadRequest))
	}

	res, err := vdir.NewResolver(e.App).Resolve(ctx, vdirID, body.Path)
	if err != nil {
		return respondErr(e, err)
	}
	anch, err := vdir.NewResolver(e.App).ResolveAncestor(ctx, vdirID, body.To)
	if err != nil {
		return respondErr(e, err)
	}
	target := anch.RemotePath
	switch len(anch.Remaining) {
	case 0:
	case 1:
		target += "/" + anch.Remaining[0]
	default:
		return respondErr(e, fmt.Errorf("fsapi: mv: parent of %q missing: %w", body.To, os.ErrNotExist))
	}
	if target == res.RemotePath {
		return respondErr(e, fmt.Errorf("%w: mv onto itself", errBadRequest))
	}

	err = withRetry(ctx, anch.Provider, MaxAttempts, func(cl *sftp.Client) error {
		return remoteMv(cl, res.RemotePath, target)
	})
	if err != nil {
		return respondErr(e, err)
	}
	return e.NoContent(http.StatusNoContent)
}

func handleRm(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	ctx := e.Request.Context()

	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if err := authorize(e, vd, true); err != nil {
		return err
	}
	body, err := bindPathBody(e, false)
	if err != nil {
		return respondErr(e, err)
	}
	lex, err := vdirpath.Resolve(body.Path)
	if err != nil {
		return respondErr(e, err)
	}
	if lex == "" {
		return respondErr(e, fmt.Errorf("%w: rm of the vdir root", errBadRequest))
	}

	// Delete semantics are idempotent (design D3/D4): a target that
	// no longer exists — never created, or already removed by an
	// earlier attempt of this very request — is success. The ancestor
	// resolution tolerates the missing tail that plain Resolve would
	// reject, so a retried rm converges instead of 404-ing.
	anch, err := vdir.NewResolver(e.App).ResolveAncestor(ctx, vdirID, body.Path)
	if err != nil {
		return respondErr(e, err)
	}
	if len(anch.Remaining) == 0 {
		err = withRetry(ctx, anch.Provider, MaxAttempts, func(cl *sftp.Client) error {
			return remoteRemoveAll(cl, anch.RemotePath)
		})
		if err != nil {
			return respondErr(e, err)
		}
	}
	return e.NoContent(http.StatusNoContent)
}

// UploadTransferOptions shape the upload's streaming transfer (the
// resume pipeline's own retry budget lives here — separate from
// MaxAttempts, which bounds the mutation ops). A var so tests can
// shrink the budget deterministically.
var UploadTransferOptions = sftpreadwrite.Options{}

// handleUpload streams the request body into a temporary remote file
// next to the target and publishes it with one atomic rename (design
// D5): an interrupted or unresumable upload removes the temp and
// leaves no file at the target path.
func handleUpload(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	ctx := e.Request.Context()

	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if err := authorize(e, vd, true); err != nil {
		return err
	}

	// The upload's target arrives in the query string; net/url has
	// already percent-decoded it once — this value is the virtual
	// path, the same single-decode edge as the JSON bodies.
	virtualPath := e.Request.URL.Query().Get("path")
	if virtualPath == "" {
		return respondErr(e, fmt.Errorf("%w: upload needs a path query parameter", errBadRequest))
	}

	anch, err := vdir.NewResolver(e.App).ResolveAncestor(ctx, vdirID, virtualPath)
	if err != nil {
		return respondErr(e, err)
	}

	var dir, target string
	switch len(anch.Remaining) {
	case 0:
		// The target itself exists (replace-on-upload); its parent
		// directory anchors the temp file.
		target = anch.RemotePath
		dir = path.Dir(target)
	case 1:
		dir = anch.RemotePath
		target = dir + "/" + anch.Remaining[0]
	default:
		return respondErr(e, fmt.Errorf("fsapi: upload: parent of %q missing: %w", virtualPath, os.ErrNotExist))
	}

	temp, err := tempName(dir, path.Base(target))
	if err != nil {
		return respondErr(e, err)
	}

	// Content-Length declares the size when present; chunked bodies
	// stream to EOF (size < 0). The body IS the file stream — nothing
	// buffers it on the Stratofold host (design D5, R5).
	size := e.Request.ContentLength
	tr := sftpreadwrite.New(anch.Provider, temp, UploadTransferOptions)
	n, err := tr.WriteAll(ctx, e.Request.Body, size)
	// An interrupted request body ends as an ordinary reader EOF, so
	// "the body ended" is only success when it was promised complete:
	// a short Content-Length body, or a canceled/aborted request,
	// must abandon like any other failure — never publish a truncated
	// file at the target.
	if err == nil && size >= 0 && n != size {
		err = fmt.Errorf("fsapi: upload: body ended after %d of %d bytes: %w", n, size, errBadRequest)
	}
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		abandonTemp(ctx, anch.Provider, temp)
		return respondErr(e, err)
	}

	err = withRetry(ctx, anch.Provider, MaxAttempts, func(cl *sftp.Client) error {
		return publish(cl, temp, target)
	})
	if err != nil {
		abandonTemp(ctx, anch.Provider, temp)
		return respondErr(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"path": virtualPath, "size": n})
}

// tempName derives the upload temp name in the target's directory
// (same filesystem → the final rename is atomic; inside the resolved
// anchor → inside the sandbox by construction).
func tempName(dir, base string) (string, error) {
	var rnd [8]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return "", fmt.Errorf("fsapi: temp name: %w", err)
	}
	return dir + "/." + base + ".sfpart-" + hex.EncodeToString(rnd[:]), nil
}

// abandonTemp best-effort removes an abandoned upload's temp file
// (design D5): bounded fresh-context retries so cleanup still runs
// after the client went away; a missing temp is already gone.
func abandonTemp(ctx context.Context, p sshconn.ClientProvider, temp string) {
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	_ = withRetry(cctx, p, 3, func(cl *sftp.Client) error {
		if err := cl.Remove(temp); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	})
}
