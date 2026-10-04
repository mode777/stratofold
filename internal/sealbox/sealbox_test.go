package sealbox

import (
	"bytes"
	cryptorand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	// system migrations create the _params table at Bootstrap.
	_ "github.com/pocketbase/pocketbase/migrations"
)

// newTestApp boots a minimal isolated PocketBase app (sealbox only
// needs the params store; no server wiring).
func newTestApp(tb testing.TB) core.App {
	tb.Helper()
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: tb.TempDir()})
	tb.Cleanup(func() {
		te := new(core.TerminateEvent)
		te.App = app
		_ = app.OnTerminate().Trigger(te, func(e *core.TerminateEvent) error {
			return e.App.ClearBootstrap()
		})
	})
	if err := app.Bootstrap(); err != nil {
		tb.Fatalf("bootstrap: %v", err)
	}
	return app
}

func TestSealOpenRoundTrip(t *testing.T) {
	app := newTestApp(t)
	sb := New(app)

	for _, secret := range [][]byte{
		[]byte("hunter2"),
		[]byte("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----"),
		[]byte(""),
		bytes.Repeat([]byte{0x00}, 256),
	} {
		env, err := sb.Seal(secret)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}
		if !strings.HasPrefix(env, "v1:") {
			t.Fatalf("envelope %q missing v1 prefix", env)
		}
		if len(secret) > 0 && strings.Contains(env, string(secret)) {
			t.Fatalf("envelope contains plaintext")
		}
		got, err := sb.Open(env)
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		if !bytes.Equal(got, secret) {
			t.Fatalf("round-trip mismatch: got %q want %q", got, secret)
		}
	}
}

func TestOpenTamperedFails(t *testing.T) {
	app := newTestApp(t)
	sb := New(app)

	env, err := sb.Seal([]byte("top secret"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(env, "v1:"))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	raw[len(raw)-1] ^= 0x01
	if _, err := sb.Open("v1:" + base64.RawStdEncoding.EncodeToString(raw)); err == nil {
		t.Fatalf("tampered envelope opened")
	}
}

func TestOpenMalformedFails(t *testing.T) {
	app := newTestApp(t)
	sb := New(app)

	for _, env := range []string{"", "garbage", "v1:", "v1:!!!", "v1:AAAA"} {
		if _, err := sb.Open(env); err == nil {
			t.Fatalf("malformed envelope %q opened", env)
		}
	}
}

func TestOpenForeignKeyFails(t *testing.T) {
	app := newTestApp(t)
	sb := New(app)
	env, err := sb.Seal([]byte("data"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	// Same store, foreign key: strip the stored key and inject another.
	other := make([]byte, 32)
	if _, err := cryptorand.Read(other); err != nil {
		t.Fatalf("rand: %v", err)
	}
	foreign := &Sealbox{app: app, key: other}
	if _, err := foreign.Open(env); err == nil {
		t.Fatalf("envelope opened under a foreign key")
	}
}

func TestKeyReusedAcrossInstances(t *testing.T) {
	app := newTestApp(t)
	sb1 := New(app)
	env, err := sb1.Seal([]byte("persisted"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	sb2 := New(app) // fresh instance over the same params store
	got, err := sb2.Open(env)
	if err != nil {
		t.Fatalf("Open with a second instance: %v", err)
	}
	if string(got) != "persisted" {
		t.Fatalf("got %q", got)
	}

	// The key row exists and is a JSON string, not raw key bytes.
	param := &struct {
		Id    string `db:"id"`
		Value string `db:"value"`
	}{}
	if err := app.DB().NewQuery("SELECT id, value FROM _params WHERE id = {:id}").
		Bind(map[string]any{"id": KeyParamID}).One(param); err != nil {
		t.Fatalf("key row: %v", err)
	}
	var b64 string
	if err := json.Unmarshal([]byte(param.Value), &b64); err != nil {
		t.Fatalf("stored key not a JSON string: %v", err)
	}
	key, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(key) != 32 {
		t.Fatalf("stored key malformed: len=%d err=%v", len(key), err)
	}
}
