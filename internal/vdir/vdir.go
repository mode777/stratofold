// Package vdir resolves virtual paths through their virtual directory
// onto the remote filesystem: lexical anchoring under the vdir root
// (internal/vdirpath) followed by server-side containment via SFTP
// realpath, so remote symlinks cannot escape the sandbox (design D4).
// Resolution is the single sanctioned seam for reaching a vdir's
// remote filesystem and fails closed: any rejection happens before a
// connection is dialed (D5).
package vdir

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/connreg"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/vdirpath"
)

// ErrEscape reports a server-side containment violation (the resolved
// location fell outside the vdir root). Never retryable.
var ErrEscape = errors.New("vdir: remote path escapes the vdir root")

// ErrInvalidConfig reports a vdir/connection record combination that
// cannot be used (e.g. relative root path, missing connection).
// Never retryable.
var ErrInvalidConfig = errors.New("vdir: unusable vdir configuration")

// ErrNotADirectory reports a non-directory component in the middle of
// a resolved chain, where children can never exist. Never retryable.
var ErrNotADirectory = errors.New("vdir: path component is not a directory")

// Resolution is a sandbox-checked vdir path. RemotePath is the
// server-resolved absolute path — operations must target it (not the
// lexical path) so a mid-request symlink swap cannot re-open the
// check. Provider is the connection's client provider.
type Resolution struct {
	VdirID       string
	ConnectionID string
	RemotePath   string
	Provider     sshconn.ClientProvider
}

// Resolver resolves vdir paths.
type Resolver struct {
	app core.App
	reg *connreg.Registry
}

// NewResolver returns a resolver over the app's connection registry.
func NewResolver(app core.App) *Resolver {
	return &Resolver{app: app, reg: connreg.FromApp(app)}
}

// Resolve checks vdirID/virtualPath against the sandbox and returns
// the resolution. Ordering is fail-closed (D5): record load → lexical
// check → client acquisition → server containment, so a rejection
// never dials. The full virtual path must exist on the remote.
func (r *Resolver) Resolve(ctx context.Context, vdirID, virtualPath string) (*Resolution, error) {
	mgr, connID, root, lexical, err := r.prep(vdirID, virtualPath)
	if err != nil {
		return nil, err
	}

	// Server-side containment: fully resolve both root and target on
	// the remote (following symlinks) and require the target to sit at
	// or below the resolved root. SFTP RealPath is only lexical, so
	// the symlink walk below is what actually detects escapes.
	cl, release, err := mgr.Client(ctx)
	if err != nil {
		return nil, err
	}
	rootReal, err := resolveRemote(cl, root)
	if err != nil {
		release()
		return nil, fmt.Errorf("vdir: resolve root %q: %w", root, err)
	}
	target, err := resolveRemote(cl, path.Join(root, lexical))
	if err != nil {
		release()
		return nil, fmt.Errorf("vdir: resolve %q: %w", lexical, err)
	}
	release()
	if err := contain(vdirID, virtualPath, target, rootReal); err != nil {
		return nil, err
	}

	return &Resolution{
		VdirID:       vdirID,
		ConnectionID: connID,
		RemotePath:   target,
		Provider:     mgr,
	}, nil
}

// Anchor is a sandbox-checked partial resolution for create-type
// operations (change 5): the full virtual path does not have to exist.
// RemotePath is the server-resolved deepest existing ancestor of the
// path — always inside the resolved root, symlink-free — and Remaining
// holds the lexical components that do not exist under it yet, in
// order. Creating the remaining components one by one under RemotePath
// can never leave the sandbox: every intermediate location is a fresh
// child of an already-contained directory.
type Anchor struct {
	Resolution
	Remaining []string
}

// ResolveAncestor resolves vdirID/virtualPath for the write path with
// the same fail-closed ordering as Resolve (record load → lexical
// check → client acquisition → server containment): the deepest
// existing ancestor is resolved server-side (following symlinks and
// containment-checked exactly like Resolve), the not-yet-existing tail
// is returned lexically. When the full path exists, Remaining is nil
// and RemotePath is the resolved path itself.
func (r *Resolver) ResolveAncestor(ctx context.Context, vdirID, virtualPath string) (*Anchor, error) {
	mgr, connID, root, lexical, err := r.prep(vdirID, virtualPath)
	if err != nil {
		return nil, err
	}

	cl, release, err := mgr.Client(ctx)
	if err != nil {
		return nil, err
	}
	rootReal, err := resolveRemote(cl, root)
	if err != nil {
		release()
		return nil, fmt.Errorf("vdir: resolve root %q: %w", root, err)
	}
	comps := splitLexical(lexical)
	anchor, remaining, err := resolveAncestorRemote(cl, rootReal, comps)
	release()
	if err != nil {
		return nil, fmt.Errorf("vdir: resolve %q: %w", lexical, err)
	}
	if err := contain(vdirID, virtualPath, anchor, rootReal); err != nil {
		return nil, err
	}

	return &Anchor{
		Resolution: Resolution{
			VdirID:       vdirID,
			ConnectionID: connID,
			RemotePath:   anchor,
			Provider:     mgr,
		},
		Remaining: remaining,
	}, nil
}

