package filelinks

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	// Register the system + app migrations (collections, file_links).
	_ "github.com/pocketbase/pocketbase/migrations"

	_ "github.com/mode777/stratofold/internal/migrations"
)

// TestSweepExpired leaves live links alone and removes expired ones.
func TestSweepExpired(t *testing.T) {
	app := core.NewBaseApp(core.BaseAppConfig{
		DataDir:      t.TempDir(),
		QueryTimeout: core.DefaultQueryTimeout,
	})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := app.RunAllMigrations(); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	t.Cleanup(func() {
		te := new(core.TerminateEvent)
		te.App = app
		_ = app.OnTerminate().Trigger(te, func(e *core.TerminateEvent) error {
			return e.App.ClearBootstrap()
		})
	})

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users: %v", err)
	}
	user := core.NewRecord(users)
	user.SetEmail("sweep@stratofold.test")
	user.SetPassword("sweep-pass-123")
	if err := app.Save(user); err != nil {
		t.Fatalf("save user: %v", err)
	}

	connCol, err := app.FindCollectionByNameOrId("connections")
	if err != nil {
		t.Fatalf("connections: %v", err)
	}
	conn := core.NewRecord(connCol)
	conn.Set("owner", user.Id)
	conn.Set("label", "sweep")
	conn.Set("host", "127.0.0.1")
	conn.Set("port", 22)
	conn.Set("username", "u")
	conn.Set("auth_method", "password")
	conn.Set("password", "p")
	if err := app.Save(conn); err != nil {
		t.Fatalf("save connection: %v", err)
	}
	vdirCol, err := app.FindCollectionByNameOrId("vdirs")
	if err != nil {
		t.Fatalf("vdirs: %v", err)
	}
	vdir := core.NewRecord(vdirCol)
	vdir.Set("owner", user.Id)
	vdir.Set("connection", conn.Id)
	vdir.Set("name", "sweep")
	vdir.Set("root_path", "/srv")
	if err := app.Save(vdir); err != nil {
		t.Fatalf("save vdir: %v", err)
	}

	now := time.Now().UTC()
	live, liveToken, err := createLink(app, vdir.Id, "live.txt", user.Id, now)
	if err != nil {
		t.Fatalf("create live link: %v", err)
	}
	expired, _, err := createLink(app, vdir.Id, "expired.txt", user.Id, now)
	if err != nil {
		t.Fatalf("create expired link: %v", err)
	}
	past, err := types.ParseDateTime(now.Add(-time.Minute))
	if err != nil {
		t.Fatalf("past date: %v", err)
	}
	expired.Set("expires_at", past)
	if err := app.Save(expired); err != nil {
		t.Fatalf("expire link: %v", err)
	}

	// The stored row never contains the plaintext token.
	if live.GetString("token_hash") == liveToken {
		t.Fatal("token stored in plaintext")
	}
	if got := live.GetString("token_hash"); got != hashToken(liveToken) {
		t.Fatalf("token_hash = %q, want the SHA-256 of the token", got)
	}

	if err := sweepExpired(app, now); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	rows, err := app.FindAllRecords("file_links")
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	if len(rows) != 1 || rows[0].Id != live.Id {
		t.Fatalf("sweep left %d rows, want only the live link", len(rows))
	}
}
