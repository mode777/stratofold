package sshconn

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// Default tunables. Exact timings are tunables, not invariants
// (docs/architecture.md).
const (
	DefaultDialTimeout    = 10 * time.Second
	DefaultBackoffBase    = 1 * time.Second
	DefaultBackoffFactor  = 2
	DefaultBackoffCap     = 5 * time.Minute
	DefaultIdleTTL        = 20 * time.Minute
	DefaultMaxSendBuffer  = 2 * 1024 * 1024
	fingerprintSHA256Len  = 43 // raw (unpadded) std base64 of a SHA-256 digest
	fingerprintSHA256Pref = "SHA256:"
)

// Config describes one SSH/SFTP connection target. It is the "connection
// record" key of the manager (persistence comes with later changes).
type Config struct {
	Host string
	Port int
	User string

	Password      string
	PrivateKeyPEM []byte
	Passphrase    string

	// HostKeyFingerprint is the pinned OpenSSH-style fingerprint of the
	// remote host key ("SHA256:<base64>"). Required: a changed host key
	// aborts the connection (ADR 0003).
	HostKeyFingerprint string

	DialTimeout time.Duration
	Backoff     BackoffConfig
	IdleTTL     time.Duration
	// SFTPMaxPacket overrides the SFTP client's max packet size
	// (read/write chunk ceiling). 0 = library default (32 KiB).
	SFTPMaxPacket int
}

func (c *Config) key() string {
	return fmt.Sprintf("ssh://%s@%s:%d", c.User, c.Host, c.Port)
}

func (c *Config) withDefaults() {
	if c.Port == 0 {
		c.Port = 22
	}
	if c.DialTimeout <= 0 {
		c.DialTimeout = DefaultDialTimeout
	}
	c.Backoff = c.Backoff.withDefaults()
	if c.IdleTTL <= 0 {
		c.IdleTTL = DefaultIdleTTL
	}
}

// Fingerprint returns the OpenSSH SHA256 fingerprint of a public key.
func Fingerprint(pub ssh.PublicKey) string {
	sum := sha256.Sum256(pub.Marshal())
	return fingerprintSHA256Pref + base64.RawStdEncoding.EncodeToString(sum[:])
}

// validateFingerprint checks the pinned fingerprint format.
func validateFingerprint(fp string) error {
	if !strings.HasPrefix(fp, fingerprintSHA256Pref) {
		return fmt.Errorf("sshconn: host key fingerprint must start with %q", fingerprintSHA256Pref)
	}
	b64 := strings.TrimPrefix(fp, fingerprintSHA256Pref)
	if len(b64) != fingerprintSHA256Len {
		return fmt.Errorf("sshconn: host key fingerprint has wrong length %d, want %d", len(b64), fingerprintSHA256Len)
	}
	if _, err := base64.RawStdEncoding.DecodeString(b64); err != nil {
		return fmt.Errorf("sshconn: host key fingerprint is not valid base64: %w", err)
	}
	return nil
}
