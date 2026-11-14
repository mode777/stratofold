// Change add-file-stat-and-conditional-upload: the internal
// file_versions collection stores one publication counter per
// (vdir, resolved remote path). It is deliberately not a file cache:
// no content, size, mtime, or hash is stored, only the generation that
// makes a same-size/same-second upload produce a different version.
// Rows are written only by internal/fileversion; the record-API rules
// are unset, so the collection is superuser-only.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(app core.App) error {
		vdirs, err := app.FindCollectionByNameOrId("vdirs")
		if err != nil {
			return err
		}

		versions := core.NewBaseCollection("file_versions")
		versions.Fields.Add(
			&core.RelationField{
				Name:          "vdir",
				Required:      true,
				MaxSelect:     1,
				CollectionId:  vdirs.Id,
				CascadeDelete: true,
			},
			&core.TextField{Name: "remote_path", Required: true},
			&core.NumberField{Name: "generation", Required: true},
		)
		// No List/View/Create/Update/Delete rules: internal bookkeeping.
		versions.AddIndex("idx_file_versions_vdir_path", true, "vdir, remote_path", "")
		return app.Save(versions)
	}, nil, "1770000008_file_versions.go")
}
