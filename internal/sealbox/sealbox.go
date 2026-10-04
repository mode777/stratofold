// Package sealbox seals small server-side secrets (connection
// credentials) with AES-256-GCM under a random 32-byte key persisted
// once in PocketBase's internal params store, so secrets are encrypted
// at rest and plaintext exists only in memory (change design D2).
package sealbox

import (
	"crypto/aes"
	"crypto/cipher"
	cryptorand "crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	// KeyParamID is the _params row id holding the base64 sealing key.
	KeyParamID = "sf_sealbox_key"

	// envelopePrefix versions the envelope format (v1 = nonce||ct).
	envelopePrefix = "v1:"

	keyLen   = 32
	nonceLen = 12
)

// ErrUnsealable reports a secret that cannot be unsealed (tampered
// envelope, foreign key, malformed input). Callers surface it as a
// permanent configuration error, never as a retryable failure.
var ErrUnsealable = errors.New("sealbox: secret cannot be unsealed with the current key")

// Sealbox seals and opens secrets under the app-persisted key.
type Sealbox struct {
	app core.App

	mu  sync.Mutex
	key []byte
}

// New returns a Sealbox over the app's params store.
func New(app core.App) *Sealbox { return &Sealbox{app: app} }

// Seal encrypts plaintext into the v1 envelope.
func (s *Sealbox) Seal(plaintext []byte) (string, error) {
	gcm, err := s.aead()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, nonceLen)
	if _, err := cryptorand.Read(nonce); err != nil {
		return "", fmt.Errorf("sealbox: nonce: %w", err)
	}
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return envelopePrefix + base64.RawStdEncoding.EncodeToString(sealed), nil
}

// Open decrypts a v1 envelope. Any malformed or foreign-key envelope
// fails with [ErrUnsealable].
func (s *Sealbox) Open(envelope string) ([]byte, error) {
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(envelope, envelopePrefix))
	if err != nil || !strings.HasPrefix(envelope, envelopePrefix) {
		return nil, fmt.Errorf("%w: malformed envelope", ErrUnsealable)
	}
	gcm, err := s.aead()
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.Overhead()+nonceLen {
		return nil, fmt.Errorf("%w: envelope too short", ErrUnsealable)
	}
	plain, err := gcm.Open(nil, raw[:nonceLen], raw[nonceLen:], nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsealable, err)
	}
	return plain, nil
}

func (s *Sealbox) aead() (cipher.AEAD, error) {
	key, err := s.loadKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("sealbox: cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("sealbox: gcm: %w", err)
	}
	return gcm, nil
}

// loadKey returns the persisted key, creating and storing a random one
// on first use. The in-process mutex makes create-on-miss atomic for
// the single-process deployment model (ADR 0001).
func (s *Sealbox) loadKey() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key != nil {
		return s.key, nil
	}

	param := &core.Param{}
	err := s.app.ModelQuery(param).Model(KeyParamID, param)
	switch {
	case err == nil:
		var b64 string
		if err := json.Unmarshal(param.Value, &b64); err != nil {
			return nil, fmt.Errorf("sealbox: stored key %q is not a JSON string: %w", KeyParamID, err)
		}
		key, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(key) != keyLen {
			return nil, fmt.Errorf("sealbox: stored key %q is malformed", KeyParamID)
		}
		s.key = key
		return s.key, nil
	case isNoRows(err):
		key := make([]byte, keyLen)
		if _, err := cryptorand.Read(key); err != nil {
			return nil, fmt.Errorf("sealbox: key generation: %w", err)
		}
		raw, err := json.Marshal(base64.StdEncoding.EncodeToString(key))
		if err != nil {
			return nil, err
		}
		param.Id = KeyParamID
		param.Value = types.JSONRaw(raw)
		if err := s.app.Save(param); err != nil {
			return nil, fmt.Errorf("sealbox: persist key: %w", err)
		}
		s.key = key
		return s.key, nil
	default:
		return nil, fmt.Errorf("sealbox: load key: %w", err)
	}
}

func isNoRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }
