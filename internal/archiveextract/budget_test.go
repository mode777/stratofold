package archiveextract

import (
	"errors"
	"io"
	"strings"
	"testing"
)

func TestBudgetReaderAllowsExactlyTheAllowance(t *testing.T) {
	src := "0123456789"
	got, err := io.ReadAll(newBudgetReader(strings.NewReader(src), int64(len(src))))
	if err != nil {
		t.Fatalf("exact-size read: %v", err)
	}
	if string(got) != src {
		t.Fatalf("read %q, want %q", got, src)
	}
}

func TestBudgetReaderFailsOneBytePast(t *testing.T) {
	src := "0123456789"
	_, err := io.ReadAll(newBudgetReader(strings.NewReader(src), int64(len(src)-1)))
	if !errors.Is(err, ErrBudget) {
		t.Fatalf("err = %v, want ErrBudget", err)
	}
}

func TestBudgetReaderFailsAcrossChunks(t *testing.T) {
	// A reader that never ends would let a bomb run forever; the budget
	// must stop it even when the source is larger than the allowance by
	// a wide margin.
	b := newBudgetReader(neverEnding{}, 1024)
	buf := make([]byte, 4096)
	n, err := b.Read(buf)
	if n != 1024 || err != nil {
		t.Fatalf("first read = %d, %v; want 1024, nil", n, err)
	}
	if _, err := b.Read(buf); !errors.Is(err, ErrBudget) {
		t.Fatalf("second read err = %v, want ErrBudget", err)
	}
}

type neverEnding struct{}

func (neverEnding) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}
