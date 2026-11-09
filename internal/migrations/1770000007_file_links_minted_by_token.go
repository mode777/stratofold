// Change add-vdir-access-tokens: file links minted through a bearer
// token remember their source token. A nullable relation keeps
// cookie-minted links valid; cascade delete makes revoking the token
// remove its links with it.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(app core.App) error {
		tokens, err := app.FindCollectionByNameOrId("vdir_tokens")
		if err != nil {
			return err
		}
		links, err := app.FindCollectionByNameOrId("file_links")
		if err != nil {
			return err
		}
		if links.Fields.GetByName("minted_by_token") == nil {
			links.Fields.Add(&core.RelationField{
				Name:          "minted_by_token",
				MaxSelect:     1,
				CollectionId:  tokens.Id,
				CascadeDelete: true,
			})
		}
		return app.Save(links)
	}, nil, "1770000007_file_links_minted_by_token.go")
}
