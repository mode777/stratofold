package testapp_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mode777/stratofold/internal/testapp"
)

func TestBootsRealServerWithBuiltins(t *testing.T) {
	s := testapp.Start(t)

	t.Run("users collection exists", func(t *testing.T) {
		if _, err := s.App.FindCollectionByNameOrId("users"); err != nil {
			t.Fatalf("users collection: %v", err)
		}
	})

	t.Run("builtin users auth endpoint authenticates seeded user", func(t *testing.T) {
		body, err := json.Marshal(map[string]string{
			"identity": testapp.TestUserEmail,
			"password": testapp.TestUserPassword,
		})
		if err != nil {
			t.Fatal(err)
		}
		resp, err := http.Post(s.BaseURL+"/api/collections/users/auth-with-password", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("builtin auth-with-password: status %d, want 200", resp.StatusCode)
		}
		var out struct {
			Token  string `json:"token"`
			Record struct {
				Email string `json:"email"`
			} `json:"record"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		if out.Token == "" {
			t.Fatal("builtin auth-with-password: empty token")
		}
		if out.Record.Email != testapp.TestUserEmail {
			t.Fatalf("authenticated record email %q, want %q", out.Record.Email, testapp.TestUserEmail)
		}
	})
}
