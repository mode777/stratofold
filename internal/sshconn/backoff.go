package sshconn

import (
	"math/rand"
	"time"
)

// BackoffConfig shapes the exponential backoff between reconnect
// attempts. Defaults per docs/architecture.md: base ~1s, factor 2,
// cap ~5min, with jitter.
type BackoffConfig struct {
	Base   time.Duration
	Factor float64
	Cap    time.Duration
	Jitter bool
}

func (b BackoffConfig) withDefaults() BackoffConfig {
	if b.Base <= 0 {
		b.Base = DefaultBackoffBase
	}
	if b.Factor <= 0 {
		b.Factor = DefaultBackoffFactor
	}
	if b.Cap <= 0 {
		b.Cap = DefaultBackoffCap
	}
	return b
}

// Backoff produces the delay before the next reconnect attempt. Not
// safe for concurrent use; the manager serializes access.
type Backoff struct {
	cfg      BackoffConfig
	attempts int
	rng      *rand.Rand
}

// NewBackoff returns a backoff over cfg. When jitter is enabled, rng
// must be non-nil.
func NewBackoff(cfg BackoffConfig, rng *rand.Rand) *Backoff {
	return &Backoff{cfg: cfg.withDefaults(), rng: rng}
}

// Reset clears the attempt counter (called after a successful dial).
func (b *Backoff) Reset() { b.attempts = 0 }

// Attempts reports how many consecutive failures have occurred.
func (b *Backoff) Attempts() int { return b.attempts }

// Next returns the delay for the next attempt and records it.
func (b *Backoff) Next() time.Duration {
	d := b.raw()
	b.attempts++
	if b.cfg.Jitter && b.rng != nil {
		d = d/2 + time.Duration(b.rng.Int63n(int64(d/2)+1))
	}
	return d
}

func (b *Backoff) raw() time.Duration {
	d := b.cfg.Base
	for i := 0; i < b.attempts; i++ {
		d = time.Duration(float64(d) * b.cfg.Factor)
		if d >= b.cfg.Cap {
			return b.cfg.Cap
		}
	}
	if d > b.cfg.Cap {
		d = b.cfg.Cap
	}
	return d
}
