// Change add-pretty-public-urls (design D1/D2): vdirs gain an optional
// globally unique public name used by the /apps/<name> surface. The
// partial unique index lets every unnamed vdir coexist while making a
// registered name unique across all users. Existing rows stay unnamed.
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

		vdirs.Fields.Add(&core.TextField{
			Name:    "public_slug",
			Min:     2,
			Max:     63,
			Pattern: `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`,
		})
		// A global namespace, not per owner: empty values are excluded so
		// every unnamed vdir can coexist under the same index.
		vdirs.AddIndex("idx_vdirs_public_slug", true, "public_slug", "public_slug != ''")
		return app.Save(vdirs)
	}, nil, "1770000009_vdir_public_slug.go")
}
