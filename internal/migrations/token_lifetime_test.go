package migrations_test

import (
	"testing"

	"github.com/mode777/stratofold/internal/migrations"
	"github.com/mode777/stratofold/internal/testapp"
)

// TestUsersAuthTokenLifetime pins the maximum-lifetime session config
// (change fix-web-ui-and-session-lifetime, design D2): after migrations
// the users collection issues auth tokens valid for the platform's
// validated maximum duration.
func TestUsersAuthTokenLifetime(t *testing.T) {
	s := testapp.Start(t)

	users, err := s.App.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	if got := users.AuthToken.Duration; got != migrations.MaxAuthTokenDuration {
		t.Fatalf("users authToken duration = %d, want %d (platform maximum)", got, migrations.MaxAuthTokenDuration)
	}
	// The value must stay within PocketBase's validated range, or every
	// subsequent collection save (including record-triggered ones) would
	// fail validation.
	if users.AuthToken.Duration != 94670856 {
		t.Fatalf("authToken duration %d is not the validated maximum 94670856", users.AuthToken.Duration)
	}
}
