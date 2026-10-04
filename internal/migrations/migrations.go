// Package migrations registers the Stratofold application migrations:
// the connections/vdirs collections with owner-only API rules (change
// design D1/D6) and the vdir_shares sharing collections/rules. Migrations
// apply on serve (apis.Serve runs them) and at Bootstrap via
// appserver.Install's hook; both are idempotent.
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

		connections := core.NewBaseCollection("connections")
		connections.Fields.Add(
			&core.RelationField{Name: "owner", Required: true, MaxSelect: 1, CollectionId: users.Id},
			&core.TextField{Name: "label", Required: true},
			&core.TextField{Name: "host", Required: true},
			&core.NumberField{Name: "port"},
			&core.TextField{Name: "username", Required: true},
			&core.SelectField{Name: "auth_method", Required: true, MaxSelect: 1, Values: []string{"password", "key"}},
			// Secret fields are plain text so the owner can write them
			// over the record API (PocketBase rejects writes to Hidden
			// fields); they are sealed at rest and stripped from every
			// API response by connreg's record hooks (design D2).
			&core.TextField{Name: "password"},
			&core.TextField{Name: "private_key"},
			&core.TextField{Name: "key_passphrase"},
			&core.TextField{Name: "host_key_fingerprint", Required: true},
		)
		connections.ListRule = types.Pointer(ownerRule)
		connections.ViewRule = types.Pointer(ownerRule)
		connections.CreateRule = types.Pointer(createRule)
		connections.UpdateRule = types.Pointer(ownerRule)
		connections.DeleteRule = types.Pointer(ownerRule)
		if err := app.Save(connections); err != nil {
			return err
		}

		vdirs := core.NewBaseCollection("vdirs")
		vdirs.Fields.Add(
			&core.RelationField{Name: "owner", Required: true, MaxSelect: 1, CollectionId: users.Id},
			&core.RelationField{Name: "connection", Required: true, MaxSelect: 1, CollectionId: connections.Id, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true},
			&core.TextField{Name: "root_path", Required: true},
			&core.BoolField{Name: "is_public"},
		)
		vdirs.ListRule = types.Pointer(ownerRule)
		vdirs.ViewRule = types.Pointer(ownerRule)
		vdirs.CreateRule = types.Pointer(createRule + " && @request.body.connection.owner = @request.auth.id")
		// PB evaluates update rules against the stored record, so the
		// cross-owner rebind guard must inspect @request.body: reject
		// when the payload rebinds connection to a foreign record.
		vdirs.UpdateRule = types.Pointer(ownerRule +
			" && (@request.body.connection:isset = false || @request.body.connection.owner = @request.auth.id)")
		vdirs.DeleteRule = types.Pointer(ownerRule)
		vdirs.AddIndex("idx_vdirs_owner_name", true, "owner, name", "")
		if err := app.Save(vdirs); err != nil {
			return err
		}
		return nil
	}, nil, "1770000001_connections_vdirs.go")
}

const (
	ownerRule  = "@request.auth.id != '' && owner = @request.auth.id"
	createRule = "@request.auth.id != '' && @request.body.owner = @request.auth.id"
)
