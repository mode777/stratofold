// Conditional-upload primitives: If-Match parsing, the target snapshot
// used by both the advisory and authoritative checks, the per-target
// publication lock, and the generation reservation (design D5/D6).
package fsapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/pkg/sftp"
	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/fileversion"
	"github.com/mode777/stratofold/internal/sshconn"
)

// ifMatch is the parsed If-Match precondition. present=false is the
// no-header path, which keeps today's create-or-replace semantics.
type ifMatch struct {
	present bool
	star    bool
	tags    []string
}

// parseIfMatch parses the strong entity-tag list grammar. Weak tags are
// syntactically accepted but never match (strong comparison). An empty
// field, a malformed tag, or `*` mixed with tags is a bad request.
func parseIfMatch(headers []string) (ifMatch, error) {
	if len(headers) == 0 {
		return ifMatch{}, nil
	}
	raw := strings.Join(headers, ",")
	if strings.TrimSpace(raw) == "" {
		return ifMatch{}, fmt.Errorf("%w: empty If-Match", errBadRequest)
	}
	if strings.TrimSpace(raw) == "*" {
		return ifMatch{present: true, star: true}, nil
	}
	var tags []string
	for _, part := range strings.Split(raw, ",") {
		tag := strings.TrimSpace(part)
		if tag == "" {
			return ifMatch{}, fmt.Errorf("%w: malformed If-Match", errBadRequest)
		}
		if tag == "*" {
			return ifMatch{}, fmt.Errorf("%w: If-Match mixes * with entity tags", errBadRequest)
		}
		weak := strings.HasPrefix(tag, "W/")
		if weak {
			tag = tag[2:]
		}
		if len(tag) < 2 || tag[0] != '"' || tag[len(tag)-1] != '"' {
			return ifMatch{}, fmt.Errorf("%w: malformed If-Match entity tag", errBadRequest)
		}
		opaque := tag[1 : len(tag)-1]
		if opaque == "" || strings.ContainsAny(opaque, "\"\\") {
			return ifMatch{}, fmt.Errorf("%w: malformed If-Match entity tag", errBadRequest)
		}
		if !weak {
			tags = append(tags, opaque)
		}
	}
	return ifMatch{present: true, tags: tags}, nil
}

// matches applies strong comparison to the current target. A missing
// target matches neither `*` nor any entity tag.
func (m ifMatch) matches(version string, exists bool) bool {
	if !m.present {
		return true
	}
	if m.star {
		return exists
	}
	if !exists {
		return false
	}
	for _, tag := range m.tags {
		if tag == version {
			return true
		}
	}
	return false
}

// preconditionError is permanent and maps to 412. It carries the
// current version when the target exists so a client can resync.
type preconditionError struct {
	version    string
	hasVersion bool
}

func (e *preconditionError) Error() string { return "fsapi: precondition failed" }

// targetState is the version-relevant snapshot of the publish target.
type targetState struct {
	exists  bool
	version string
	kind    string
	size    int64
	mtime   int64
	dir     bool
}

// sameSignature reports whether the fields that feed the version hash
// are unchanged. It deliberately does not compare the version itself:
// a retry after our own reservation has a new generation but the same
// signature.
func (s targetState) sameSignature(other targetState) bool {
	if s.exists != other.exists {
		return false
	}
	if !s.exists {
		return true
	}
	return s.kind == other.kind && s.size == other.size && s.mtime == other.mtime
}

func isNoSuchFile(err error) bool {
	return errors.Is(err, os.ErrNotExist) || errors.Is(err, sftp.ErrSSHFxNoSuchFile)
}

// statTarget snapshots one resolved remote path and derives its
// version. A missing target is a valid snapshot (exists=false), not an
// error.
func statTarget(app core.App, vdirID, connectionID, remotePath string, cl *sftp.Client) (targetState, error) {
	st, err := cl.Stat(remotePath)
	if err != nil {
		if isNoSuchFile(err) {
			return targetState{}, nil
		}
		return targetState{}, err
	}
	version, err := fileversion.Version(app, vdirID, connectionID, remotePath, st)
	if err != nil {
		return targetState{}, err
	}
	kind := "file"
	if st.IsDir() {
		kind = "directory"
	}
	return targetState{
		exists:  true,
		version: version,
		kind:    kind,
		size:    st.Size(),
		mtime:   st.ModTime().Unix(),
		dir:     st.IsDir(),
	}, nil
}

