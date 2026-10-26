// Change add-expiring-file-links: the file_links collection (design
// D10) — one row per minted temporary file link. Rows are created and
// read only by the custom /api/sf/.../links and /s/ routes; the record
// API rules are deliberately unset (superuser-only), so no client can
// enumerate links. Tokens themselves are stored only as a SHA-256 hash.
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

		links := core.NewBaseCollection("file_links")
		links.Fields.Add(
			&core.RelationField{Name: "vdir", Required: true, MaxSelect: 1, CollectionId: vdirs.Id, CascadeDelete: true},
			&core.TextField{Name: "path", Required: true},
			&core.RelationField{Name: "created_by", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
			&core.TextField{Name: "token_hash", Required: true},
			&core.DateField{Name: "expires_at", Required: true},
		)
		// No List/View/Create/Update/Delete rules: superusers only.
		links.AddIndex("idx_file_links_token_hash", true, "token_hash", "")
		links.AddIndex("idx_file_links_expires_at", false, "expires_at", "")
		return app.Save(links)
	}, nil, "1770000005_file_links.go")
}