// prep loads the vdir record, anchors the virtual path lexically, and
// returns the connection's manager — everything the remote walks need,
// with every rejection happening before a dial.
func (r *Resolver) prep(vdirID, virtualPath string) (mgr *sshconn.Manager, connID, root, lexical string, err error) {
	if r.reg == nil {
		return nil, "", "", "", ErrInvalidConfig
	}
	vdir, err := r.app.FindRecordById("vdirs", vdirID)
	if err != nil {
		return nil, "", "", "", fmt.Errorf("vdir: vdir record %s: %w", vdirID, err)
	}
	connID = vdir.GetString("connection")
	if connID == "" {
		return nil, "", "", "", fmt.Errorf("%w: vdir %s has no connection", ErrInvalidConfig, vdirID)
	}
	root = vdir.GetString("root_path")
	if !strings.HasPrefix(root, "/") {
		return nil, "", "", "", fmt.Errorf("%w: vdir %s root path %q is not absolute", ErrInvalidConfig, vdirID, root)
	}

	// Lexical anchoring — pure CPU, before any manager or dial.
	lexical, err = vdirpath.Resolve(virtualPath)
	if err != nil {
		return nil, "", "", "", err
	}

	mgr, err = r.reg.Manager(connID)
	if err != nil {
		return nil, "", "", "", err
	}
	return mgr, connID, root, lexical, nil
}

// contain is the shared server-side containment check.
func contain(vdirID, virtualPath, target, rootReal string) error {
	if target != rootReal && !strings.HasPrefix(target, rootReal+"/") {
		return fmt.Errorf("%w: vdir %s: %q resolves to %q outside %q",
			ErrEscape, vdirID, virtualPath, target, rootReal)
	}
	return nil
}

// splitLexical splits a canonical root-relative lexical path (""
// denotes the root) into its components.
func splitLexical(lexical string) []string {
	if lexical == "" {
		return nil
	}
	return strings.Split(lexical, "/")
}

// resolveAncestorRemote walks comps under the symlink-free real prefix
// base, following symlinks, and stops at the first component that does
// not exist: it returns the resolved deepest existing ancestor and the
// remaining lexical components (relative to that ancestor) to create.
// A non-directory in the middle of the chain (children can never exist
// under it) is ErrNotADirectory.
func resolveAncestorRemote(cl *sftp.Client, base string, comps []string) (string, []string, error) {
	resolved := base
	queue := comps
	hops := 0
	for len(queue) > 0 {
		comp := queue[0]
		switch comp {
		case "", ".":
			queue = queue[1:]
			continue
		case "..":
			resolved = dirOf(resolved)
			queue = queue[1:]
			continue
		}
		next := resolved + "/" + comp
		fi, err := cl.Lstat(next)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return resolved, queue, nil
			}
			return "", nil, err
		}
		if fi.Mode()&os.ModeSymlink == 0 {
			if !fi.IsDir() && len(queue) > 1 {
				return "", nil, fmt.Errorf("%w: %q", ErrNotADirectory, next)
			}
			resolved = next
			queue = queue[1:]
			continue
		}
		hops++
		if hops > maxSymlinkHops {
			return "", nil, fmt.Errorf("vdir: too many symlink levels resolving %q", next)
		}
		dst, err := cl.ReadLink(next)
		if err != nil {
			return "", nil, err
		}
		if path.IsAbs(dst) {
			resolved = ""
		}
		// relative links continue from the resolved parent
		queue = append(strings.Split(strings.Trim(path.Clean("/"+dst), "/"), "/"), queue[1:]...)
	}
	return resolved, nil, nil
}

// maxSymlinkHops bounds symlink resolution (ELOOP analogue).
const maxSymlinkHops = 40

// resolveRemote fully resolves an absolute remote path server-side:
// every component is Lstat'ed, symlinks are followed (relative ones
// against the resolved prefix), and "."/".." are folded. The result
// is canonical and symlink-free — "" encodes "/". The path must exist.
func resolveRemote(cl *sftp.Client, target string) (string, error) {
	remaining := strings.Split(strings.Trim(path.Clean("/"+target), "/"), "/")
	resolved := "" // symlink-free prefix; "" denotes the root "/"
	hops := 0
	for len(remaining) > 0 {
		comp := remaining[0]
		remaining = remaining[1:]
		switch comp {
		case "", ".":
			continue
		case "..":
			resolved = dirOf(resolved)
			continue
		}
		next := resolved + "/" + comp
		fi, err := cl.Lstat(next)
		if err != nil {
			return "", err
		}
		if fi.Mode()&os.ModeSymlink == 0 {
			resolved = next
			continue
		}
		hops++
		if hops > maxSymlinkHops {
			return "", fmt.Errorf("vdir: too many symlink levels resolving %q", target)
		}
		dst, err := cl.ReadLink(next)
		if err != nil {
			return "", err
		}
		if path.IsAbs(dst) {
			resolved = ""
		}
		// relative links continue from the resolved parent
		remaining = append(strings.Split(strings.Trim(path.Clean("/"+dst), "/"), "/"), remaining...)
	}
	return resolved, nil
}

// dirOf returns the parent of a slash-anchored path ("" is the root).
func dirOf(p string) string {
	i := strings.LastIndex(p, "/")
	if i <= 0 {
		return ""
	}
	return p[:i]
}
