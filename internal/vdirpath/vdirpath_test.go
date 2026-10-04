package vdirpath

import (
	"errors"
	"net/url"
	"testing"
)

func TestResolveTraversalTable(t *testing.T) {
	tests := []struct {
		virtual string
		want    string
		wantErr error
	}{
		// the root itself
		{"", "", nil},
		{".", "", nil},
		{"docs/..", "", nil},
		{"docs/", "docs", nil},

		// ordinary paths
		{"docs", "docs", nil},
		{"docs/a.txt", "docs/a.txt", nil},
		{"docs/sub/a.txt", "docs/sub/a.txt", nil},

		// redundant segments collapse to the canonical path
		{"docs/./a.txt", "docs/a.txt", nil},
		{"docs//a.txt", "docs/a.txt", nil},
		{"./docs", "docs", nil},
		{"docs/sub/../a.txt", "docs/a.txt", nil},
		{"a/../b", "b", nil},

		// traversal above the root is rejected
		{"..", "", ErrOutsideRoot},
		{"../etc/passwd", "", ErrOutsideRoot},
		{"../../etc/passwd", "", ErrOutsideRoot},
		{"docs/../../etc", "", ErrOutsideRoot},
		{"docs/../../../etc/passwd", "", ErrOutsideRoot},

		// absolute forms are rejected
		{"/etc/passwd", "", ErrInvalidPath},
		{"/", "", ErrInvalidPath},
		{"//etc", "", ErrInvalidPath},

		// null bytes are rejected
		{"a\x00b", "", ErrInvalidPath},
		{"docs/a\x00", "", ErrInvalidPath},

		// backslashes are ordinary characters (never separators)
		{`..\..\etc\passwd`, `..\..\etc\passwd`, nil},
		{`docs\sub\x`, `docs\sub\x`, nil},
	}
	for _, tc := range tests {
		got, err := Resolve(tc.virtual)
		if tc.wantErr != nil {
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("Resolve(%q): got err %v, want %v", tc.virtual, err, tc.wantErr)
			}
			continue
		}
		if err != nil {
			t.Errorf("Resolve(%q): unexpected err %v", tc.virtual, err)
			continue
		}
		if got != tc.want {
			t.Errorf("Resolve(%q) = %q, want %q", tc.virtual, got, tc.want)
		}
	}
}

// TestResolvePercentEncoded shows the contract handlers rely on: they
// percent-decode before resolving, and the decoded traversal form is
// then rejected like any other.
func TestResolvePercentEncoded(t *testing.T) {
	decoded, err := url.PathUnescape("%2e%2e/%2e%2e/etc/passwd")
	if err != nil {
		t.Fatalf("unescape: %v", err)
	}
	if decoded != "../../etc/passwd" {
		t.Fatalf("decoded %q", decoded)
	}
	if _, err := Resolve(decoded); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("decoded traversal not rejected: %v", err)
	}

	// A literal percent sequence that survives decoding is an ordinary
	// filename character, not a traversal vector.
	got, err := Resolve("docs/a%2eb.txt")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != "docs/a%2eb.txt" {
		t.Fatalf("got %q", got)
	}
}
