// Change add-sharing-and-public-access: the vdir_shares collection
// (design D5) and the vdirs read-rule extension to shared users. The
// record API keeps its enforcement in PocketBase rules (architecture:
// "access enforcement happens twice, on purpose") — share management
// and vdir record management stay owner-only; reads extend to grantees.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	core.AppMigrations.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		vdirs, err := app.FindCollectionByNameOrId("vdirs")
		if err != nil {
			return err
		}

		shares := core.NewBaseCollection("vdir_shares")
		shares.Fields.Add(
			&core.RelationField{Name: "vdir", Required: true, MaxSelect: 1, CollectionId: vdirs.Id, CascadeDelete: true},
			&core.RelationField{Name: "user", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
			&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"viewer", "editor"}},
		)
		shares.ListRule = types.Pointer(shareReadRule)
		shares.ViewRule = types.Pointer(shareReadRule)
		// Create binds the share to an own vdir and rejects the
		// meaningless owner-self-share (design D2).
		shares.CreateRule = types.Pointer(shareCreateRule)
		// Update rules evaluate against the stored record: the rebind
		// guards keep an update from re-pointing the share at a foreign
		// vdir or at the vdir's owner (the same :isset pattern as the
		// vdirs update rule below).
		shares.UpdateRule = types.Pointer(shareUpdateRule)
		shares.DeleteRule = types.Pointer(shareDeleteRule)
		shares.AddIndex("idx_vdir_shares_vdir_user", true, "vdir, user", "")
		if err := app.Save(shares); err != nil {
			return err
		}

		// vdirs read access extends to users holding a share on the
		// vdir (back-relation); create/update/delete rules keep their
		// owner-only shape from the connections/vdirs migration.
		vdirs.ListRule = types.Pointer(vdirReadRule)
		vdirs.ViewRule = types.Pointer(vdirReadRule)
		if err := app.Save(vdirs); err != nil {
			return err
		}
		return nil
	}, nil, "1770000002_vdir_shares.go")
}

const (
	shareReadRule   = "@request.auth.id != '' && (vdir.owner = @request.auth.id || user = @request.auth.id)"
	shareCreateRule = "@request.auth.id != '' && @request.body.vdir.owner = @request.auth.id && @request.body.user != @request.body.vdir.owner"
	shareUpdateRule = "@request.auth.id != '' && vdir.owner = @request.auth.id" +
		" && (@request.body.vdir:isset = false || @request.body.vdir.owner = @request.auth.id)" +
		" && (@request.body.user:isset = false || @request.body.user != @request.auth.id)"
	shareDeleteRule = "@request.auth.id != '' && vdir.owner = @request.auth.id"
	vdirReadRule    = "@request.auth.id != '' && (owner = @request.auth.id || vdir_shares_via_vdir.user ?= @request.auth.id)"
)
