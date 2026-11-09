// Change add-vdir-access-tokens: the vdir_tokens collection — one row
// per user-minted, single-vdir bearer credential. Rows are created and
// read only by the custom /api/sf/tokens routes; the record API rules
// are deliberately unset (superuser-only). Tokens are stored only as a
// SHA-256 hash plus a non-secret hint.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
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

		tokens := core.NewBaseCollection("vdir_tokens")
		tokens.Fields.Add(
			&core.RelationField{Name: "user", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
			&core.RelationField{Name: "vdir", Required: true, MaxSelect: 1, CollectionId: vdirs.Id, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true, Max: 100},
			&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"viewer", "editor"}},
			&core.TextField{Name: "token_hash", Required: true},
			&core.TextField{Name: "token_hint", Required: true},
			&core.DateField{Name: "expires_at"},
			&core.DateField{Name: "last_used_at"},
		)
		// No List/View/Create/Update/Delete rules: superusers only.
		tokens.AddIndex("idx_vdir_tokens_token_hash", true, "token_hash", "")
		tokens.AddIndex("idx_vdir_tokens_user", false, "user", "")
		tokens.AddIndex("idx_vdir_tokens_vdir", false, "vdir", "")
		tokens.AddIndex("idx_vdir_tokens_expires_at", false, "expires_at", "")
		return app.Save(tokens)
	}, nil, "1770000006_vdir_tokens.go")
}
