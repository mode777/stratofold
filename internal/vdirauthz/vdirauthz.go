// Package vdirauthz resolves a request's effective access to a virtual
// directory (change design D1): owner, a vdir_shares grant
// (viewer/editor), or none — plus the record's public flag. Both remote
// surfaces (/files/* and /api/sf/*) call it, so they cannot drift; the
// resolution is a per-request SQLite read, which makes revocation
// immediate by construction (design D4). It never dials SSH.
package vdirauthz

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Access is the effective role a requester holds on a vdir, ordered so
// comparisons work: Owner can do everything an Editor can, an Editor
// everything a Viewer can.
type Access int

const (
	None Access = iota
	Viewer
	Editor
	Owner
)

// Decision is the per-request access resolution for one requester on
// one vdir. Public mirrors the record's is_public flag — it grants
// read-only access to anonymous requests and never write.
type Decision struct {
	Access Access
	Public bool
}

// CanRead reports whether the decision covers read operations
// (listing, download): any grant level, or an anonymous request on a
// public vdir.
func (d Decision) CanRead() bool { return d.Public || d.Access >= Viewer }

// CanWrite reports whether the decision covers mutating operations
// (mkdir, mv, rm, upload): the owner or an editor — on public vdirs
// just as elsewhere.
func (d Decision) CanWrite() bool { return d.Access >= Editor }

// Resolve computes the decision for userID ("" for anonymous) on the
// given vdir record. The share lookup is the current indexed
// (vdir, user) row — no caching — so deleting or re-roleing a share
// applies to the next request even with a still-valid session.
func Resolve(app core.App, vd *core.Record, userID string) Decision {
	d := Decision{Public: vd.GetBool("is_public")}
	if userID == "" {
		return d
	}
	if vd.GetString("owner") == userID {
		// Owner outranks any share; a share naming the owner cannot
		// exist through the API (rule-guarded) and would be redundant.
		d.Access = Owner
		return d
	}
	share, err := app.FindFirstRecordByFilter("vdir_shares",
		"vdir = {:v} && user = {:u}", dbx.Params{"v": vd.Id, "u": userID})
	if err != nil || share == nil {
		return d
	}
	switch share.GetString("role") {
	case "editor":
		d.Access = Editor
	case "viewer":
		d.Access = Viewer
	}
	return d
}
