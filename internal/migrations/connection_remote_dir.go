// Change add-optional-hostkey-and-remote-dir: the connections collection
// gains an optional remote directory (the default base a vdir on that
// connection starts from) and the pinned host-key fingerprint becomes
// optional (trust on first use captures it; design D1/D4). A new
// migration entry is required because 1770000001_connections_vdirs.go is
// already applied.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(app core.App) error {
		connections, err := app.FindCollectionByNameOrId("connections")
		if err != nil {
			return err
		}

		if f, ok := connections.Fields.GetByName("host_key_fingerprint").(*core.TextField); ok {
			f.Required = false
		}
		if connections.Fields.GetByName("remote_dir") == nil {
			connections.Fields.Add(&core.TextField{Name: "remote_dir"})
		}
		return app.Save(connections)
	}, nil, "1770000003_connection_remote_dir.go")
}
