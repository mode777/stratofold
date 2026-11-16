// Archive-extraction routes (the archive-extraction spec): the write path
// gains a long-running operation. Creation authorizes, resolves, and
// accepts; the work runs as a detached in-memory job (ADR 0017) observed
// through a second route. Handler order mirrors the rest of the package
// (design D2): record → access decision → sandbox resolution → accept, so
// a rejected request never wakes an SSH connection.

package fsapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/archiveextract"
	"github.com/mode777/stratofold/internal/requestauth"
	"github.com/mode777/stratofold/internal/sftpreadwrite"
	"github.com/mode777/stratofold/internal/vdir"
	"github.com/mode777/stratofold/internal/vdirauthz"
)

// extractBody is the request shape: the archive's virtual path and an
// optional folder name that overrides the derived one.
type extractBody struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// extractCancelWait bounds how long DELETE waits for a job to settle, so
// a cancel normally answers with the terminal state.
const extractCancelWait = 5 * time.Second

func handleExtract(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	ctx := e.Request.Context()

	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	cred, err := requestauth.AuthorizeVdir(e, vd, true)
	if err != nil {
		return err
	}

	var body extractBody
	if err := bindJSON(e, &body); err != nil {
		return respondErr(e, err)
	}
	if body.Path == "" {
		return respondErr(e, fmt.Errorf("%w: extract needs a path", errBadRequest))
	}

	anch, err := vdir.NewResolver(e.App).ResolveAncestor(ctx, vdirID, body.Path)
	if err != nil {
		return respondErr(e, err)
	}
	if len(anch.Remaining) != 0 {
		// The archive itself does not exist.
		return respondErr(e, fmt.Errorf("%w: %s", os.ErrNotExist, body.Path))
	}

	name := body.Name
	if name == "" {
		derived, derr := archiveextract.TargetName(path.Base(anch.RemotePath))
		if derr != nil {
			return respondErr(e, derr)
		}
		name = derived
	} else if name, err = archiveextract.ValidateTargetName(name); err != nil {
		return respondErr(e, err)
	}

	dir := path.Dir(anch.RemotePath)
	target := dir + "/" + name

	cl, release, err := anch.Provider.Client(ctx)
	if err != nil {
		return respondErr(e, err)
	}
	fi, statErr := cl.Stat(anch.RemotePath)
	var targetExists bool
	if _, terr := cl.Lstat(target); terr == nil {
		targetExists = true
	}
	release()
	if statErr != nil {
		return respondErr(e, statErr)
	}
	if fi.IsDir() {
		return respondErr(e, fmt.Errorf("%w: %s is a directory", archiveextract.ErrUnsupportedArchive, body.Path))
	}

	// Content check before the collision check: a file that is not an
	// archive is a bad request, not a conflict with itself.
	tr := sftpreadwrite.New(anch.Provider, anch.RemotePath, UploadTransferOptions)
	if err := archiveextract.Sniff(ctx, tr); err != nil {
		return respondErr(e, err)
	}
	if targetExists {
		return respondErr(e, archiveextract.ErrTargetExists)
	}

	req := archiveextract.Request{
		VdirID:        vdirID,
		Path:          body.Path,
		Target:        virtualSibling(body.Path, name),
		ArchiveRemote: anch.RemotePath,
		ArchiveSize:   fi.Size(),
		DirRemote:     dir,
		TargetName:    name,
		Provider:      anch.Provider,
		Authorize:     accessRecheck(e, vdirID, cred),
		Options:       UploadTransferOptions,
	}

	// The job outlives the response: detach it from the request context
	// so returning 202 does not cancel the work.
	jobCtx := context.WithoutCancel(ctx)
	job, err := archiveextract.Start(jobCtx, archiveextract.Default(), req)
	if err != nil {
		return respondErr(e, err)
	}
	return e.JSON(http.StatusAccepted, map[string]any{"job": job.Snapshot()})
}

func handleExtractStatus(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if _, err := requestauth.AuthorizeVdir(e, vd, true); err != nil {
		return err
	}
	snap, ok := archiveextract.Default().Lookup(vdirID, e.Request.PathValue("jobId"))
	if !ok {
		return respondErr(e, fmt.Errorf("%w: extraction job", os.ErrNotExist))
	}
	return e.JSON(http.StatusOK, map[string]any{"job": snap})
}

func handleExtractCancel(e *core.RequestEvent) error {
	vdirID := e.Request.PathValue("vdirId")
	vd, err := e.App.FindRecordById("vdirs", vdirID)
	if err != nil {
		return respondErr(e, err)
	}
	if _, err := requestauth.AuthorizeVdir(e, vd, true); err != nil {
		return err
	}
	snap, ok := archiveextract.Default().Cancel(e.Request.Context(), vdirID, e.Request.PathValue("jobId"), extractCancelWait)
	if !ok {
		return respondErr(e, fmt.Errorf("%w: extraction job", os.ErrNotExist))
	}
	return e.JSON(http.StatusOK, map[string]any{"job": snap})
}

// accessRecheck re-resolves the caller's write access while the job runs
// (design D9). It re-reads the vdir record and the share table on every
// call, so a removed share or a downgraded role stops the extraction
// instead of letting it write for its remaining duration.
func accessRecheck(e *core.RequestEvent, vdirID string, cred requestauth.Credential) func(context.Context) error {
	app := e.App
	userID := cred.UserID()
	bearer := cred.Token != nil
	return func(context.Context) error {
		vd, err := app.FindRecordById("vdirs", vdirID)
		if err != nil {
			return archiveextract.ErrForbidden
		}
		d := vdirauthz.Resolve(app, vd, userID)
		if bearer {
			if !cred.Token.IsEditor() || d.Access < vdirauthz.Editor {
				return archiveextract.ErrForbidden
			}
			return nil
		}
		if !d.CanWrite() {
			return archiveextract.ErrForbidden
		}
		return nil
	}
}

// virtualSibling joins a virtual parent path and a validated folder name.
func virtualSibling(filePath, name string) string {
	parent := path.Dir(filePath)
	if parent == "." || parent == "/" {
		return name
	}
	return parent + "/" + name
}

// bindJSON decodes a small JSON body into dst; an unparseable or empty
// body is a bad request.
func bindJSON(e *core.RequestEvent, dst any) error {
	dec := json.NewDecoder(e.Request.Body)
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		return fmt.Errorf("%w: body: %v", errBadRequest, err)
	}
	return nil
}
