// Change fix-web-ui-and-session-lifetime: login sessions last the
// maximum supported lifetime. The users auth collection's token
// duration is raised to the validated maximum PocketBase v0.40.4
// accepts (TokenConfig.Validate pins Duration to [10, 94670856] —
// ~3 years; the built-in default is 432000 = 5 days). The sf_session
// cookie's MaxAge follows this value (authbridge), so one collection
// field stays the single source of truth. A new migration entry is
// required because migrations are append-only
// (1770000001_connections_vdirs.go is already applied).
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

// MaxAuthTokenDuration is the largest auth-token duration (seconds)
// PocketBase v0.40.4 validates: ~3 years.
const MaxAuthTokenDuration int64 = 94670856

func init() {
	core.AppMigrations.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		users.AuthToken.Duration = MaxAuthTokenDuration

		return app.Save(users)
	}, nil, "1770000004_users_token_lifetime.go")
}
