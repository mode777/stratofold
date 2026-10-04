package sshconn

import (
	"math/rand"
	"testing"
	"time"
)

func TestBackoffSequence(t *testing.T) {
	b := NewBackoff(BackoffConfig{Base: time.Second, Factor: 2, Cap: 5 * time.Minute, Jitter: false}, nil)
	want := []time.Duration{
		1 * time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second,
		16 * time.Second, 32 * time.Second, 64 * time.Second, 128 * time.Second,
		256 * time.Second, 300 * time.Second, 300 * time.Second, 300 * time.Second,
	}
	for i, w := range want {
		if got := b.Next(); got != w {
			t.Fatalf("attempt %d: Next() = %v, want %v", i, got, w)
		}
	}
}

func TestBackoffReset(t *testing.T) {
	b := NewBackoff(BackoffConfig{Base: time.Second, Factor: 2, Cap: time.Minute, Jitter: false}, nil)
	b.Next()
	b.Next()
	if b.Attempts() != 2 {
		t.Fatalf("Attempts() = %d, want 2", b.Attempts())
	}
	b.Reset()
	if got := b.Next(); got != time.Second {
		t.Fatalf("after Reset: Next() = %v, want 1s", got)
	}
}

func TestBackoffJitterBounds(t *testing.T) {
	base := 10 * time.Second
	b := NewBackoff(BackoffConfig{Base: base, Factor: 1, Cap: time.Hour, Jitter: true}, rand.New(rand.NewSource(1)))
	for i := 0; i < 100; i++ {
		got := b.Next()
		if got < base/2 || got > base {
			t.Fatalf("jitter delay %v outside [%v, %v]", got, base/2, base)
		}
	}
}
