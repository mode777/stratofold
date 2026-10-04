// Package connreg bridges connection records to SSH connection
// managers: one sshconn.Manager per connections record, built lazily
// from the unsealed record fields (design D3). It also owns the
// connection-record lifecycle hooks — sealing secrets on write,
// hiding them on read (D2), and invalidating the cached manager on
// record change — plus close-all on app terminate.
package connreg

import (
	"fmt"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/mode777/stratofold/internal/sealbox"
	"github.com/mode777/stratofold/internal/sshconn"
	"github.com/mode777/stratofold/internal/ssherr"
)

// StoreKey is the app.Store key under which the registry is stashed.
const StoreKey = "sfConnreg"

// SecretFields are the connection record fields that hold credential
// material: sealed at rest, hidden from every API response.
var SecretFields = []string{"password", "private_key", "key_passphrase"}

// Registry caches one Manager per connection record.
type Registry struct {
	app  core.App
	sb   *sealbox.Sealbox
	opts []sshconn.Option

	mu   sync.Mutex
	mgrs map[string]*sshconn.Manager
}

// New returns a registry over the app (hooks not registered; use
// Register for the production wiring).
func New(app core.App, opts ...sshconn.Option) *Registry {
	return &Registry{app: app, sb: sealbox.New(app), opts: opts, mgrs: map[string]*sshconn.Manager{}}
}

// Register creates the app's registry, binds the record lifecycle
// hooks (seal on write, hide on read, invalidate on change, close on
// terminate) and stashes the registry in app.Store under StoreKey.
func Register(app core.App, opts ...sshconn.Option) *Registry {
	reg := New(app, opts...)

	app.OnRecordCreate("connections").BindFunc(func(e *core.RecordEvent) error {
		return sealSecrets(e, reg.sb)
	})
	app.OnRecordUpdate("connections").BindFunc(func(e *core.RecordEvent) error {
		return sealSecrets(e, reg.sb)
	})
	app.OnRecordEnrich("connections").BindFunc(func(e *core.RecordEnrichEvent) error {
		e.Record.Hide(SecretFields...)
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("connections").BindFunc(func(e *core.RecordEvent) error {
		reg.Invalidate(e.Record.Id)
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("connections").BindFunc(func(e *core.RecordEvent) error {
		reg.Invalidate(e.Record.Id)
		return e.Next()
	})
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		reg.CloseAll()
		return e.Next()
	})

	app.Store().Set(StoreKey, reg)
	return reg
}

// FromApp returns the registry stashed by Register (nil if absent).
func FromApp(app core.App) *Registry {
	reg, _ := app.Store().Get(StoreKey).(*Registry)
	return reg
}

// Manager returns the (cached) manager for the connection record,
// building it on first use from the unsealed record fields. Build
// failures (e.g. unsealable credentials) surface as permanent errors.
func (r *Registry) Manager(recordID string) (*sshconn.Manager, error) {
	r.mu.Lock()
	if m, ok := r.mgrs[recordID]; ok {
		r.mu.Unlock()
		return m, nil
	}
	r.mu.Unlock()

	rec, err := r.app.FindRecordById("connections", recordID)
	if err != nil {
		return nil, fmt.Errorf("connreg: connection record %s: %w", recordID, err)
	}
	cfg, err := r.configFromRecord(rec)
	if err != nil {
		return nil, err
	}
	m, err := sshconn.NewManager(cfg, r.opts...)
	if err != nil {
		return nil, fmt.Errorf("%w: connection record %s: %v", ssherr.ErrConfiguration, recordID, err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if cached, ok := r.mgrs[recordID]; ok {
		// Raced with another build; drop ours and reuse the winner
		// (both are equivalent — same record fields).
		_ = m.Close()
		return cached, nil
	}
	r.mgrs[recordID] = m
	return m, nil
}

// Invalidate closes and drops the cached manager for the record, so
// the next use rebuilds from current fields.
func (r *Registry) Invalidate(recordID string) {
	r.mu.Lock()
	m := r.mgrs[recordID]
	delete(r.mgrs, recordID)
	r.mu.Unlock()
	if m != nil {
		_ = m.Close()
	}
}

// CloseAll closes every cached manager (app terminate).
func (r *Registry) CloseAll() {
	r.mu.Lock()
	mgrs := r.mgrs
	r.mgrs = map[string]*sshconn.Manager{}
	r.mu.Unlock()
	for _, m := range mgrs {
		_ = m.Close()
	}
}

func (r *Registry) configFromRecord(rec *core.Record) (sshconn.Config, error) {
	cfg := sshconn.Config{
		Host:               rec.GetString("host"),
		Port:               int(rec.GetInt("port")),
		User:               rec.GetString("username"),
		HostKeyFingerprint: rec.GetString("host_key_fingerprint"),
	}
	switch rec.GetString("auth_method") {
	case "password":
		pw, err := r.unsealSecret(rec, "password")
		if err != nil {
			return cfg, err
		}
		cfg.Password = pw
	case "key":
		pem, err := r.unsealSecret(rec, "private_key")
		if err != nil {
			return cfg, err
		}
		cfg.PrivateKeyPEM = []byte(pem)
		if rec.GetString("key_passphrase") != "" {
			pp, err := r.unsealSecret(rec, "key_passphrase")
			if err != nil {
				return cfg, err
			}
			cfg.Passphrase = pp
		}
	default:
		return cfg, fmt.Errorf("%w: connection record %s: unknown auth method %q",
			ssherr.ErrConfiguration, rec.Id, rec.GetString("auth_method"))
	}
	return cfg, nil
}

func (r *Registry) unsealSecret(rec *core.Record, field string) (string, error) {
	raw := rec.GetString(field)
	if raw == "" {
		return "", fmt.Errorf("%w: connection record %s: empty secret %q",
			ssherr.ErrConfiguration, rec.Id, field)
	}
	plain, err := r.sb.Open(raw)
	if err != nil {
		return "", fmt.Errorf("%w: connection record %s: secret %q: %v",
			ssherr.ErrConfiguration, rec.Id, field, err)
	}
	return string(plain), nil
}

// sealSecrets replaces plaintext secret values with sealed envelopes
// (idempotent: values already carrying the v1 prefix pass through).
func sealSecrets(e *core.RecordEvent, sb *sealbox.Sealbox) error {
	for _, field := range SecretFields {
		val := e.Record.GetString(field)
		if val == "" || strings.HasPrefix(val, envelopePrefix) {
			continue
		}
		env, err := sb.Seal([]byte(val))
		if err != nil {
			return fmt.Errorf("connreg: seal %q: %w", field, err)
		}
		e.Record.Set(field, env)
	}
	return e.Next()
}

const envelopePrefix = "v1:"