// checkIfMatch is the advisory, pre-body check: fail fast before
// streaming a body that can never publish. The publish-time check
// remains authoritative.
func checkIfMatch(ctx context.Context, app core.App, vdirID, connectionID string,
	provider sshconn.ClientProvider, remotePath string, im ifMatch) error {
	var st targetState
	err := withRetry(ctx, provider, MaxAttempts, func(cl *sftp.Client) error {
		s, serr := statTarget(app, vdirID, connectionID, remotePath, cl)
		if serr != nil {
			return serr
		}
		st = s
		return nil
	})
	if err != nil {
		return err
	}
	if !im.matches(st.version, st.exists) {
		return &preconditionError{version: st.version, hasVersion: st.exists}
	}
	return nil
}

// targetLock serializes publications to one target within this process.
// Multi-instance deployment is a non-goal (ADR 0001); external SFTP
// writers never take it.
type targetLock struct {
	mu   sync.Mutex
	refs int
}

var targetLocks = struct {
	sync.Mutex
	m map[string]*targetLock
}{m: map[string]*targetLock{}}

func lockTarget(key string) func() {
	targetLocks.Lock()
	entry := targetLocks.m[key]
	if entry == nil {
		entry = &targetLock{}
		targetLocks.m[key] = entry
	}
	entry.refs++
	targetLocks.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		targetLocks.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(targetLocks.m, key)
		}
		targetLocks.Unlock()
	}
}

// conditionalPublisher carries state across reconnect retries within
// one upload request. reserved is the generation this request wrote
// before its rename; a retry must distinguish its own reservation from
// another writer's publication.
type conditionalPublisher struct {
	app          core.App
	vdirID       string
	connectionID string
	target       string
	temp         string
	im           ifMatch
	reserved     int64
	pre          targetState
	published    bool
}

// publish runs one attempt under the target lock. The first attempt
// checks the precondition, reserves a generation, and renames. A retry
// does not re-check the consumed client precondition; it verifies that
// its reservation is still current and the target signature has not
// changed, then finishes the rename.
func (p *conditionalPublisher) publish(cl *sftp.Client) error {
	unlock := lockTarget(p.vdirID + "\x00" + p.target)
	defer unlock()

	if p.reserved == 0 {
		if p.im.present {
			current, err := statTarget(p.app, p.vdirID, p.connectionID, p.target, cl)
			if err != nil {
				return err
			}
			if !p.im.matches(current.version, current.exists) {
				return &preconditionError{version: current.version, hasVersion: current.exists}
			}
			p.pre = current
		}
		gen, err := fileversion.Bump(p.app, p.vdirID, p.target)
		if err != nil {
			return err
		}
		p.reserved = gen
	} else {
		if _, err := cl.Lstat(p.temp); err != nil {
			if isNoSuchFile(err) {
				if _, terr := cl.Lstat(p.target); terr == nil {
					p.published = true
					return nil // an earlier attempt's rename was applied
				}
				return fmt.Errorf("fsapi: upload temp vanished: %w", os.ErrNotExist)
			}
			return err
		}
		if p.im.present {
			current, err := statTarget(p.app, p.vdirID, p.connectionID, p.target, cl)
			if err != nil {
				return err
			}
			if !p.pre.sameSignature(current) {
				return &preconditionError{version: current.version, hasVersion: current.exists}
			}
			gen, err := fileversion.Generation(p.app, p.vdirID, p.target)
			if err != nil {
				return err
			}
			if gen != p.reserved {
				return &preconditionError{version: current.version, hasVersion: current.exists}
			}
		}
	}

	if err := publish(cl, p.temp, p.target); err != nil {
		return err
	}
	p.published = true
	return nil
}
